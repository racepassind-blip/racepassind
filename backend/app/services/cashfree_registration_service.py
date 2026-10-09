"""Server-owned Cashfree checkout and registration fulfillment."""
from __future__ import annotations
import datetime as dt
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.services.auth_service import hash_opaque_token, utc_now
from app.services.cashfree_gateway import CashfreeGateway, ProviderUnavailable
from app.services.checkout_payments import bind_provider_order, reconcile_gateway_success
from app.services.registration_service import _registrations_for_order, _release_reservation
from app.services.ticket_service import ticket_token_for_registration
from app.services.auth_service import hash_opaque_token as hash_token
from app.services.audit_service import record_audit
from models import CheckoutPayment, EmailLog, Event, Order, OrderItem, Payment, Registration, Ticket, User


def queue_paid_needs_review_notifications(db: Session, payment: CheckoutPayment) -> None:
    """Persist review alerts with the verified receipt, never as a failed-payment email."""
    if payment.event_order_id is None:
        return
    # Browser/webhook and recovery can arrive together. Use the same owner lock
    # as reconciliation before checking for an existing notification intent.
    db.scalar(select(Order).where(Order.id == payment.event_order_id).with_for_update())
    db.refresh(payment)
    if payment.status != "paid_needs_review":
        return
    registrations = _registrations_for_order(db, payment.event_order_id)
    if not registrations:
        return
    event = db.get(Event, registrations[0].event_id)
    if event is None:
        return
    from app.services.email_service import EMAIL_TYPE_PAYMENT_CONFIRMATION, _get_or_create_email_log

    recipients = {
        email.strip().lower()
        for registration in registrations if registration.payment and registration.payment.payment_gateway == "cashfree"
        for email in [((registration.responses or {}).get("email") or registration.participant.email)]
        if isinstance(email, str) and email.strip()
    }
    alerts = [(email, "CASHFREE_PAYMENT_REVIEW_PARTICIPANT") for email in recipients if email]
    alerts.extend((email.strip().lower(), "CASHFREE_PAYMENT_REVIEW_ADMIN") for email in db.scalars(
        select(User.email).where(User.role == "admin", User.email.is_not(None))
    ) if email and email.strip())
    for recipient, reference_type in alerts:
        existing = db.scalar(select(EmailLog.id).where(
            EmailLog.reference_type == reference_type,
            EmailLog.reference_id == str(payment.event_order_id),
            EmailLog.recipient == recipient,
        ))
        if existing is None:
            _get_or_create_email_log(db, recipient=recipient,
                subject=f"Cashfree payment received — booking needs review — {event.name}",
                email_type=EMAIL_TYPE_PAYMENT_CONFIRMATION, reference_type=reference_type,
                reference_id=str(payment.event_order_id), event_id=event.id,
                status="pending_limit")


def _cashfree_phone(value: str | None) -> str:
    """Return the 10-digit national mobile format required by Cashfree."""
    digits = "".join(character for character in (value or "") if character.isdigit())
    if digits.startswith("0091") and len(digits) == 14:
        digits = digits[4:]
    elif digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    if len(digits) != 10 or digits[0] not in "6789":
        raise ValueError("A valid 10-digit phone number is required for Cashfree")
    return digits


def payment_for_token(db: Session, token: str) -> tuple[CheckoutPayment, Registration]:
    registration = db.scalar(select(Registration).where(Registration.confirmation_token_hash == hash_opaque_token(token)))
    if registration is None:
        raise ValueError("Registration not found")
    payment = db.scalar(select(CheckoutPayment).join(OrderItem, OrderItem.order_id == CheckoutPayment.event_order_id)
        .where(OrderItem.registration_id == registration.id))
    if payment is None or payment.mode != "CASHFREE_PLATFORM":
        raise ValueError("This registration does not use Cashfree")
    return payment, registration


def start_checkout(db: Session, *, token: str, return_url: str) -> dict:
    payment, registration = payment_for_token(db, token)
    db.scalar(select(Order).where(Order.id == payment.event_order_id).with_for_update())
    db.refresh(payment)
    gateway = CashfreeGateway()
    if payment.status == "successful":
        return {"status": "paid"}
    if payment.status == "paid_needs_review":
        return {"status": "paid_needs_review"}
    if payment.status != "awaiting":
        raise ValueError("This checkout is no longer payable")
    def create_session():
        phone = _cashfree_phone(registration.participant.phone or registration.participant.normalized_phone)
        return gateway.create_session(payment, phone=phone, customer_id=str(registration.id), return_url=return_url,
            customer_name=registration.participant.name, customer_email=registration.participant.email)

    if payment.provider_order_id:
        if (payment.provider_account, payment.provider_environment) != (gateway.account, gateway.environment):
            raise ValueError("Cashfree account configuration changed for this checkout")
        recovered = gateway.recover_session(payment, missing_ok=True)
        if recovered is None:
            # A process may stop after persisting its binding, before sending
            # Create Order. The same deterministic order/idempotency key is safe.
            result = create_session()
            db.commit()
            return {"status": payment.status, **result}
        state = gateway.payment_state(payment)
        if state == "successful":
            reconcile_order(db, provider_order_id=payment.provider_order_id)
            db.refresh(payment)
            return {"status": "paid" if payment.status == "successful" else payment.status}
        if state not in {"failed", "user_dropped", "not_attempted"}:
            return {"status": state}
        result = recovered
    else:
        _cashfree_phone(registration.participant.phone or registration.participant.normalized_phone)
        # Persist identity before the external side effect so reconciliation
        # can recover a successful Create Order even if this process crashes.
        bind_provider_order(payment, account=gateway.account, environment=gateway.environment,
                            provider_order_id=f"sp_{payment.id.hex}")
        db.commit()
        db.scalar(select(Order).where(Order.id == payment.event_order_id).with_for_update())
        db.refresh(payment)
        if payment.status != "awaiting":
            return {"status": payment.status}
        result = gateway.recover_session(payment, missing_ok=True)
        if result is None:
            result = create_session()
        else:
            # An orphan provider order may already be paid or still pending.
            # Route it through the same state checks before returning a session.
            db.commit()
            return start_checkout(db, token=token, return_url=return_url)
        db.commit()
    return {"status": payment.status, **result}


def finalize_paid_order(db: Session, payment: CheckoutPayment) -> bool:
    """Caller holds the order lock and owns the transaction/savepoint."""
    order = db.get(Order, payment.event_order_id)
    registrations = _registrations_for_order(db, order.id)
    if not registrations or order.status != "pending":
        return False
    if any(r.payment is None or r.payment.payment_gateway not in {"cashfree", "free"}
           or r.status not in {"awaiting_payment", "confirmed"} for r in registrations):
        return False
    paid = [r for r in registrations if r.payment.payment_gateway == "cashfree"]
    if not paid or any(r.status != "awaiting_payment" for r in paid):
        return False
    event = db.scalar(select(Event).where(Event.id == paid[0].event_id).with_for_update()
                      .execution_options(populate_existing=True))
    if event is None or event.archived_at is not None or event.status != "published":
        return False
    tickets = {ticket.id: ticket for ticket in db.scalars(select(Ticket).where(
        Ticket.id.in_({r.ticket_id for r in paid})).order_by(Ticket.id).with_for_update()
        .execution_options(populate_existing=True)).all()}
    required = {}
    for registration in paid:
        required[registration.ticket_id] = required.get(registration.ticket_id, 0) + registration.quantity
    if any(ticket_id not in tickets or tickets[ticket_id].quantity_reserved < quantity
           for ticket_id, quantity in required.items()):
        return False
    now = utc_now()
    recipients = set()
    for registration in paid:
        ticket = tickets[registration.ticket_id]
        _release_reservation(ticket, registration.quantity)
        ticket.quantity_sold += registration.quantity
        event.participants += registration.quantity
        registration.status = "confirmed"
        registration.reserved_until = None
        registration.payment_status = "approved"
        registration.ticket_token_hash = hash_token(ticket_token_for_registration(registration))
        registration.payment.status = "approved"
        registration.payment.paid_at = now
        registration.payment.received_amount_paise = registration.participant_total_paise
        registration.payment.gateway_order_id = payment.provider_order_id
        from app.services.email_service import _get_or_create_email_log, EMAIL_TYPE_REGISTRATION_CONFIRMATION
        recipient = (registration.responses or {}).get("email") or registration.participant.email
        if recipient:
            recipient = recipient.strip().lower()
            if recipient not in recipients:
                _get_or_create_email_log(db, recipient=recipient,
                    subject=f"Your booking is confirmed — {event.name}",
                    email_type=EMAIL_TYPE_REGISTRATION_CONFIRMATION,
                    reference_type="CASHFREE_BOOKING", reference_id=str(order.id),
                    event_id=event.id, status="pending_limit")
                recipients.add(recipient)
            registration.email_status = "PENDING_LIMIT"
    order.status = "paid"
    db.flush()
    return True


def reconcile_order(db: Session, *, provider_order_id: str, expected_payment_id: str | None = None) -> str:
    gateway = CashfreeGateway()
    payment = db.scalar(select(CheckoutPayment).where(CheckoutPayment.provider_account == gateway.account,
        CheckoutPayment.provider_environment == gateway.environment, CheckoutPayment.provider_order_id == provider_order_id))
    if payment is None or payment.event_order_id is None or payment.mode != "CASHFREE_PLATFORM":
        raise ValueError("Cashfree order not found")

    class Evidence:
        def verify_payment(self, bound_payment):
            return gateway.verify_payment(bound_payment, expected_payment_id=expected_payment_id)

    def lock_owner():
        db.scalar(select(Order).where(Order.id == payment.event_order_id).with_for_update())

    disposition = reconcile_gateway_success(db, payment, provider=Evidence(), account=gateway.account,
        environment=gateway.environment, lock_owner=lock_owner, finalize=lambda: finalize_paid_order(db, payment))
    if disposition == "paid_needs_review":
        db.refresh(payment)
        queue_paid_needs_review_notifications(db, payment)
    db.commit()
    # The recovery worker delivers committed notification intents independently
    # of webhook/browser requests. Never hold up provider acknowledgement on Gmail.
    return disposition


def expire_cashfree_order(db: Session, payment_id) -> bool:
    """Release stock only after provider-verified expiry, never a browser timeout."""
    payment = db.get(CheckoutPayment, payment_id)
    order = db.scalar(select(Order).where(Order.id == payment.event_order_id).with_for_update())
    db.refresh(payment)
    if payment.status != "awaiting" or order.status != "pending":
        return False
    gateway = CashfreeGateway()
    if payment.provider_order_id and (payment.provider_account, payment.provider_environment) != (gateway.account, gateway.environment):
        return False
    created_at = payment.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=dt.timezone.utc)
    if not payment.provider_order_id and utc_now() - created_at < dt.timedelta(minutes=30):
        return False
    recovered = gateway.recover_session(payment, missing_ok=True)
    if recovered is not None:
        if not payment.provider_order_id:
            bind_provider_order(payment, account=gateway.account, environment=gateway.environment,
                                provider_order_id=recovered["orderId"])
            db.commit()
            return False
        if gateway.payment_state(payment) != "expired":
            return False
    elif utc_now() - created_at < dt.timedelta(minutes=30):
        # No provider order exists, but the customer may still start checkout.
        return False
    registrations = _registrations_for_order(db, order.id)
    paid = [r for r in registrations if r.payment and r.payment.payment_gateway == "cashfree"]
    if any(r.status != "awaiting_payment" for r in paid):
        return False
    tickets = {t.id: t for t in db.scalars(select(Ticket).where(
        Ticket.id.in_({r.ticket_id for r in paid})).order_by(Ticket.id).with_for_update())}
    for registration in paid:
        _release_reservation(tickets[registration.ticket_id], registration.quantity)
        registration.status = "cancelled"
        registration.reserved_until = None
        registration.payment.status = "expired"
    payment.status = "expired"
    order.status = "cancelled"
    record_audit(db, actor_user_id=None, action="cashfree_checkout_expired", resource_type="checkout_payment",
                 resource_id=payment.id, metadata={"orderId": str(order.id)})
    db.commit()
    return True
