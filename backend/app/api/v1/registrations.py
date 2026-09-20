from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_optional_current_user, require_csrf, require_roles
from app.config import get_settings
from app.infrastructure.storage.factory import get_storage_service
from app.services.audit_service import record_audit
from app.services.media_service import resolve_media_url
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
    create_guest_batch_registration,
    create_guest_registration,
    list_my_registrations,
    load_confirmation_registration,
    load_registration_batch,
    serialize_registration,
    update_payment_reference,
)
from app.services.ticket_bundle_pdf_service import build_ticket_bundle_pdf
from app.services.ticket_pdf_service import build_ticket_pdf
from app.services.ticket_service import serialize_ticket, verified_ticket_qr_payload
from app.schemas.registrations import (
    BatchRegistrationCreateIn,
    ClaimRegistrationIn,
    ConfirmationLookupIn,
    PaymentReferenceIn,
    RegistrationCreateIn,
)
from app.services.email_service import send_registration_confirmation
from db import get_db
from models import Event, User

router = APIRouter()


def _send_confirmation_email_safe(db: Session, registration) -> str:
    """Send confirmation email without ever failing the registration.

    Returns a user-facing email status: "sent", "delayed", or "failed".
    """
    try:
        result = send_registration_confirmation(db, registration)
    except Exception:
        # Registration must never depend on email. Swallow any unexpected error.
        db.rollback()
        return "failed"

    if result.status == "SENT":
        return "sent"
    if result.status == "PENDING_LIMIT":
        return "delayed"
    if result.status == "SKIPPED_DISABLED":
        return "disabled"
    return "failed"


def _combine_email_statuses(statuses: list[str]) -> str:
    """Combine per-registration email statuses into one overall status.

    Priority (worst first): failed > delayed > disabled > sent.
    """
    if not statuses:
        return "disabled"
    for candidate in ("failed", "delayed", "disabled"):
        if candidate in statuses:
            return candidate
    return "sent"


def _participant_user_id(user: User | None):
    return user.id if user is not None and user.role in {"participant", "user"} else None


def _confirmation_response(
    db: Session,
    registration,
    *,
    confirmation_token: str | None = None,
    claim_code: str | None = None,
    amount_paise: int | None = None,
) -> dict:
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
        "startDate": event.start_date,
        "endDate": event.end_date,
        "location": event.location,
        "address": event.address,
        "city": event.city,
        "state": event.state,
        "country": event.country,
        "description": event.description,
        "rules": event.rules,
        "organizer": event.organization.name,
        "organizerInfo": {
            "name": event.organization.name,
            "website": event.organization.website,
            "logoUrl": resolve_media_url(
                event.organization.logo_url,
                get_storage_service(),
                get_settings().storage_signed_url_ttl_seconds,
            ),
        },
    }
    ticket = serialize_ticket(registration)
    if ticket is not None:
        ticket["name"] = registration.ticket.name
        ticket["category"] = registration.ticket.category.name if registration.ticket.category else None
        ticket["quantity"] = registration.quantity
    result["ticket"] = ticket
    result["event"]["whatsappGroupUrl"] = event.whatsapp_group_url if ticket is not None else None
    payment_settings = None
    if event.payment_settings is not None:
        try:
            payment_settings = build_upi_payment_details(
                event.payment_settings,
                amount_paise=amount_paise if amount_paise is not None else (registration.participant_total_paise or registration.total_amount_paise or 0),
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
    result["ticket"] = ticket
    return result


def _batch_confirmation_response(
    db: Session,
    registrations: list,
    *,
    confirmation_tokens: list[str] | None = None,
    claim_codes: list[str | None] | None = None,
) -> dict:
    tokens = confirmation_tokens or []
    claims = claim_codes or []
    total_amount_paise = sum((registration.participant_total_paise or registration.total_amount_paise or 0) for registration in registrations)
    children = [
        _confirmation_response(
            db,
            registration,
            confirmation_token=tokens[index] if index < len(tokens) and tokens[index] else None,
            claim_code=claims[index] if index < len(claims) and claims[index] else None,
        )
        for index, registration in enumerate(registrations)
    ]
    primary_index = next((index for index, registration in enumerate(registrations) if registration.status in {"awaiting_payment", "pending_verification"}), 0)
    primary = registrations[primary_index]
    result = _confirmation_response(
        db,
        primary,
        confirmation_token=tokens[primary_index] if primary_index < len(tokens) else None,
        claim_code=claims[primary_index] if primary_index < len(claims) else None,
        amount_paise=total_amount_paise,
    )
    result["registrations"] = children
    result["quantity"] = len(registrations)
    return result


@router.post("/registrations", status_code=status.HTTP_201_CREATED)
def create_registration(
    payload: RegistrationCreateIn,
    request: Request,
    user: User | None = Depends(get_optional_current_user),
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
            db, payload, idempotency_key=idempotency_key, user_id=_participant_user_id(user)
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    # Send confirmation email after successful registration.
    # This NEVER fails the registration - errors are logged and reflected in email_status.
    email_status = _send_confirmation_email_safe(db, registration)

    response = _confirmation_response(db, registration, confirmation_token=confirmation_token or None, claim_code=claim_code or None)
    response["emailStatus"] = email_status
    return response


@router.post("/registrations/batch", status_code=status.HTTP_201_CREATED)
def create_batch_registration(
    payload: BatchRegistrationCreateIn,
    request: Request,
    user: User | None = Depends(get_optional_current_user),
    _: None = Depends(require_csrf),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=200),
    db: Session = Depends(get_db),
) -> dict:
    client_ip = request.client.host if request.client else "unknown"
    try:
        for entry in payload.effective_entries:
            enforce_race_registration_limit(
                db,
                event_id=str(payload.event_id),
                ticket_id=str(entry.ticket_id),
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
        registrations, confirmation_tokens, claim_codes = create_guest_batch_registration(
            db, payload, idempotency_key=idempotency_key, user_id=_participant_user_id(user)
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    # Send a confirmation email per registration. Never fails the registration.
    email_statuses = [_send_confirmation_email_safe(db, reg) for reg in registrations]
    # Overall email status: worst-case wins (failed > delayed > disabled > sent).
    overall_email_status = _combine_email_statuses(email_statuses)

    response = _batch_confirmation_response(
        db,
        registrations,
        confirmation_tokens=confirmation_tokens,
        claim_codes=claim_codes,
    )
    response["emailStatus"] = overall_email_status
    return response


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
    return _batch_confirmation_response(db, load_registration_batch(db, registration))


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
    return _batch_confirmation_response(db, load_registration_batch(db, registration))


@router.post("/registrations/confirmation/ticket.pdf")
def download_confirmation_ticket(
    payload: ConfirmationLookupIn,
    request: Request,
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> Response:
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
            action="ticket_pdf_lookup_failed",
            resource_type="registration",
            resource_id=None,
            metadata={"credential_valid": False},
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Registration not found")

    registrations = load_registration_batch(db, registration)
    if any(child.status not in {"confirmed", "checked_in"} for child in registrations):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ticket PDFs are available only after every rider registration is confirmed",
        )

    event = db.scalar(
        select(Event)
        .options(selectinload(Event.organization))
        .where(Event.id == registration.event_id)
    )
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    qr_payloads: list[str] = []
    try:
        for child in registrations:
            qr_payload = verified_ticket_qr_payload(child)
            if qr_payload is None:
                raise ValueError("The ticket credential is temporarily unavailable")
            qr_payloads.append(qr_payload)
        pdf = (
            build_ticket_bundle_pdf(registrations, event, qr_payloads)
            if len(registrations) > 1
            else build_ticket_pdf(registrations[0], event, qr_payloads[0])
        )
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The ticket credential is temporarily unavailable",
        ) from exc

    for child in registrations:
        record_audit(
            db,
            actor_user_id=None,
            action="ticket_pdf_downloaded",
            resource_type="registration",
            resource_id=child.id,
            metadata={"status": child.status, "registration_count": len(registrations)},
        )
    db.commit()
    if len(registrations) > 1:
        filename = "sportpass-tickets.pdf"
    else:
        reference = registrations[0].registration_reference or "registration"
        safe_reference = "".join(character if character.isalnum() or character in "-_." else "-" for character in reference)
        filename = f"sportpass-ticket-{safe_reference}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


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
