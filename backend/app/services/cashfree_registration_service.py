"""Server-owned Cashfree checkout and registration fulfillment."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.services.auth_service import hash_opaque_token, utc_now
from app.services.cashfree_gateway import CashfreeGateway, ProviderUnavailable
from app.services.checkout_payments import bind_provider_order, reconcile_gateway_success
from app.services.registration_service import _registrations_for_order, _release_reservation
from app.services.ticket_service import ticket_token_for_registration
from app.services.auth_service import hash_opaque_token as hash_token
from models import CheckoutPayment, Event, Order, OrderItem, Payment, Registration, Ticket


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
    gateway = CashfreeGateway()
    if payment.status == "successful":
        return {"status": "paid"}
    if payment.status not in {"awaiting", "paid_needs_review"}:
        raise ValueError("This checkout is no longer payable")
    if payment.provider_order_id:
        if (payment.provider_account, payment.provider_environment) != (gateway.account, gateway.environment):
            raise ValueError("Cashfree account configuration changed for this checkout")
        result = gateway.recover_session(payment)
    else:
        phone = registration.participant.normalized_phone or ""
        result = gateway.recover_session(payment, missing_ok=True)
        if result is None:
            result = gateway.create_session(payment, phone=phone, customer_id=str(registration.id), return_url=return_url)
        bind_provider_order(payment, account=gateway.account, environment=gateway.environment,
                            provider_order_id=result["orderId"])
        db.commit()
    return {"status": payment.status, **result}


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

    def finalize():
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
        event = db.get(Event, paid[0].event_id)
        if event is None or event.archived_at is not None or event.status != "published":
            return False
        tickets = {ticket.id: ticket for ticket in db.scalars(select(Ticket).where(
            Ticket.id.in_({r.ticket_id for r in paid})).order_by(Ticket.id).with_for_update()).all()}
        if any(r.ticket_id not in tickets or tickets[r.ticket_id].quantity_reserved < r.quantity for r in paid):
            return False
        now = utc_now()
        for registration in paid:
            ticket = tickets[registration.ticket_id]
            _release_reservation(ticket, registration.quantity)
            ticket.quantity_sold += registration.quantity
            event.participants += registration.quantity
            registration.status = "confirmed"
            registration.payment_status = "approved"
            registration.ticket_token_hash = hash_token(ticket_token_for_registration(registration))
            registration.payment.status = "approved"
            registration.payment.paid_at = now
            registration.payment.received_amount_paise = registration.participant_total_paise
            registration.payment.gateway_order_id = payment.provider_order_id
        order.status = "paid"
        db.flush()
        return True

    disposition = reconcile_gateway_success(db, payment, provider=Evidence(), account=gateway.account,
        environment=gateway.environment, lock_owner=lock_owner, finalize=finalize)
    db.commit()
    return disposition
