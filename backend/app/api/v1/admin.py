from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, StrictInt
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_csrf, require_roles
from app.services.admin_dashboard_service import get_admin_dashboard
from app.services.audit_service import record_audit
from app.services.auth_service import hash_password, normalize_email, normalize_phone, public_user, utc_now
from app.services.organization_fee_service import (
    OrganizationFeeValidationError,
    OrganizationNotFoundError,
    serialize_organization_fee,
    update_organization_fee_settings,
)
from app.services.billing_service import (
    BillingValidationError,
    finalize_event_billing,
    list_admin_billing,
    mark_billing_paid,
    waive_billing,
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


class OrganizerCreateIn(BaseModel):
    organization_name: str = Field(min_length=2, max_length=160)
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=320)
    phone: str | None = Field(default=None, max_length=32)
    temporary_password: str = Field(min_length=8, max_length=256)


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


class BillingFinalizeIn(BaseModel):
    due_days: StrictInt = Field(default=14, ge=1, le=90)


class BillingPaymentIn(BaseModel):
    payment_reference: str | None = Field(default=None, max_length=160)
    notes: str | None = Field(default=None, max_length=2000)


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


@router.get("/billing")
def list_billing_records(
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> list[dict]:
    return list_admin_billing(db)


@router.post("/billing/events/{event_id}/finalize")
def finalize_billing(
    event_id: UUID,
    payload: BillingFinalizeIn = BillingFinalizeIn(),
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return finalize_event_billing(
            db,
            event_id=event_id,
            actor_user_id=admin.id,
            due_days=payload.due_days,
        )
    except BillingValidationError as exc:
        db.rollback()
        code = status.HTTP_404_NOT_FOUND if str(exc) == "Event not found" else status.HTTP_422_UNPROCESSABLE_ENTITY
        raise HTTPException(status_code=code, detail=str(exc)) from exc


@router.post("/billing/{billing_id}/paid")
def mark_billing_paid_endpoint(
    billing_id: UUID,
    payload: BillingPaymentIn = BillingPaymentIn(),
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return mark_billing_paid(
            db,
            billing_id=billing_id,
            actor_user_id=admin.id,
            payment_reference=payload.payment_reference,
            notes=payload.notes,
        )
    except BillingValidationError as exc:
        db.rollback()
        code = status.HTTP_404_NOT_FOUND if str(exc) == "Billing record not found" else status.HTTP_422_UNPROCESSABLE_ENTITY
        raise HTTPException(status_code=code, detail=str(exc)) from exc


@router.post("/billing/{billing_id}/waive")
def waive_billing_endpoint(
    billing_id: UUID,
    payload: BillingPaymentIn = BillingPaymentIn(),
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return waive_billing(
            db,
            billing_id=billing_id,
            actor_user_id=admin.id,
            notes=payload.notes,
        )
    except BillingValidationError as exc:
        db.rollback()
        code = status.HTTP_404_NOT_FOUND if str(exc) == "Billing record not found" else status.HTTP_422_UNPROCESSABLE_ENTITY
        raise HTTPException(status_code=code, detail=str(exc)) from exc
