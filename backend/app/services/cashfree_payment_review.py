"""Admin resolution of verified payments whose bookings could not be fulfilled.

The original receipt stays immutable. A separate decision authorizes either
fulfillment or one full refund, and survives provider timeouts/process restarts.
"""
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.services.audit_service import record_audit
from app.services.auth_service import utc_now
from app.services.cashfree_gateway import CashfreeGateway, ProviderUnavailable, amount_paise
from app.services.cashfree_registration_service import finalize_paid_order
from app.services.registration_service import _registrations_for_order, _release_reservation
from models import (CashfreePaymentResolution, CheckoutPayment, CheckoutReceipt, EmailLog,
                    Event, Order, Ticket, User, OrganizationMember)


def _locked_checkout(db: Session, payment_id: UUID):
    payment = db.get(CheckoutPayment, payment_id)
    if payment is None or payment.mode != "CASHFREE_PLATFORM" or payment.event_order_id is None:
        raise ValueError("Cashfree booking not found")
    order = db.scalar(select(Order).where(Order.id == payment.event_order_id).with_for_update()
                      .execution_options(populate_existing=True))
    registrations = _registrations_for_order(db, order.id)
    for event_id in sorted({r.event_id for r in registrations}, key=str):
        db.scalar(select(Event).where(Event.id == event_id).with_for_update())
    db.refresh(payment, with_for_update=True)
    return payment, order, registrations


def _receipt(db: Session, payment: CheckoutPayment, gateway: CashfreeGateway) -> CheckoutReceipt:
    if (payment.provider_account, payment.provider_environment) != (gateway.account, gateway.environment):
        raise ValueError("Cashfree account/environment does not match this payment")
    receipt = db.scalar(select(CheckoutReceipt).where(
        CheckoutReceipt.checkout_payment_id == payment.id,
        CheckoutReceipt.disposition == "paid_needs_review",
        CheckoutReceipt.account == payment.provider_account,
        CheckoutReceipt.environment == payment.provider_environment,
        CheckoutReceipt.provider == "cashfree",
        CheckoutReceipt.amount_paise == payment.amount_paise,
    ))
    if receipt is None:
        raise ValueError("Verified payment receipt is required")
    return receipt


def resolve_payment(db: Session, *, payment_id: UUID, action: str, reason: str, actor_user_id: UUID):
    if action not in {"FULFILL", "REFUND"} or not 5 <= len(reason.strip()) <= 1000:
        raise ValueError("Choose a resolution and provide a reason (5–1000 characters)")
    actor = db.get(User, actor_user_id)
    if actor is None or actor.role != "admin" or not actor.is_active:
        raise ValueError("Only an active admin may resolve payments")
    payment, order, registrations = _locked_checkout(db, payment_id)
    existing = db.scalar(select(CashfreePaymentResolution).where(
        CashfreePaymentResolution.checkout_payment_id == payment.id))
    if existing:
        if existing.action != action:
            raise ValueError("This payment already has a different resolution; it cannot be changed")
        db.commit()
        if action == "REFUND" and existing.status != "REFUNDED":
            return reconcile_review_refund(db, payment_id=payment.id, actor_user_id=actor_user_id)
        return existing.status
    if payment.status != "paid_needs_review":
        raise ValueError("Payment is not awaiting booking review")
    gateway = CashfreeGateway()
    receipt = _receipt(db, payment, gateway)
    verified = gateway.verify_payment(payment, expected_payment_id=receipt.payment_id)
    if (verified.amount_paise != payment.amount_paise or verified.currency != payment.currency
            or verified.payment_id != receipt.payment_id or verified.checkout_payment_id != payment.id
            or verified.provider_order_id != payment.provider_order_id
            or verified.account != payment.provider_account or verified.environment != payment.provider_environment):
        raise ProviderUnavailable("Payment evidence does not match the booking")
    resolution = CashfreePaymentResolution(checkout_payment_id=payment.id, receipt_id=receipt.id,
        action=action, status="FULFILLED" if action == "FULFILL" else "PENDING",
        amount_paise=payment.amount_paise, reason=reason.strip(), initiated_by=actor_user_id)
    if action == "FULFILL":
        if not finalize_paid_order(db, payment):
            raise ValueError("Booking cannot be confirmed: event and reserved tickets must still be valid. Use a full refund if it cannot be fulfilled.")
        payment.status = "successful"
        resolution.completed_at = utc_now()
    else:
        paid = [r for r in registrations if r.payment and r.payment.payment_gateway == "cashfree"]
        if not paid or any(r.status not in {"awaiting_payment", "cancelled"} for r in paid):
            raise ValueError("Booking is not eligible for an unfulfilled-payment refund")
        # Choosing refund is irreversible. Release only still-held reservations;
        # an already expired/cancelled checkout released them earlier.
        tickets = {t.id: t for t in db.scalars(select(Ticket).where(
            Ticket.id.in_({r.ticket_id for r in paid})).order_by(Ticket.id).with_for_update()
            .execution_options(populate_existing=True))}
        for registration in paid:
            if registration.status == "awaiting_payment" and order.status == "pending":
                _release_reservation(tickets[registration.ticket_id], registration.quantity)
            registration.status = "cancelled"
            registration.reserved_until = None
            registration.payment_status = "refund_pending"
            registration.payment.status = "refund_pending"
            registration.payment.received_amount_paise = registration.participant_total_paise
            registration.payment.gateway_order_id = payment.provider_order_id
        order.status = "cancelled"
        resolution.provider_refund_id = f"sp_review_{payment.id.hex}"
    db.add(resolution)
    db.flush()
    record_audit(db, actor_user_id=actor_user_id, action="cashfree_payment_resolution_created",
        resource_type="checkout_payment", resource_id=payment.id,
        metadata={"decision": action, "reason": reason.strip(), "amountPaise": payment.amount_paise,
                  "receiptId": str(receipt.id), "resolutionId": str(resolution.id)})
    if action == "FULFILL":
        from app.services.organizer_settlement_service import post_verified_collection
        post_verified_collection(db, receipt_id=receipt.id)
    else:
        _queue_refund_notice(db, payment, resolution)
    # Persist authorization before any refund call. Worker retries use the same ID.
    db.commit()
    if action == "REFUND":
        return reconcile_review_refund(db, payment_id=payment.id, actor_user_id=actor_user_id)
    return resolution.status


def _queue_refund_notice(db, payment, resolution):
    from app.services.email_service import _get_or_create_email_log, EMAIL_TYPE_REFUND
    registrations = _registrations_for_order(db, payment.event_order_id)
    event = db.get(Event, registrations[0].event_id)
    recipients = {((r.responses or {}).get("email") or r.participant.email or "").strip().lower()
                  for r in registrations if r.payment and r.payment.payment_gateway == "cashfree"}
    recipients.update(db.scalars(select(User.email).where(User.role == "admin", User.is_active.is_(True))))
    recipients.update(db.scalars(select(User.email).join(OrganizationMember, OrganizationMember.user_id == User.id)
        .where(OrganizationMember.organization_id == event.organization_id,
               OrganizationMember.member_role == "organizer", User.is_active.is_(True))))
    label, reference_type = {
        "REFUNDED": ("confirmed", "CASHFREE_REVIEW_REFUND_SUCCESS"),
        "NEEDS_REVIEW": ("needs review", "CASHFREE_REVIEW_REFUND_ISSUE"),
        "PENDING": ("initiated", "CASHFREE_REVIEW_REFUND_PENDING"),
    }[resolution.status]
    for recipient in sorted({email.strip().lower() for email in recipients if email and email.strip()}):
        if db.scalar(select(EmailLog.id).where(EmailLog.reference_type == reference_type,
                EmailLog.reference_id == str(payment.id), EmailLog.recipient == recipient)) is None:
            _get_or_create_email_log(db, recipient=recipient,
                subject=f"Booking refund {label} — {event.name}",
                email_type=EMAIL_TYPE_REFUND, reference_type=reference_type,
                reference_id=str(payment.id), event_id=event.id, status="pending_limit")


def reconcile_review_refund(db: Session, *, payment_id: UUID, actor_user_id=None):
    payment, order, registrations = _locked_checkout(db, payment_id)
    resolution = db.scalar(select(CashfreePaymentResolution).where(
        CashfreePaymentResolution.checkout_payment_id == payment.id).with_for_update())
    if resolution is None or resolution.action != "REFUND":
        raise ValueError("No admin-authorized refund exists for this payment")
    if resolution.status == "REFUNDED":
        return resolution.status
    gateway = CashfreeGateway()
    _receipt(db, payment, gateway)
    body = gateway.get_refund(payment.provider_order_id, resolution.provider_refund_id, missing_ok=True)
    if body is None:
        if resolution.status == "NEEDS_REVIEW":
            raise ProviderUnavailable("Cashfree refund needs investigation; another refund will not be created")
        body = gateway.create_refund(payment.provider_order_id, resolution.provider_refund_id,
                                    resolution.amount_paise, idempotency_key=str(resolution.id))
    if (not isinstance(body, dict) or body.get("order_id") != payment.provider_order_id
            or body.get("refund_id") != resolution.provider_refund_id
            or body.get("refund_currency") != payment.currency
            or amount_paise(body.get("refund_amount")) != resolution.amount_paise):
        raise ProviderUnavailable("Cashfree refund response does not match the resolution")
    state = body.get("refund_status")
    if state not in {"PENDING", "PENDING_APPROVAL", "ONHOLD", "SUCCESS", "REJECTED", "CANCELLED"}:
        raise ProviderUnavailable("Unknown Cashfree refund status")
    previous = resolution.provider_status
    resolution.provider_status = state
    if previous != state:
        record_audit(db, actor_user_id=actor_user_id, action="cashfree_payment_resolution_status_changed",
            resource_type="checkout_payment", resource_id=payment.id,
            metadata={"fromStatus": previous, "toStatus": state, "amountPaise": resolution.amount_paise,
                      "providerRefundId": resolution.provider_refund_id,
                      "initiatedBy": str(resolution.initiated_by), "source": "admin" if actor_user_id else "recovery"})
    resolution.status = "REFUNDED" if state == "SUCCESS" else "NEEDS_REVIEW" if state in {"REJECTED", "CANCELLED"} else "PENDING"
    if state == "SUCCESS":
        resolution.completed_at = utc_now()
        payment.status = "refunded"
        for registration in registrations:
            if registration.payment and registration.payment.payment_gateway == "cashfree":
                registration.payment_status = "refunded"
                registration.payment.status = "refunded"
        # No organizer collection was posted for this unfulfilled booking.
        # Keep the receipt and refund in review history without a payable entry.
    if resolution.status in {"REFUNDED", "NEEDS_REVIEW"}:
        _queue_refund_notice(db, payment, resolution)
    db.commit()
    return resolution.status
