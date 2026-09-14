from __future__ import annotations

from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, Response, UploadFile, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_authorized_event, get_authorized_organization, get_current_user, require_csrf, require_roles
from app.config import get_settings
from app.infrastructure.storage.factory import get_storage_service
from app.schemas.registrations import ManualRegistrationCreateIn, PaymentDecisionIn
from app.services.auth_service import utc_now
from app.services.pricing_service import get_organizer_pricing
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


@router.get("/me")
def organizer_me(user: User = Depends(get_current_user)) -> dict:
    return {"id": str(user.id), "name": user.name, "email": user.email, "role": user.role}


@router.post("/events/{event_id}/registrations/manual", status_code=status.HTTP_201_CREATED)
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
