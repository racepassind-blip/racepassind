"""Cashfree checkout and webhook ingress; browser data is never payment evidence."""
from __future__ import annotations

import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import require_csrf, require_roles
from app.config import get_settings
from app.services.cashfree_gateway import CashfreeGateway, ProviderUnavailable
from app.services.cashfree_registration_service import payment_for_token, reconcile_order, start_checkout
from app.services.cashfree_refunds import reconcile_cashfree_refund
from db import get_db

router = APIRouter()


@router.post("/admin/refunds/{refund_id}/cashfree/process")
def process_cashfree_refund(refund_id: UUID, user=Depends(require_roles("admin")),
                            _: None = Depends(require_csrf), db: Session = Depends(get_db)):
    try:
        return {"providerStatus": reconcile_cashfree_refund(db, refund_id=refund_id,
                                                               initiate=True, actor_user_id=user.id)}
    except ValueError as exc:
        db.rollback()
        raise HTTPException(422, detail=str(exc)) from exc


@router.post("/admin/refunds/{refund_id}/cashfree/reconcile")
def poll_cashfree_refund(refund_id: UUID, user=Depends(require_roles("admin")),
                         _: None = Depends(require_csrf), db: Session = Depends(get_db)):
    try:
        return {"providerStatus": reconcile_cashfree_refund(db, refund_id=refund_id,
                                                               initiate=False, actor_user_id=user.id)}
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
    except ValueError as exc:
        db.rollback()
        raise HTTPException(422, detail=str(exc)) from exc


@router.post("/registrations/cashfree/status")
def cashfree_status(payload: CheckoutToken, _: None = Depends(require_csrf), db: Session = Depends(get_db)):
    try:
        payment, _ = payment_for_token(db, payload.confirmation_token)
        if payment.status == "awaiting" and payment.provider_order_id:
            try:
                reconcile_order(db, provider_order_id=payment.provider_order_id)
            except ProviderUnavailable as exc:
                if "No verified successful" not in str(exc):
                    raise
        db.refresh(payment)
        return {"status": payment.status}
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
    except (KeyError, TypeError, ValueError) as exc:
        db.rollback()
        raise HTTPException(422, detail="Invalid Cashfree payment event") from exc
    except ProviderUnavailable as exc:
        db.rollback()
        raise HTTPException(503, detail=str(exc)) from exc
