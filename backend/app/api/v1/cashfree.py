"""Cashfree checkout and webhook ingress; browser data is never payment evidence."""
from __future__ import annotations

import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import select, func, or_
from typing import Literal

from app.api.deps import require_csrf, require_roles
from app.config import get_settings
from app.services.cashfree_gateway import CashfreeGateway, ProviderUnavailable
from app.services.cashfree_registration_service import payment_for_token, reconcile_order, start_checkout
from app.services.cashfree_refunds import reconcile_cashfree_refund
from db import get_db
from models import CashfreePaymentResolution, CheckoutPayment, Event, Organization, OrderItem, Registration, Refund, User
from app.services.audit_service import audit_history

router = APIRouter()


@router.get("/admin/refunds/{refund_id}/history")
def refund_history(refund_id: UUID, _=Depends(require_roles("admin")), db: Session = Depends(get_db)):
    if db.get(Refund, refund_id) is None:
        raise HTTPException(404, "Refund not found")
    return {"items": audit_history(db, resource_type="refund", resource_id=refund_id)}


@router.get("/admin/cashfree/payment-reviews")
def payment_reviews(search: str = Query(default="", max_length=160), page: int = Query(default=1, ge=1),
                    include_resolved: bool = False, _=Depends(require_roles("admin")), db: Session = Depends(get_db)):
    query = (select(CheckoutPayment, Event.name, Organization.name)
        .join(OrderItem, OrderItem.order_id == CheckoutPayment.event_order_id)
        .join(Registration, Registration.id == OrderItem.registration_id)
        .join(Event, Event.id == Registration.event_id)
        .join(Organization, Organization.id == Event.organization_id)
        .outerjoin(CashfreePaymentResolution, CashfreePaymentResolution.checkout_payment_id == CheckoutPayment.id)
        .where(CheckoutPayment.mode == "CASHFREE_PLATFORM"))
    query = query.where(or_(CheckoutPayment.status == "paid_needs_review", CashfreePaymentResolution.id.is_not(None))
                        if include_resolved else CheckoutPayment.status == "paid_needs_review")
    if search.strip():
        term = f"%{search.strip()}%"
        query = query.where(or_(Event.name.ilike(term), Organization.name.ilike(term), CheckoutPayment.provider_order_id.ilike(term)))
    query = query.distinct()
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.execute(query.order_by(CheckoutPayment.created_at.desc(), CheckoutPayment.id).offset((page - 1) * 20).limit(20)).all()
    items = []
    for payment, event_name, organizer_name in rows:
        resolution = db.scalar(select(CashfreePaymentResolution).where(CashfreePaymentResolution.checkout_payment_id == payment.id))
        actor = db.get(User, resolution.initiated_by) if resolution else None
        items.append({"id": str(payment.id), "orderId": str(payment.event_order_id),
            "eventName": event_name, "organizerName": organizer_name, "amountPaise": payment.amount_paise,
            "providerOrderId": payment.provider_order_id, "environment": payment.provider_environment,
            "status": resolution.status if resolution else "NEEDS_DECISION", "createdAt": payment.created_at,
            "resolution": {"action": resolution.action, "reason": resolution.reason,
                "initiatedBy": actor.name if actor else str(resolution.initiated_by),
                "createdAt": resolution.created_at, "completedAt": resolution.completed_at,
                "providerRefundId": resolution.provider_refund_id, "providerStatus": resolution.provider_status} if resolution else None,
            "history": audit_history(db, resource_type="checkout_payment", resource_id=payment.id)})
    return {"items": items, "total": total, "page": page, "pageSize": 20}


class PaymentResolutionIn(BaseModel):
    action: Literal["FULFILL", "REFUND"]
    reason: str = Field(min_length=5, max_length=1000)


@router.post("/admin/cashfree/payment-reviews/{payment_id}/resolve")
def resolve_payment_review(payment_id: UUID, payload: PaymentResolutionIn, user=Depends(require_roles("admin")),
                           _: None = Depends(require_csrf), db: Session = Depends(get_db)):
    from app.services.cashfree_payment_review import resolve_payment
    try:
        return {"status": resolve_payment(db, payment_id=payment_id, action=payload.action,
                                         reason=payload.reason, actor_user_id=user.id)}
    except ProviderUnavailable as exc:
        db.rollback()
        raise HTTPException(503, str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(422, str(exc)) from exc


@router.post("/admin/cashfree/payment-reviews/{payment_id}/reconcile")
def reconcile_payment_review(payment_id: UUID, user=Depends(require_roles("admin")),
                             _: None = Depends(require_csrf), db: Session = Depends(get_db)):
    from app.services.cashfree_payment_review import reconcile_review_refund
    try:
        return {"status": reconcile_review_refund(db, payment_id=payment_id, actor_user_id=user.id)}
    except ProviderUnavailable as exc:
        db.rollback()
        raise HTTPException(503, str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(422, str(exc)) from exc


@router.post("/admin/refunds/{refund_id}/cashfree/process")
def process_cashfree_refund(refund_id: UUID, user=Depends(require_roles("admin")),
                            _: None = Depends(require_csrf), db: Session = Depends(get_db)):
    try:
        return {"providerStatus": reconcile_cashfree_refund(db, refund_id=refund_id,
                                                               initiate=True, actor_user_id=user.id)}
    except ProviderUnavailable as exc:
        db.rollback()
        raise HTTPException(503, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(422, detail=str(exc)) from exc


@router.post("/admin/refunds/{refund_id}/cashfree/reconcile")
def poll_cashfree_refund(refund_id: UUID, user=Depends(require_roles("admin")),
                         _: None = Depends(require_csrf), db: Session = Depends(get_db)):
    try:
        return {"providerStatus": reconcile_cashfree_refund(db, refund_id=refund_id,
                                                               initiate=False, actor_user_id=user.id)}
    except ProviderUnavailable as exc:
        db.rollback()
        raise HTTPException(503, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(422, detail=str(exc)) from exc


@router.get("/cashfree/availability")
def cashfree_availability():
    settings = get_settings()
    return {"enabled": settings.cashfree_ready}


class CheckoutToken(BaseModel):
    confirmation_token: str = Field(min_length=16, max_length=256)


@router.post("/registrations/cashfree/session")
def cashfree_session(payload: CheckoutToken, _: None = Depends(require_csrf), db: Session = Depends(get_db)):
    try:
        payment, registration = payment_for_token(db, payload.confirmation_token)
        origin = get_settings().frontend_origins[0]
        result = start_checkout(db, token=payload.confirmation_token,
                                return_url=f"{origin}/checkout/{registration.event_id}?cashfree_return=1")
        return result
    except ProviderUnavailable as exc:
        db.rollback()
        raise HTTPException(503, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(422, detail=str(exc)) from exc


@router.post("/registrations/cashfree/status")
def cashfree_status(payload: CheckoutToken, _: None = Depends(require_csrf), db: Session = Depends(get_db)):
    try:
        payment, _ = payment_for_token(db, payload.confirmation_token)
        resolution = db.scalar(select(CashfreePaymentResolution).where(CashfreePaymentResolution.checkout_payment_id == payment.id))
        if resolution and resolution.action == "REFUND":
            return {"status": {"PENDING": "refund_pending", "NEEDS_REVIEW": "refund_needs_review", "REFUNDED": "refunded"}[resolution.status]}
        if payment.status == "awaiting" and payment.provider_order_id:
            provider_state = CashfreeGateway().payment_state(payment)
            if provider_state == "successful":
                reconcile_order(db, provider_order_id=payment.provider_order_id)
            else:
                return {"status": provider_state}
        db.refresh(payment)
        return {"status": payment.status}
    except ProviderUnavailable as exc:
        db.rollback()
        raise HTTPException(503, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(422, detail=str(exc)) from exc


@router.post("/webhooks/cashfree")
async def cashfree_webhook(request: Request, db: Session = Depends(get_db)):
    raw = await request.body()
    try:
        CashfreeGateway().verify_webhook(raw, request.headers.get("x-webhook-timestamp"),
                                         request.headers.get("x-webhook-signature"))
    except ProviderUnavailable as exc:
        raise HTTPException(401, detail=str(exc)) from exc
    try:
        body = json.loads(raw)
        if not isinstance(body, dict):
            raise ValueError("Invalid Cashfree webhook body")
        if body.get("type") != "PAYMENT_SUCCESS_WEBHOOK":
            return {"accepted": True}
        order_id = body["data"]["order"]["order_id"]
        payment_id = str(body["data"]["payment"]["cf_payment_id"])
        if not order_id or not payment_id or body["data"]["payment"]["payment_status"] != "SUCCESS":
            raise ValueError("Invalid success webhook")
        disposition = reconcile_order(db, provider_order_id=order_id, expected_payment_id=payment_id)
        return {"accepted": True, "disposition": disposition}
    except ProviderUnavailable as exc:
        db.rollback()
        raise HTTPException(503, detail=str(exc)) from exc
    except (KeyError, TypeError, ValueError) as exc:
        db.rollback()
        raise HTTPException(422, detail="Invalid Cashfree payment event") from exc
