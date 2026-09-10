from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_csrf, require_roles
from app.config import get_settings
from app.infrastructure.storage.factory import get_storage_service
from app.services.audit_service import record_audit
from app.services.organization_qr_service import qr_image_response
from app.services.payment_service import build_upi_payment_details
from app.services.rate_limit_service import (
    RateLimitExceeded,
    enforce_claim_attempt_limit,
    enforce_confirmation_lookup_limit,
    enforce_payment_reference_limit,
    enforce_race_registration_limit,
)
from app.services.registration_service import (
    claim_registration,
    create_guest_registration,
    list_my_registrations,
    load_confirmation_registration,
    serialize_registration,
    update_payment_reference,
)
from app.services.ticket_service import serialize_ticket
from db import get_db
from models import Event

router = APIRouter()


def _confirmation_response(db: Session, registration, *, confirmation_token: str | None = None, claim_code: str | None = None) -> dict:
    event = db.scalar(
        select(Event)
        .options(selectinload(Event.organization), selectinload(Event.payment_settings))
        .where(Event.id == registration.event_id)
    )
    result = serialize_registration(registration, confirmation_token=confirmation_token, claim_code=claim_code)
    result["event"] = {
        "id": str(event.id),
        "name": event.name,
        "date": event.date,
        "location": event.location,
        "organizer": event.organization.name,
    }
    payment_settings = None
    if event.payment_settings is not None:
        try:
            payment_settings = build_upi_payment_details(
                event.payment_settings,
                amount_paise=registration.total_amount_paise or 0,
                registration_reference=registration.registration_reference or "",
            )
        except ValueError:
            # Never expose unusable payment settings; organizer configuration must be fixed before payment.
            payment_settings = None
        if payment_settings is not None:
            signed_qr = qr_image_response(
                event.payment_settings,
                get_storage_service(),
                get_settings().storage_signed_url_ttl_seconds,
            )
            payment_settings["qrImageUrl"] = signed_qr["qrImageUrl"]
            payment_settings["qrImageExpiresAt"] = signed_qr["qrImageExpiresAt"]
    result["paymentSettings"] = payment_settings
    result["ticket"] = serialize_ticket(registration)
    return result


@router.post("/registrations", status_code=status.HTTP_201_CREATED)
def create_registration(
    payload: RegistrationCreateIn,
    request: Request,
    _: None = Depends(require_csrf),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=200),
    db: Session = Depends(get_db),
) -> dict:
    client_ip = request.client.host if request.client else "unknown"
    try:
        enforce_race_registration_limit(
            db,
            event_id=str(payload.event_id),
            ticket_id=str(payload.ticket_id),
            client_ip=client_ip,
        )
        db.commit()
    except RateLimitExceeded as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    try:
        registration, confirmation_token, claim_code = create_guest_registration(
            db, payload, idempotency_key=idempotency_key
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return _confirmation_response(db, registration, confirmation_token=confirmation_token or None, claim_code=claim_code or None)


@router.post("/registrations/payment-reference")
def submit_payment_reference(
    payload: PaymentReferenceIn,
    request: Request,
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    client_ip = request.client.host if request.client else "unknown"
    try:
        enforce_payment_reference_limit(
            db,
            confirmation_token=payload.confirmation_token,
            client_ip=client_ip,
        )
        # Keep the durable rate-limit increment even when the protected update fails.
        db.commit()
        registration = update_payment_reference(db, payload.confirmation_token, payload.utr_reference)
    except RateLimitExceeded as exc:
        db.rollback()
        raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=str(exc),
                headers={"Retry-After": str(exc.retry_after_seconds)},
            ) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return _confirmation_response(db, registration)


@router.post("/registrations/confirmation")
def get_confirmation(
    payload: ConfirmationLookupIn,
    request: Request,
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    client_ip = request.client.host if request.client else "unknown"
    try:
        enforce_confirmation_lookup_limit(
            db,
            confirmation_token=payload.confirmation_token,
            client_ip=client_ip,
        )
        db.commit()
    except RateLimitExceeded as exc:
        db.rollback()
        raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=str(exc),
                headers={"Retry-After": str(exc.retry_after_seconds)},
            ) from exc

    registration = load_confirmation_registration(db, payload.confirmation_token)
    if registration is None:
        record_audit(
            db,
            actor_user_id=None,
            action="confirmation_lookup_failed",
            resource_type="registration",
            resource_id=None,
            metadata={"credential_valid": False},
        )
        db.commit()
        raise HTTPException(status_code=404, detail="Registration not found")
    record_audit(
        db,
        actor_user_id=None,
        action="confirmation_viewed",
        resource_type="registration",
        resource_id=registration.id,
        metadata={"status": registration.status},
    )
    db.commit()
    return _confirmation_response(db, registration)


@router.get("/registrations/me")
def get_my_registrations(
    user=Depends(require_roles("participant", "user")),
    db: Session = Depends(get_db),
) -> list[dict]:
    return list_my_registrations(db, user)


@router.post("/registrations/claim")
def claim_guest_registration(
    payload: ClaimRegistrationIn,
    request: Request,
    user=Depends(require_roles("participant", "user")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    client_ip = request.client.host if request.client else "unknown"
    try:
        enforce_claim_attempt_limit(
            db,
            registration_reference=payload.registration_reference,
            claim_code=payload.claim_code,
            user_id=str(user.id),
            client_ip=client_ip,
        )
        db.commit()
        return claim_registration(
            db,
            user,
            registration_reference=payload.registration_reference,
            claim_code=payload.claim_code,
        )
    except RateLimitExceeded as exc:
        db.rollback()
        raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=str(exc),
                headers={"Retry-After": str(exc.retry_after_seconds)},
            ) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Registration not found or claim failed") from exc
