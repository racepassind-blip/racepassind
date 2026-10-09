"""Approved Cashfree refunds settle only after a provider-confirmed SUCCESS."""
from __future__ import annotations

from uuid import UUID
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.services.audit_service import record_audit
from app.services.auth_service import utc_now
from app.services.cashfree_gateway import CashfreeGateway, ProviderUnavailable, amount_paise
from models import CheckoutPayment, Event, OrderItem, Refund, Registration, User, REFUND_STATUS_APPROVED, REFUND_STATUS_REFUNDED

logger = logging.getLogger(__name__)


def _refund_binding(db: Session, refund: Refund, gateway: CashfreeGateway) -> CheckoutPayment:
    if refund.payment_provider != "CASHFREE" or refund.registration_id is None or refund.is_manual_refund:
        raise ValueError("This is not a managed Cashfree refund")
    checkout = db.scalar(select(CheckoutPayment).join(OrderItem, OrderItem.order_id == CheckoutPayment.event_order_id)
        .where(OrderItem.registration_id == refund.registration_id))
    if (checkout is None or checkout.mode != "CASHFREE_PLATFORM" or checkout.status != "successful"
            or (checkout.provider_account, checkout.provider_environment) != (gateway.account, gateway.environment)):
        raise ValueError("Refund does not match a verified Cashfree collection")
    return checkout


def reconcile_cashfree_refund(db: Session, *, refund_id: UUID, initiate: bool, actor_user_id=None) -> str:
    gateway = CashfreeGateway()
    event_id = db.scalar(select(Refund.event_id).where(Refund.id == refund_id))
    if event_id is None:
        raise ValueError("Refund not found")
    db.scalar(select(Event).where(Event.id == event_id).with_for_update())
    refund = db.scalar(select(Refund).where(Refund.id == refund_id).with_for_update().execution_options(populate_existing=True))
    if refund is None:
        raise ValueError("Refund not found")
    if refund.status == REFUND_STATUS_REFUNDED:
        return "SUCCESS"
    if refund.status != REFUND_STATUS_APPROVED:
        raise ValueError("Refund must be approved first")
    checkout = _refund_binding(db, refund, gateway)
    approved = refund.approved_refund_amount
    if type(approved) is not int or approved <= 0 or approved > refund.original_total_paid:
        raise ValueError("Invalid approved refund amount")
    if refund.platform_fee_refund_amount > approved:
        raise ValueError("Refunded platform fee exceeds approved amount")
    provider_refund_id = f"sp_ref_{refund.id.hex}"
    if refund.provider_refund_id is not None and refund.provider_refund_id != provider_refund_id:
        raise ValueError("Cashfree refund reference does not match this request")
    if refund.provider_refund_status in {"CANCELLED", "REJECTED"} and initiate:
        raise ValueError("Cashfree rejected this refund. Recheck its status; do not issue a second refund automatically.")
    if initiate and refund.provider_refund_id is None:
        actor = db.get(User, actor_user_id) if actor_user_id else None
        if actor is None or actor.role != "admin" or not actor.is_active:
            raise ValueError("An admin must initiate a new Cashfree refund")
        # Persist the authorized attempt before calling Cashfree. A timeout
        # after provider acceptance must remain discoverable by recovery.
        refund.provider_refund_id = provider_refund_id
        refund.provider_refund_status = "PENDING"
        refund.initiated_by = actor_user_id
        refund.initiated_at = utc_now()
        record_audit(db, actor_user_id=actor_user_id, action="cashfree_refund_initiated",
            resource_type="refund", resource_id=refund.id,
            metadata={"providerRefundId": provider_refund_id, "amountPaise": approved,
                      "fromStatus": None, "toStatus": "PENDING"})
        db.commit()
        return reconcile_cashfree_refund(db, refund_id=refund_id, initiate=True, actor_user_id=actor_user_id)
    body = gateway.get_refund(checkout.provider_order_id, provider_refund_id, missing_ok=True)
    if body is None:
        if not initiate:
            raise ProviderUnavailable("Cashfree refund is not yet available")
        body = gateway.create_refund(checkout.provider_order_id, provider_refund_id, approved,
                                     idempotency_key=str(refund.id))
    if (not isinstance(body, dict) or body.get("refund_id") != provider_refund_id
            or body.get("order_id") != checkout.provider_order_id
            or body.get("refund_currency") != "INR"
            or amount_paise(body.get("refund_amount")) != approved):
        raise ProviderUnavailable("Cashfree refund response does not match the approval")
    provider_status = body.get("refund_status")
    if provider_status not in {"PENDING", "PENDING_APPROVAL", "SUCCESS", "CANCELLED", "REJECTED", "ONHOLD"}:
        raise ProviderUnavailable("Unknown Cashfree refund state")
    previous_status = refund.provider_refund_status
    if previous_status != provider_status:
        record_audit(db, actor_user_id=actor_user_id, action="cashfree_refund_status_changed",
            resource_type="refund", resource_id=refund.id,
            metadata={"providerRefundId": provider_refund_id, "amountPaise": approved,
                      "fromStatus": previous_status, "toStatus": provider_status,
                      "initiatedBy": str(refund.initiated_by) if refund.initiated_by else None,
                      "source": "admin" if actor_user_id else "recovery"})
    refund.provider_refund_id = provider_refund_id
    refund.provider_refund_status = provider_status
    if provider_status == "SUCCESS":
        refund.status = REFUND_STATUS_REFUNDED
        refund.refunded_at = utc_now()
        refund.confirmed_at = refund.refunded_at
        registration = db.get(Registration, refund.registration_id)
        if registration is not None:
            registration.payment_status = "refunded"
        record_audit(db, actor_user_id=actor_user_id, action="cashfree_refund_confirmed",
            resource_type="refund", resource_id=refund.id,
            metadata={"providerRefundId": provider_refund_id, "amountPaise": approved,
                      "initiatedBy": str(refund.initiated_by) if refund.initiated_by else None,
                      "source": "admin" if actor_user_id else "recovery"})
    db.commit()
    if provider_status in {"SUCCESS", "REJECTED", "CANCELLED"}:
        try:
            from app.services.email_service import (
                send_cashfree_refund_success_notifications,
                send_cashfree_refund_issue_notifications,
            )
            if provider_status == "SUCCESS":
                send_cashfree_refund_success_notifications(db, refund)
            else:
                send_cashfree_refund_issue_notifications(db, refund)
        except Exception:
            db.rollback()
            logger.exception("cashfree_refund_notification_failed refund_id=%s", refund.id)
    return provider_status
