from __future__ import annotations

from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_authorized_event, get_authorized_organization, get_current_user, require_csrf, require_roles
from app.config import get_settings
from app.infrastructure.storage.factory import get_storage_service
from app.schemas.checkins import CheckpointCreateIn, CheckpointUpdateIn
from app.schemas.registrations import ManualRegistrationCreateIn, PaymentDecisionIn
from app.services.auth_service import utc_now
from app.services.checkpoint_service import (
    create_event_checkpoint,
    delete_event_checkpoint,
    get_event_checkin_matrix,
    get_registration_checkin_timeline,
    list_event_checkpoints,
    update_event_checkpoint,
)
from app.services.pricing_service import get_organizer_pricing
from app.services.platform_fee_service import list_organizer_platform_fees
from app.services.rate_limit_service import RateLimitExceeded, enforce_payment_decision_limit
from app.services.registration_service import (
    CsvExportTooLargeError,
    decide_registration_payment,
    export_organizer_registrations_csv,
    list_organizer_registrations,
    serialize_organizer_registration,
    create_manual_registration,
)
from app.services.image_validation import ImageValidationError
from app.services.media_service import resolve_media_url, upload_media
from app.services.storage_service import StorageError
from app.services.audit_service import record_audit
from db import get_db
from models import Organization, OrganizationMember, User

router = APIRouter()


class OrganizationProfileIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    organization_type: str = Field(min_length=2, max_length=80)
    city: str = Field(min_length=2, max_length=120)
    state: str = Field(min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    website: str | None = Field(default=None, max_length=320)

    @field_validator("name", "organization_type", "city", "state")
    @classmethod
    def normalize_required_text(cls, value: str, info) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError(f"{info.field_name.replace('_', ' ').capitalize()} is required")
        return normalized

    @field_validator("description", "website")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("website")
    @classmethod
    def validate_website(cls, value: str | None) -> str | None:
        if value is None:
            return None
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("Website must be a complete http:// or https:// URL")
        return value


def _serialize_organization(organization: Organization, storage=None) -> dict:
    onboarding_complete = bool(
        organization.onboarding_completed_at
        and organization.organization_type
        and organization.city
        and organization.state
    )
    return {
        "id": str(organization.id),
        "name": organization.name,
        "organizationType": organization.organization_type,
        "city": organization.city,
        "state": organization.state,
        "description": organization.description,
        "website": organization.website,
        "logoUrl": resolve_media_url(organization.logo_url, storage, get_settings().storage_signed_url_ttl_seconds),
        "status": organization.status,
        "onboardingStatus": "completed" if onboarding_complete else "pending",
        "onboardingCompletedAt": organization.onboarding_completed_at.isoformat() if onboarding_complete else None,
    }


@router.get("/organizations")
def list_my_organizations(
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
    storage=Depends(get_storage_service),
) -> list[dict]:
    if user.role == "admin":
        organizations = db.scalars(select(Organization).order_by(Organization.created_at.desc())).all()
    else:
        organizations = db.scalars(
            select(Organization)
            .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
            .where(OrganizationMember.user_id == user.id, Organization.status == "active")
            .order_by(Organization.created_at.desc())
        ).all()
    return [_serialize_organization(item, storage) for item in organizations]


@router.get("/organizations/{organization_id}")
def get_my_organization(
    organization_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
    storage=Depends(get_storage_service),
) -> dict:
    try:
        organization = get_authorized_organization(db, user, organization_id)
    except HTTPException:
        raise
    return _serialize_organization(organization)


@router.put("/organizations/{organization_id}")
def update_my_organization(
    organization_id: UUID,
    payload: OrganizationProfileIn,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    storage=Depends(get_storage_service),
) -> dict:
    try:
        organization = get_authorized_organization(db, user, organization_id)
    except HTTPException:
        raise
    organization.name = payload.name
    organization.organization_type = payload.organization_type
    organization.city = payload.city
    organization.state = payload.state
    organization.description = payload.description
    organization.website = payload.website
    organization.onboarding_completed_at = utc_now()
    db.commit()
    db.refresh(organization)
    return _serialize_organization(organization, storage)


class PaidVerificationIn(BaseModel):
    pan_number: str = Field(min_length=10, max_length=10)
    name_as_per_pan: str = Field(min_length=2, max_length=200)
    gst_registered: bool = Field(default=False)
    gst_number: str | None = Field(default=None, max_length=15)
    billing_name: str = Field(min_length=2, max_length=200)
    billing_address: str = Field(min_length=5, max_length=1000)
    billing_city: str = Field(min_length=2, max_length=120)
    billing_state: str = Field(min_length=2, max_length=120)
    billing_pincode: str = Field(min_length=6, max_length=10)
    accept_terms: bool = Field(...)
    terms_accepted_at: str | None = Field(default=None, description="ISO format timestamp when terms were accepted")

    @field_validator("gst_number")
    @classmethod
    def _require_gst_when_registered(cls, value: str | None, info) -> str | None:
        if info.data.get("gst_registered") and not (value and value.strip()):
            raise ValueError("GSTIN is required when GST registered is Yes")
        return value


@router.get("/organizations/{organization_id}/paid-verification")
def get_paid_verification_status(
    organization_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
) -> dict:
    """Get the paid verification status of an organization."""
    organization = get_authorized_organization(db, user, organization_id)
    return {
        "organizationId": str(organization.id),
        "paidVerificationStatus": organization.paid_verification_status,
        "panNumber": organization.pan_number,
        "nameAsPerPan": organization.name_as_per_pan,
        "gstRegistered": organization.gst_registered,
        "gstNumber": organization.gst_number,
        "billingName": organization.billing_name,
        "billingAddress": organization.billing_address,
        "billingCity": organization.billing_city,
        "billingState": organization.billing_state,
        "billingPincode": organization.billing_pincode,
        "submittedAt": organization.paid_verification_submitted_at.isoformat() if organization.paid_verification_submitted_at else None,
        "reviewedAt": organization.paid_verification_reviewed_at.isoformat() if organization.paid_verification_reviewed_at else None,
        "rejectionReason": organization.paid_verification_rejection_reason,
    }


@router.post("/organizations/{organization_id}/paid-verification", status_code=status.HTTP_201_CREATED)
def submit_paid_verification(
    organization_id: UUID,
    payload: PaidVerificationIn,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    """Submit paid organizer verification details."""
    if not payload.accept_terms:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="You must accept the Organizer Terms to proceed")
    
    organization = get_authorized_organization(db, user, organization_id)
    
    # Check if already verified or under review
    if organization.paid_verification_status in ("UNDER_REVIEW", "VERIFIED"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Paid verification is already {organization.paid_verification_status.lower().replace('_', ' ')}"
        )
    
    # Update organization with verification details
    organization.pan_number = payload.pan_number.upper()
    organization.name_as_per_pan = payload.name_as_per_pan.strip()
    organization.gst_registered = payload.gst_registered
    organization.gst_number = payload.gst_number.upper() if (payload.gst_registered and payload.gst_number) else None
    organization.billing_name = payload.billing_name.strip()
    organization.billing_address = payload.billing_address.strip()
    organization.billing_city = payload.billing_city.strip()
    organization.billing_state = payload.billing_state.strip()
    organization.billing_pincode = payload.billing_pincode.strip()
    organization.paid_verification_status = "UNDER_REVIEW"
    organization.paid_verification_submitted_at = utc_now()
    
    record_audit(
        db,
        actor_user_id=user.id,
        action="paid_verification_submitted",
        resource_type="organization",
        resource_id=organization.id,
        metadata={
            "status": "UNDER_REVIEW",
            "terms_accepted": payload.accept_terms,
        },
    )
    
    db.commit()
    return {
        "organizationId": str(organization.id),
        "paidVerificationStatus": organization.paid_verification_status,
        "submittedAt": organization.paid_verification_submitted_at.isoformat(),
    }


@router.get("/me")
def organizer_me(user: User = Depends(get_current_user)) -> dict:
    return {"id": str(user.id), "name": user.name, "email": user.email, "role": user.role}


@router.get("/events/{event_id}/checkpoints")
def event_checkpoints(
    event_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return list_event_checkpoints(db, user, event_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/events/{event_id}/checkpoints", status_code=status.HTTP_201_CREATED)
def create_checkpoint(
    event_id: UUID,
    payload: CheckpointCreateIn,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    try:
        checkpoint = create_event_checkpoint(
            db, user, event_id, name=payload.name, position=payload.position, addon_id=payload.addon_id
        )
        db.commit()
        return checkpoint
    except ValueError as exc:
        db.rollback()
        code = status.HTTP_404_NOT_FOUND if str(exc) == "Event not found" else status.HTTP_409_CONFLICT if "already exists" in str(exc) else status.HTTP_422_UNPROCESSABLE_ENTITY
        raise HTTPException(status_code=code, detail=str(exc)) from exc


@router.put("/events/{event_id}/checkpoints/{checkpoint_id}")
def update_checkpoint(
    event_id: UUID,
    checkpoint_id: UUID,
    payload: CheckpointUpdateIn,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    try:
        checkpoint = update_event_checkpoint(db, user, event_id, checkpoint_id, name=payload.name, position=payload.position)
        db.commit()
        return checkpoint
    except ValueError as exc:
        db.rollback()
        code = status.HTTP_404_NOT_FOUND if str(exc) in {"Event not found", "Checkpoint not found"} else status.HTTP_409_CONFLICT if "already exists" in str(exc) else status.HTTP_422_UNPROCESSABLE_ENTITY
        raise HTTPException(status_code=code, detail=str(exc)) from exc


@router.delete("/events/{event_id}/checkpoints/{checkpoint_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_checkpoint(
    event_id: UUID,
    checkpoint_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> Response:
    try:
        delete_event_checkpoint(db, user, event_id, checkpoint_id)
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except ValueError as exc:
        db.rollback()
        code = status.HTTP_404_NOT_FOUND if str(exc) in {"Event not found", "Checkpoint not found"} else status.HTTP_409_CONFLICT
        raise HTTPException(status_code=code, detail=str(exc)) from exc


@router.get("/events/{event_id}/check-in-matrix")
def event_checkin_matrix(
    event_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return get_event_checkin_matrix(db, user, event_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/registrations/{registration_id}/check-in-timeline")
def registration_checkin_timeline(
    registration_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return get_registration_checkin_timeline(db, user, registration_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/events/{event_id}/registrations/manual", status_code=201)
def create_manual_event_registration(
    event_id: UUID,
    payload: ManualRegistrationCreateIn,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=200),
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    get_authorized_event(db, user, event_id)
    if payload.event_id != event_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Event id does not match the route")
    try:
        registration, event = create_manual_registration(db, user, payload, idempotency_key=idempotency_key)
    except ValueError as exc:
        db.rollback()
        code = status.HTTP_404_NOT_FOUND if str(exc) in {"Event or ticket not found", "Event is not available for registration"} else status.HTTP_422_UNPROCESSABLE_ENTITY
        raise HTTPException(status_code=code, detail=str(exc)) from exc
    return serialize_organizer_registration(registration, event)


@router.get("/registrations")
def organizer_registrations(
    event_id: UUID | None = None,
    category_id: UUID | None = None,
    ticket_id: UUID | None = None,
    status_filter: str | None = Query(default=None, alias="status", max_length=30),
    search: str | None = Query(default=None, alias="q", max_length=120),
    participant_search: str | None = Query(default=None, alias="participant", max_length=120),
    email_search: str | None = Query(default=None, alias="email", max_length=320),
    phone_search: str | None = Query(default=None, alias="phone", max_length=40),
    registration_reference: str | None = Query(default=None, alias="registration_reference", max_length=80),
    payment_status: str | None = Query(default=None, max_length=30),
    check_in_status: str | None = Query(default=None, alias="check_in_status", max_length=30),
    page_size: int = Query(default=50, ge=1, le=100),
    legacy_limit: int | None = Query(default=None, alias="limit", ge=1, le=100),
    cursor: str | None = Query(default=None, max_length=512),
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return list_organizer_registrations(
            db,
            user,
            event_id=event_id,
            category_id=category_id,
            ticket_id=ticket_id,
            status_filter=status_filter,
            search=search,
            participant_search=participant_search,
            email_search=email_search,
            phone_search=phone_search,
            registration_reference=registration_reference,
            payment_status=payment_status,
            check_in_status=check_in_status,
            page_size=legacy_limit or page_size,
            cursor=cursor,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.get("/events/{event_id}/registrations.csv")
def export_registrations_csv(
    event_id: UUID,
    category_id: UUID | None = None,
    ticket_id: UUID | None = None,
    status_filter: str | None = Query(default=None, alias="status", max_length=30),
    search: str | None = Query(default=None, alias="q", max_length=120),
    participant_search: str | None = Query(default=None, alias="participant", max_length=120),
    email_search: str | None = Query(default=None, alias="email", max_length=320),
    phone_search: str | None = Query(default=None, alias="phone", max_length=40),
    registration_reference: str | None = Query(default=None, alias="registration_reference", max_length=80),
    payment_status: str | None = Query(default=None, max_length=30),
    check_in_status: str | None = Query(default=None, alias="check_in_status", max_length=30),
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
) -> Response:
    try:
        csv_content = export_organizer_registrations_csv(
            db,
            user,
            event_id=event_id,
            category_id=category_id,
            ticket_id=ticket_id,
            status_filter=status_filter,
            search=search,
            participant_search=participant_search,
            email_search=email_search,
            phone_search=phone_search,
            registration_reference=registration_reference,
            payment_status=payment_status,
            check_in_status=check_in_status,
        )
    except CsvExportTooLargeError as exc:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=str(exc)) from exc
    except ValueError as exc:
        code = status.HTTP_404_NOT_FOUND if str(exc) == "Event not found" else status.HTTP_422_UNPROCESSABLE_ENTITY
        raise HTTPException(status_code=code, detail=str(exc)) from exc
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="registrations-{event_id}.csv"',
            "Cache-Control": "no-store",
        },
    )


def _decide_registration(
    event_id: UUID,
    registration_id: UUID,
    decision: str,
    payload: PaymentDecisionIn,
    user: User,
    db: Session,
    client_ip: str,
) -> dict:
    try:
        enforce_payment_decision_limit(
            db,
            registration_id=str(registration_id),
            user_id=str(user.id),
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
        registration, event = decide_registration_payment(
            db,
            user,
            event_id,
            registration_id,
            decision=decision,
            reason=payload.reason,
        )
    except ValueError as exc:
        db.rollback()
        code = status.HTTP_404_NOT_FOUND if str(exc) == "Registration not found" else status.HTTP_409_CONFLICT
        raise HTTPException(status_code=code, detail=str(exc)) from exc
    return serialize_organizer_registration(registration, event)


@router.post("/events/{event_id}/registrations/{registration_id}/approve")
def approve_registration(
    event_id: UUID,
    registration_id: UUID,
    request: Request,
    payload: PaymentDecisionIn = PaymentDecisionIn(),
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    get_authorized_event(db, user, event_id)
    return _decide_registration(event_id, registration_id, "approve", payload, user, db, request.client.host if request.client else "unknown")


@router.post("/events/{event_id}/registrations/{registration_id}/reject")
def reject_registration(
    event_id: UUID,
    registration_id: UUID,
    payload: PaymentDecisionIn,
    request: Request,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    get_authorized_event(db, user, event_id)
    return _decide_registration(event_id, registration_id, "reject", payload, user, db, request.client.host if request.client else "unknown")


@router.get("/pricing")
def organizer_pricing(
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
) -> dict:
    return get_organizer_pricing(db, user)


@router.get("/platform-fees")
def organizer_platform_fees(
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
) -> dict:
    """Organizer-scoped SportPass platform-fee accruals and bills.

    Admins see every organization's records; organizers only see the
    organizations they are a member of.
    """
    if user.role == "admin":
        organization_ids = list(db.scalars(select(Organization.id).where(Organization.status == "active")).all())
    else:
        organization_ids = list(
            db.scalars(
                select(Organization.id)
                .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
                .where(
                    OrganizationMember.user_id == user.id,
                    OrganizationMember.member_role == "organizer",
                    Organization.status == "active",
                )
            ).all()
        )
    return list_organizer_platform_fees(db, organization_ids)


@router.post("/organizations/{organization_id}/logo")
def upload_organization_logo(
    organization_id: UUID,
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    storage=Depends(get_storage_service),
) -> dict:
    organization = get_authorized_organization(db, user, organization_id)
    settings = get_settings()
    payload = file.file.read(settings.storage_max_upload_bytes + 1)
    try:
        uploaded = upload_media(
            db,
            owner=organization,
            owner_type="organization",
            owner_id=organization.id,
            reference_field="logo_url",
            actor_user_id=user.id,
            payload=payload,
            filename=file.filename,
            content_type=file.content_type,
            purpose="organization-logo",
            storage=storage,
            max_upload_bytes=settings.storage_max_upload_bytes,
            max_dimension=settings.storage_max_dimension,
            signed_url_ttl_seconds=settings.storage_signed_url_ttl_seconds,
            request_id=getattr(request.state, "request_id", None),
        )
    except ImageValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except StorageError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return {
        "organizationId": str(organization.id),
        "logoUrl": uploaded.url,
        "contentType": uploaded.content_type,
        "sizeBytes": uploaded.size_bytes,
        "width": uploaded.width,
        "height": uploaded.height,
    }


class EventUpdateEmailIn(BaseModel):
    subject: str = Field(min_length=3, max_length=200)
    message: str = Field(min_length=1, max_length=10000)


@router.get("/events/{event_id}/email-recipients")
def get_event_email_recipients(
    event_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
) -> dict:
    """Return the number of unique registrant emails for an event."""
    from app.services.email_service import get_event_recipients

    get_authorized_event(db, user, event_id)
    recipients = get_event_recipients(db, event_id)
    return {"eventId": str(event_id), "recipientCount": len(recipients)}


@router.post("/events/{event_id}/registrations/{registration_id}/resend-email")
def resend_registration_email(
    event_id: UUID,
    registration_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    """Re-send the confirmation (ticket) email to a single registrant."""
    from app.services.email_service import send_registration_confirmation
    from models import Registration

    get_authorized_event(db, user, event_id)
    registration = db.get(Registration, registration_id)
    if registration is None or registration.event_id != event_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Registration not found")

    result = send_registration_confirmation(db, registration, is_resend=True)
    # Map to a user-facing status the organizer UI can display.
    ui_status = {
        "SENT": "sent",
        "PENDING_LIMIT": "delayed",
        "SKIPPED_DISABLED": "disabled",
        "FAILED": "failed",
    }.get(result.status, "failed")
    return {
        "registrationId": str(registration_id),
        "emailStatus": registration.email_status,
        "result": ui_status,
        "message": result.message,
    }


@router.post("/events/{event_id}/resend-failed-emails")
def resend_failed_event_emails(
    event_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    """Re-send confirmation emails for registrations whose email FAILED or is PENDING_LIMIT."""
    from app.services.email_service import send_registration_confirmation
    from models import Registration

    get_authorized_event(db, user, event_id)

    registrations = db.scalars(
        select(Registration).where(
            Registration.event_id == event_id,
            Registration.email_status.in_(("FAILED", "PENDING_LIMIT")),
        )
    ).all()

    sent = 0
    delayed = 0
    failed = 0
    for registration in registrations:
        result = send_registration_confirmation(db, registration, is_resend=True)
        if result.status == "SENT":
            sent += 1
        elif result.status == "PENDING_LIMIT":
            delayed += 1
        else:
            failed += 1

    return {
        "eventId": str(event_id),
        "attempted": len(registrations),
        "sent": sent,
        "delayed": delayed,
        "failed": failed,
    }


@router.post("/events/{event_id}/broadcast-email")
def broadcast_event_email(
    event_id: UUID,
    payload: EventUpdateEmailIn,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    """Send an update email to all registrants of an event."""
    from app.services.email_service import broadcast_event_update

    get_authorized_event(db, user, event_id)

    # Simple HTML wrapper so the message renders nicely; the plain body is the raw message.
    html_body = (
        '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111;">'
        f"<p>{payload.message.replace(chr(10), '<br>')}</p>"
        '<p style="color:#666;font-size:13px;margin-top:16px;">Sent via SportPass India.</p>'
        "</div>"
    )

    summary = broadcast_event_update(
        db,
        event_id=event_id,
        subject=payload.subject,
        body=payload.message,
        html_body=html_body,
    )
    return summary
