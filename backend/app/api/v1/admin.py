from __future__ import annotations

import datetime as dt
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, StrictInt, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_csrf, require_roles
from app.services.admin_dashboard_service import get_admin_dashboard
from app.services.admin_organizers_service import get_admin_organizers_overview
from app.services.audit_service import record_audit
from app.services.auth_service import hash_password, normalize_email, normalize_phone, public_user, utc_now, validate_required_phone
from app.services.communication_service import (
    get_communication_settings,
    send_test_email,
    update_email_settings,
)
from app.services.email_service import get_email_limit_status, retry_pending_emails, EMAIL_HARD_LIMIT, EMAIL_WARNING_LIMIT
from app.services.organization_fee_service import (
    OrganizationFeeValidationError,
    OrganizationNotFoundError,
    serialize_organization_fee,
    update_organization_fee_settings,
)
from app.services.platform_fee_service import (
    PlatformFeeValidationError,
    apply_discount as apply_platform_fee_discount,
    get_config as get_platform_fee_config,
    list_admin_platform_fees,
    mark_overdue as mark_platform_fee_overdue,
    mark_paid as mark_platform_fee_paid,
    raise_bill as raise_platform_fee_bill,
    set_due_date as set_platform_fee_due_date,
    update_config as update_platform_fee_config,
    waive_bill as waive_platform_fee_bill,
)
from app.services.pricing_service import (
    PricingValidationError,
    get_admin_pricing,
    serialize_plan,
    update_founding_program,
    update_plan,
)
from db import get_db
from app.services.event_archive_service import restore_event_record
from models import Event, FoundingProgram, OrganizerApplication, Organization, OrganizationMember, PricingPlan, User

router = APIRouter()


@router.get("/dashboard")
def admin_dashboard(
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    return get_admin_dashboard(db)


def _serialize_admin_event(event: Event) -> dict:
    return {
        "id": str(event.id),
        "name": event.name,
        "organization": {
            "id": str(event.organization.id),
            "name": event.organization.name,
        },
        "eventDate": event.date,
        "status": event.status,
        "registrationStatus": event.registration_status,
        "archivedAt": event.archived_at.isoformat() if event.archived_at else None,
        "isArchived": event.archived_at is not None,
        "participantCount": event.participants,
        "featuresUnlocked": event.features_unlocked,
    }


@router.get("/events")
def list_admin_events(
    archived: bool | None = Query(default=True),
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> list[dict]:
    query = (
        select(Event)
        .options(selectinload(Event.organization))
        .order_by(Event.archived_at.desc().nullslast(), Event.created_at.desc(), Event.id.desc())
    )
    if archived is True:
        query = query.where(Event.archived_at.is_not(None))
    elif archived is False:
        query = query.where(Event.archived_at.is_(None))
    return [_serialize_admin_event(event) for event in db.scalars(query).all()]


@router.post("/events/{event_id}/restore")
def restore_admin_event(
    event_id: UUID,
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if event.archived_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Event is not archived")

    restore_event_record(db, event, admin.id)
    db.commit()
    return {
        "id": str(event.id),
        "status": event.status,
        "archivedAt": None,
        "isArchived": False,
    }


class EventFeatureOverrideIn(BaseModel):
    features_unlocked: bool


@router.post("/events/{event_id}/feature-override")
def set_event_feature_override(
    event_id: UUID,
    payload: EventFeatureOverrideIn,
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    """Admin override to unlock all paid-only features for an event regardless of free/paid status."""
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    previous = event.features_unlocked
    if previous != payload.features_unlocked:
        event.features_unlocked = payload.features_unlocked
        record_audit(
            db,
            actor_user_id=admin.id,
            action="event_features_unlocked" if payload.features_unlocked else "event_features_locked",
            resource_type="event",
            resource_id=event.id,
            metadata={"previous": previous, "featuresUnlocked": payload.features_unlocked},
        )
        db.commit()
    return {"id": str(event.id), "featuresUnlocked": event.features_unlocked}


class OrganizerCreateIn(BaseModel):
    organization_name: str = Field(min_length=2, max_length=160)
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=320)
    # Organizer onboarding requires a contact phone number.
    phone: str = Field(min_length=1, max_length=32)
    temporary_password: str = Field(min_length=8, max_length=256)

    @field_validator("phone")
    @classmethod
    def _require_phone(cls, value: str) -> str:
        return validate_required_phone(value)


class FeeSettingsIn(BaseModel):
    fee_type: Literal["none", "fixed_per_registration", "percentage"]
    fee_value_paise: StrictInt = Field(default=0, ge=0)
    fee_percentage_basis_points: StrictInt = Field(default=0, ge=0, le=10_000)


class PricingPlanIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    min_confirmed_registrations: StrictInt = Field(ge=0)
    max_confirmed_registrations: StrictInt | None = Field(default=None, ge=0)
    price_paise: StrictInt = Field(ge=0)
    billing_unit: Literal["per_event", "per_registration"] = "per_event"
    active: bool = True
    sort_order: StrictInt = Field(ge=0)


class FoundingProgramIn(BaseModel):
    enabled: bool
    free_races_count: StrictInt = Field(ge=0, le=100)
    default_discount_basis_points: StrictInt = Field(ge=0, le=10_000)
    eligible_organization_ids: list[UUID] = Field(default_factory=list)


@router.post("/organizers", status_code=status.HTTP_201_CREATED)
def create_organizer(
    payload: OrganizerCreateIn,
    response: Response,
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    email = normalize_email(payload.email)
    if db.scalar(select(User).where(User.normalized_email == email)) is not None:
        raise HTTPException(status_code=409, detail="An account with that email already exists")

    organizer = User(
        name=payload.name.strip(),
        email=email,
        normalized_email=email,
        phone=payload.phone.strip() if payload.phone else None,
        normalized_phone=normalize_phone(payload.phone),
        password_hash=hash_password(payload.temporary_password),
        role="organizer",
        is_active=True,
    )
    organization = Organization(
        name=payload.organization_name.strip(),
        created_by=admin.id,
        status="active",
        fee_type="none",
        fee_value_paise=0,
        fee_percentage_basis_points=0,
    )
    db.add_all([organizer, organization])
    try:
        db.flush()
        db.add(OrganizationMember(organization_id=organization.id, user_id=organizer.id, member_role="organizer"))
        record_audit(
            db,
            actor_user_id=admin.id,
            action="organizer_created",
            resource_type="organization",
            resource_id=organization.id,
            metadata={"organization_status": organization.status},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Organizer could not be created") from exc

    return {
        "organizer": public_user(organizer),
        "organization": {"id": str(organization.id), "name": organization.name, "status": organization.status},
    }


class OrganizerApplicationDecisionIn(BaseModel):
    reason: str | None = Field(default=None, max_length=2000)


def _serialize_organizer_application(application: OrganizerApplication) -> dict:
    return {
        "id": str(application.id),
        "organizationName": application.organization_name,
        "applicantName": application.applicant_name,
        "email": application.email,
        "phone": application.phone,
        "message": application.message,
        "status": application.status,
        "rejectionReason": application.rejection_reason,
        "createdAt": application.created_at.isoformat() if application.created_at else None,
        "reviewedAt": application.reviewed_at.isoformat() if application.reviewed_at else None,
    }


@router.get("/organizer-applications")
def list_organizer_applications(
    application_status: Literal["pending", "approved", "rejected"] | None = Query(default=None, alias="status"),
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> list[dict]:
    query = select(OrganizerApplication).order_by(OrganizerApplication.created_at.desc())
    if application_status is not None:
        query = query.where(OrganizerApplication.status == application_status)
    applications = db.scalars(query).all()
    return [_serialize_organizer_application(application) for application in applications]


@router.post("/organizer-applications/{application_id}/approve")
def approve_organizer_application(
    application_id: UUID,
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    application = db.scalar(
        select(OrganizerApplication)
        .where(OrganizerApplication.id == application_id)
        .with_for_update()
    )
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organizer application not found")
    if application.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This application has already been reviewed")

    existing_user = db.scalar(select(User).where(User.normalized_email == application.normalized_email))
    if existing_user is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists")

    organizer = User(
        name=application.applicant_name,
        email=application.email,
        normalized_email=application.normalized_email,
        phone=application.phone,
        normalized_phone=application.normalized_phone,
        password_hash=application.password_hash,
        role="organizer",
        is_active=True,
    )
    organization = Organization(
        name=application.organization_name,
        created_by=admin.id,
        status="active",
        fee_type="none",
        fee_value_paise=0,
        fee_percentage_basis_points=0,
    )
    db.add_all([organizer, organization])
    try:
        db.flush()
        db.add(OrganizationMember(organization_id=organization.id, user_id=organizer.id, member_role="organizer"))
        application.status = "approved"
        application.reviewed_by = admin.id
        application.reviewed_at = utc_now()
        application.approved_user_id = organizer.id
        application.rejection_reason = None
        application.password_hash = ""
        record_audit(
            db,
            actor_user_id=admin.id,
            action="organizer_application_approved",
            resource_type="organizer_application",
            resource_id=application.id,
            metadata={"organization_id": str(organization.id)},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Organizer application could not be approved") from exc

    return {
        "application": _serialize_organizer_application(application),
        "organizer": public_user(organizer),
        "organization": {"id": str(organization.id), "name": organization.name, "status": organization.status},
    }


@router.post("/organizer-applications/{application_id}/reject")
def reject_organizer_application(
    application_id: UUID,
    payload: OrganizerApplicationDecisionIn,
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    application = db.scalar(
        select(OrganizerApplication)
        .where(OrganizerApplication.id == application_id)
        .with_for_update()
    )
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organizer application not found")
    if application.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This application has already been reviewed")

    application.status = "rejected"
    application.reviewed_by = admin.id
    application.reviewed_at = utc_now()
    application.rejection_reason = payload.reason.strip() if payload.reason else None
    application.password_hash = ""
    record_audit(
        db,
        actor_user_id=admin.id,
        action="organizer_application_rejected",
        resource_type="organizer_application",
        resource_id=application.id,
        metadata={"has_reason": bool(application.rejection_reason)},
    )
    db.commit()
    return {"application": _serialize_organizer_application(application)}


class PaidVerificationReviewIn(BaseModel):
    status: Literal["VERIFIED", "REJECTED"] = Field(...)
    rejection_reason: str | None = Field(default=None, max_length=2000)


@router.get("/paid-verifications")
def list_paid_verifications(
    status: Literal["UNDER_REVIEW", "VERIFIED", "REJECTED"] | None = Query(default=None, alias="status"),
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> list[dict]:
    """List paid organizer verification requests."""
    query = select(Organization).where(Organization.paid_verification_status != "NOT_SUBMITTED")
    if status is not None:
        query = query.where(Organization.paid_verification_status == status)
    query = query.order_by(Organization.paid_verification_submitted_at.desc())
    organizations = db.scalars(query).all()
    
    return [
        {
            "organizationId": str(org.id),
            "organizationName": org.name,
            "paidVerificationStatus": org.paid_verification_status,
            "panNumber": org.pan_number,
            "nameAsPerPan": org.name_as_per_pan,
            "gstRegistered": org.gst_registered,
            "gstNumber": org.gst_number,
            "billingName": org.billing_name,
            "billingAddress": org.billing_address,
            "billingCity": org.billing_city,
            "billingState": org.billing_state,
            "billingPincode": org.billing_pincode,
            "submittedAt": org.paid_verification_submitted_at.isoformat() if org.paid_verification_submitted_at else None,
            "reviewedAt": org.paid_verification_reviewed_at.isoformat() if org.paid_verification_reviewed_at else None,
            "rejectionReason": org.paid_verification_rejection_reason,
        }
        for org in organizations
    ]


@router.post("/organizations/{organization_id}/paid-verification/review")
def review_paid_verification(
    organization_id: UUID,
    payload: PaidVerificationReviewIn,
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    """Review a paid organizer verification request."""
    organization = db.scalar(
        select(Organization)
        .where(Organization.id == organization_id)
        .with_for_update()
    )
    if organization is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    
    if organization.paid_verification_status != "UNDER_REVIEW":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Paid verification is not under review (current status: {organization.paid_verification_status})"
        )
    
    organization.paid_verification_status = payload.status
    organization.paid_verification_reviewed_at = utc_now()
    organization.paid_verification_reviewed_by = admin.id
    
    if payload.status == "REJECTED":
        organization.paid_verification_rejection_reason = payload.rejection_reason.strip() if payload.rejection_reason else None
    else:
        organization.paid_verification_rejection_reason = None
    
    record_audit(
        db,
        actor_user_id=admin.id,
        action="paid_verification_reviewed",
        resource_type="organization",
        resource_id=organization.id,
        metadata={"status": payload.status, "has_rejection_reason": bool(payload.rejection_reason)},
    )
    
    db.commit()
    return {
        "organizationId": str(organization.id),
        "organizationName": organization.name,
        "paidVerificationStatus": organization.paid_verification_status,
        "reviewedAt": organization.paid_verification_reviewed_at.isoformat(),
        "reviewedBy": str(admin.id),
        "rejectionReason": organization.paid_verification_rejection_reason,
    }


@router.get("/organizers/overview")
def organizers_overview(
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Per-organizer rollup: events, participants, revenue, verification, billing."""
    return get_admin_organizers_overview(db)


@router.get("/organizers")
def list_organizers(
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> list[dict]:
    organizations = db.scalars(select(Organization).order_by(Organization.created_at.desc())).all()
    return [serialize_organization_fee(organization) for organization in organizations]


@router.put("/organizers/{organization_id}/fee-settings")
def update_fee_settings(
    organization_id: UUID,
    payload: FeeSettingsIn,
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return update_organization_fee_settings(
            db,
            organization_id=organization_id,
            actor_user_id=admin.id,
            fee_type=payload.fee_type,
            fee_value_paise=payload.fee_value_paise,
            fee_percentage_basis_points=payload.fee_percentage_basis_points,
        )
    except OrganizationNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found") from exc
    except OrganizationFeeValidationError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.get("/plans")
def list_pricing_plans(
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    return get_admin_pricing(db)


@router.put("/plans/{plan_id}")
def update_pricing_plan(
    plan_id: UUID,
    payload: PricingPlanIn,
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return update_plan(
            db,
            plan_id=plan_id,
            actor_user_id=admin.id,
            name=payload.name,
            minimum=payload.min_confirmed_registrations,
            maximum=payload.max_confirmed_registrations,
            price_paise=payload.price_paise,
            billing_unit=payload.billing_unit,
            active=payload.active,
            sort_order=payload.sort_order,
        )
    except PricingValidationError as exc:
        db.rollback()
        code = status.HTTP_404_NOT_FOUND if str(exc) == "Plan not found" else status.HTTP_422_UNPROCESSABLE_ENTITY
        raise HTTPException(status_code=code, detail=str(exc)) from exc


@router.put("/founding-program")
def update_founding_program_settings(
    payload: FoundingProgramIn,
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return update_founding_program(
            db,
            actor_user_id=admin.id,
            enabled=payload.enabled,
            free_races_count=payload.free_races_count,
            discount_basis_points=payload.default_discount_basis_points,
            organization_ids=payload.eligible_organization_ids,
        )
    except PricingValidationError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Legacy plan/slab-based event billing — RETIRED.
#
# The old "1–25 registrations × amount" plan/slab billing model has been
# retired in favour of the SportPass platform-fee model (5% of registration
# revenue + ₹10 per paid registration). These endpoints are intentionally
# disabled so nothing can be billed under the old model. The underlying
# billing_service and OrganizerEventBilling table are left in place so
# historical records are preserved and the change is reversible.
# ---------------------------------------------------------------------------

_LEGACY_BILLING_GONE = "Plan-based event billing has been retired. Use organizer platform fees instead."


@router.get("/billing", deprecated=True)
def list_billing_records() -> list[dict]:
    raise HTTPException(status_code=status.HTTP_410_GONE, detail=_LEGACY_BILLING_GONE)


@router.post("/billing/events/{event_id}/finalize", deprecated=True)
def finalize_billing(event_id: UUID) -> dict:
    raise HTTPException(status_code=status.HTTP_410_GONE, detail=_LEGACY_BILLING_GONE)


@router.post("/billing/{billing_id}/paid", deprecated=True)
def mark_billing_paid_endpoint(billing_id: UUID) -> dict:
    raise HTTPException(status_code=status.HTTP_410_GONE, detail=_LEGACY_BILLING_GONE)


@router.post("/billing/{billing_id}/waive", deprecated=True)
def waive_billing_endpoint(billing_id: UUID) -> dict:
    raise HTTPException(status_code=status.HTTP_410_GONE, detail=_LEGACY_BILLING_GONE)


# ---------------------------------------------------------------------------
# Organizer Platform Fee billing (separate from the plan-based billing above)
# ---------------------------------------------------------------------------


class PlatformFeeConfigIn(BaseModel):
    label: str | None = Field(default=None, max_length=120)
    percentage_basis_points: StrictInt = Field(ge=0, le=10_000)
    per_registration_paise: StrictInt = Field(ge=0)
    default_due_days: StrictInt = Field(ge=1, le=90)


class PlatformFeeRaiseIn(BaseModel):
    discount_paise: StrictInt = Field(default=0, ge=0)
    due_days: StrictInt | None = Field(default=None, ge=1, le=90)


class PlatformFeeDiscountIn(BaseModel):
    discount_paise: StrictInt = Field(ge=0)


class PlatformFeeDueDateIn(BaseModel):
    due_at: dt.datetime


class PlatformFeePaymentIn(BaseModel):
    payment_reference: str | None = Field(default=None, max_length=160)
    notes: str | None = Field(default=None, max_length=2000)


def _platform_fee_error(db: Session, exc: PlatformFeeValidationError) -> HTTPException:
    db.rollback()
    message = str(exc)
    not_found = message in {"Event not found", "Billing record not found"}
    code = status.HTTP_404_NOT_FOUND if not_found else status.HTTP_422_UNPROCESSABLE_ENTITY
    return HTTPException(status_code=code, detail=message)


@router.get("/platform-fees")
def list_platform_fees(
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    return list_admin_platform_fees(db)


@router.get("/platform-fees/config")
def get_platform_fee_config_endpoint(
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    return get_platform_fee_config(db)


@router.put("/platform-fees/config")
def update_platform_fee_config_endpoint(
    payload: PlatformFeeConfigIn,
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return update_platform_fee_config(
            db,
            actor_user_id=admin.id,
            label=payload.label,
            percentage_basis_points=payload.percentage_basis_points,
            per_registration_paise=payload.per_registration_paise,
            default_due_days=payload.default_due_days,
        )
    except PlatformFeeValidationError as exc:
        raise _platform_fee_error(db, exc) from exc


@router.post("/platform-fees/events/{event_id}/raise")
def raise_platform_fee_endpoint(
    event_id: UUID,
    payload: PlatformFeeRaiseIn = PlatformFeeRaiseIn(),
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return raise_platform_fee_bill(
            db,
            event_id=event_id,
            actor_user_id=admin.id,
            discount_paise=payload.discount_paise,
            due_days=payload.due_days,
        )
    except PlatformFeeValidationError as exc:
        raise _platform_fee_error(db, exc) from exc


@router.post("/platform-fees/{billing_id}/discount")
def platform_fee_discount_endpoint(
    billing_id: UUID,
    payload: PlatformFeeDiscountIn,
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return apply_platform_fee_discount(
            db,
            billing_id=billing_id,
            actor_user_id=admin.id,
            discount_paise=payload.discount_paise,
        )
    except PlatformFeeValidationError as exc:
        raise _platform_fee_error(db, exc) from exc


@router.post("/platform-fees/{billing_id}/due-date")
def platform_fee_due_date_endpoint(
    billing_id: UUID,
    payload: PlatformFeeDueDateIn,
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return set_platform_fee_due_date(
            db,
            billing_id=billing_id,
            actor_user_id=admin.id,
            due_at=payload.due_at,
        )
    except PlatformFeeValidationError as exc:
        raise _platform_fee_error(db, exc) from exc


@router.post("/platform-fees/{billing_id}/paid")
def platform_fee_paid_endpoint(
    billing_id: UUID,
    payload: PlatformFeePaymentIn = PlatformFeePaymentIn(),
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return mark_platform_fee_paid(
            db,
            billing_id=billing_id,
            actor_user_id=admin.id,
            payment_reference=payload.payment_reference,
            notes=payload.notes,
        )
    except PlatformFeeValidationError as exc:
        raise _platform_fee_error(db, exc) from exc


@router.post("/platform-fees/{billing_id}/overdue")
def platform_fee_overdue_endpoint(
    billing_id: UUID,
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return mark_platform_fee_overdue(db, billing_id=billing_id, actor_user_id=admin.id)
    except PlatformFeeValidationError as exc:
        raise _platform_fee_error(db, exc) from exc


@router.post("/platform-fees/{billing_id}/waive")
def platform_fee_waive_endpoint(
    billing_id: UUID,
    payload: PlatformFeePaymentIn = PlatformFeePaymentIn(),
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return waive_platform_fee_bill(
            db,
            billing_id=billing_id,
            actor_user_id=admin.id,
            notes=payload.notes,
        )
    except PlatformFeeValidationError as exc:
        raise _platform_fee_error(db, exc) from exc


class EmailSettingsIn(BaseModel):
    sender_name: str | None = Field(default=None, max_length=120)
    gmail_address: str | None = Field(default=None, max_length=320)
    gmail_app_password: str | None = Field(default=None, max_length=256)
    enabled: bool | None = None


class SendTestEmailIn(BaseModel):
    recipient_email: str = Field(min_length=3, max_length=320)


@router.get("/communication")
def get_communication_settings_endpoint(
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """Get current communication settings."""
    return get_communication_settings(db)


@router.put("/communication")
def update_communication_settings_endpoint(
    payload: EmailSettingsIn,
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    """Update email communication settings."""
    try:
        return update_email_settings(
            db,
            actor_user_id=admin.id,
            sender_name=payload.sender_name,
            gmail_address=payload.gmail_address,
            gmail_app_password=payload.gmail_app_password,
            enabled=payload.enabled,
        )
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.post("/communication/test-email")
def send_test_email_endpoint(
    payload: SendTestEmailIn,
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    """Send a test email to verify configuration."""
    success, message = send_test_email(
        db,
        recipient_email=payload.recipient_email,
    )
    if success:
        return {"success": True, "message": message}
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@router.get("/email-usage")
def get_email_usage_endpoint(
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """Get current email usage and limit status."""
    status_value, count = get_email_limit_status(db)
    return {
        "used": count,
        "warningLimit": EMAIL_WARNING_LIMIT,
        "hardLimit": EMAIL_HARD_LIMIT,
        "status": status_value.value,
    }


@router.post("/email-usage/retry-pending")
def retry_pending_emails_endpoint(
    _: User = Depends(require_roles("admin")),
    __: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    """Retry pending emails that were queued due to the rate limit."""
    results = retry_pending_emails(db)
    sent = sum(1 for r in results if r.status == "SENT")
    failed = sum(1 for r in results if r.status == "FAILED")
    still_pending = sum(1 for r in results if r.status == "PENDING_LIMIT")
    return {
        "retried": len(results),
        "sent": sent,
        "failed": failed,
        "stillPending": still_pending,
    }
@router.delete("/events/{event_id}")
def delete_archived_event_endpoint(
    event_id: UUID,
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    """
    Permanently delete an archived event and all related records.
    
    This endpoint permanently deletes an archived event and all associated data:
    - Registrations and participants
    - Payments and order items
    - Tickets, categories, courts, tournament rounds, matches
    - Checkpoints and checkins
    - Billing records and platform fee bills
    - Discount codes, documents, payment settings
    - Allocation history and race results
    
    Note: Email logs are preserved with event_id set to NULL to maintain email history.
    
    Returns 404 if event not found or event is not archived.
    """
    from app.services.event_archive_service import delete_archived_event
    
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    if event.archived_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Event is not archived")

    # Capture identifying values before the row is deleted.
    deleted_id = str(event.id)
    deleted_name = event.name

    delete_archived_event(db, event, admin.id)
    db.commit()
    
    return {
        "id": deleted_id,
        "name": deleted_name,
        "status": "deleted",
        "deletedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
