from __future__ import annotations

import datetime as dt
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, StrictInt, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_csrf, require_roles
from app.services.admin_dashboard_service import get_admin_dashboard
from app.services.admin_organizers_service import get_admin_organizers_overview
from app.services.audit_service import record_audit
from app.services.credit_service import CreditValidationError, add_credits, approve_topup, credit_event_discount, event_settlement_summary, get_credit_payment_settings, reject_topup, settle_event_credits, update_credit_payment_settings
from app.services.auth_service import hash_password, normalize_email, normalize_phone, public_user, utc_now, validate_required_phone
from app.services.communication_service import (
    get_communication_settings,
    send_test_email,
    update_email_settings,
)
from app.services.email_service import get_email_limit_status, retry_pending_emails, EMAIL_HARD_LIMIT, EMAIL_WARNING_LIMIT, EMAIL_RETRY_ENABLED
from app.services.organization_fee_service import (
    OrganizationFeeValidationError,
    OrganizationNotFoundError,
    serialize_organization_fee,
    update_organization_fee_settings,
)
from app.services.platform_fee_service import (
    PlatformFeeValidationError,
    get_effective_pricing,
    get_config as get_platform_fee_config,
    update_config as update_platform_fee_config,
    update_organizer_pricing,
)
from db import get_db
from app.services.event_archive_service import restore_event_record
from models import CreditTopupRequest, CreditTransaction, Event, OrganizerApplication, Organization, OrganizationMember, OrganizationPaymentDestination, OrganizationVerificationSubmission, Registration, User

router = APIRouter()

class CreditAdjustmentIn(BaseModel):
    organization_id: UUID
    amount_paise: StrictInt = Field(gt=0)
    reason: str = Field(min_length=3, max_length=1000)

class CreditRejectIn(BaseModel):
    rejection_reason: str = Field(min_length=3, max_length=1000)

class CreditPaymentSettingsIn(BaseModel):
    method: Literal["UPI"] = "UPI"
    upi_id: str = Field(min_length=3, max_length=255)
    payee_name: str = Field(default="SportPass India", min_length=2, max_length=160)

class OrganizerPricingIn(BaseModel):
    mode: Literal["DEFAULT", "CUSTOM_PERCENTAGE", "FIXED_PER_PARTICIPANT"]
    percentage_basis_points: StrictInt | None = Field(default=None, ge=0, le=10_000)
    minimum_fee_paise: StrictInt | None = Field(default=None, ge=0)
    maximum_fee_paise: StrictInt | None = Field(default=None, ge=0)
    fixed_fee_paise: StrictInt | None = Field(default=None, ge=0)

class CreditReasonIn(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)
    amount_paise: StrictInt = Field(gt=0)


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
        "eventEndDate": event.end_date.date().isoformat() if event.end_date else None,
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
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    filters = []
    if archived is True:
        filters.append(Event.archived_at.is_not(None))
    elif archived is False:
        filters.append(Event.archived_at.is_(None))
    query = (
        select(Event)
        .options(selectinload(Event.organization))
        .where(*filters)
        .order_by(Event.archived_at.desc().nullslast(), Event.created_at.desc(), Event.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    total = int(db.scalar(select(func.count()).select_from(Event).where(*filters)) or 0)
    summary = db.execute(
        select(
            func.coalesce(func.sum(Event.participants), 0),
            func.count(func.distinct(Event.organization_id)),
            func.count(Event.id).filter(Event.features_unlocked.is_(True)),
        ).where(*filters)
    ).one()
    return {
        "items": [_serialize_admin_event(event) for event in db.scalars(query).all()],
        "page": page,
        "pageSize": page_size,
        "total": total,
        "summary": {
            "participants": int(summary[0] or 0),
            "organizations": int(summary[1] or 0),
            "featuresUnlocked": int(summary[2] or 0),
        },
    }


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
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    filters = []
    if application_status is not None:
        filters.append(OrganizerApplication.status == application_status)
    total = int(db.scalar(select(func.count()).select_from(OrganizerApplication).where(*filters)) or 0)
    query = (
        select(OrganizerApplication)
        .where(*filters)
        .order_by(OrganizerApplication.created_at.desc(), OrganizerApplication.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    applications = db.scalars(query).all()
    return {
        "items": [_serialize_organizer_application(application) for application in applications],
        "page": page,
        "pageSize": page_size,
        "total": total,
    }


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
    status: Literal["UNDER_REVIEW", "VERIFIED", "REJECTED", "SUSPENDED"] | None = Query(default=None, alias="status"),
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
            "panNumber": f"{org.pan_number[:5]}••••{org.pan_number[-1:]}" if org.pan_number else None,
            "nameAsPerPan": org.name_as_per_pan,
            "gstRegistered": org.gst_registered,
            "gstNumber": f"{org.gst_number[:4]}•••••••{org.gst_number[-4:]}" if org.gst_number else None,
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
    
    if payload.status == "REJECTED" and not (payload.rejection_reason and payload.rejection_reason.strip()):
        raise HTTPException(status_code=422, detail="A rejection reason is required")
    submission = db.scalar(select(OrganizationVerificationSubmission).where(
        OrganizationVerificationSubmission.organization_id == organization.id,
        OrganizationVerificationSubmission.status == "UNDER_REVIEW",
    ).order_by(OrganizationVerificationSubmission.submitted_at.desc()).with_for_update())
    if submission is None:
        raise HTTPException(status_code=409, detail="Verification submission snapshot is missing")
    organization.paid_verification_status = payload.status
    organization.paid_verification_reviewed_at = utc_now()
    organization.paid_verification_reviewed_by = admin.id
    
    if payload.status == "REJECTED":
        organization.paid_verification_rejection_reason = payload.rejection_reason.strip() if payload.rejection_reason else None
    else:
        organization.paid_verification_rejection_reason = None
    submission.status = payload.status
    submission.reviewed_at = organization.paid_verification_reviewed_at
    submission.reviewed_by = admin.id
    submission.rejection_reason = organization.paid_verification_rejection_reason
    
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
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, ge=1, le=100),
    q: str | None = Query(default=None, max_length=160),
    verification_status: str | None = Query(default=None, max_length=30),
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """Per-organizer rollup: events, participants, revenue, verification, billing."""
    if verification_status and verification_status not in {"NOT_SUBMITTED", "UNDER_REVIEW", "VERIFIED", "REJECTED", "SUSPENDED"}:
        raise HTTPException(status_code=422, detail="Unsupported verification status")
    return get_admin_organizers_overview(db, page=page, page_size=page_size, search=q, verification_status=verification_status)


class DirectUpiAccessIn(BaseModel):
    allow: bool


@router.put("/organizations/{organization_id}/direct-upi")
def update_direct_upi_access(
    organization_id: UUID,
    payload: DirectUpiAccessIn,
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    """Enable or disable Direct UPI access for an organizer.

    Warns (but does not block) when disabling an org that has active/published
    events currently configured with Direct UPI. The caller can read the
    'activeDirectUpiEvents' list from the response and decide whether to proceed.
    """
    organization = db.scalar(
        select(Organization).where(Organization.id == organization_id).with_for_update()
    )
    if organization is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    if payload.allow and organization.paid_verification_status != "VERIFIED":
        raise HTTPException(status_code=409, detail="Paid verification must be verified before enabling Direct UPI")

    # Warn before disabling if there are active Direct UPI events.
    active_direct_upi_events = []
    if not payload.allow and organization.allow_direct_upi:
        rows = db.execute(
            select(Event.id, Event.name)
            .where(
                Event.organization_id == organization_id,
                Event.payment_collection_method == "DIRECT_UPI",
                Event.status == "published",
                Event.archived_at.is_(None),
            )
        ).all()
        active_direct_upi_events = [{"id": str(row.id), "name": row.name} for row in rows]

    old_value = organization.allow_direct_upi
    organization.allow_direct_upi = payload.allow

    record_audit(
        db,
        actor_user_id=admin.id,
        action="direct_upi_access_updated",
        resource_type="organization",
        resource_id=organization.id,
        metadata={
            "allowDirectUpi": payload.allow,
            "previousValue": old_value,
            "changedBy": str(admin.id),
            "adminName": admin.name,
        },
    )
    db.commit()
    return {
        "organizationId": str(organization.id),
        "organizationName": organization.name,
        "allowDirectUpi": organization.allow_direct_upi,
        "activeDirectUpiEvents": active_direct_upi_events,
    }


class SuspensionIn(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)


@router.post("/organizations/{organization_id}/paid-verification/suspend")
def suspend_paid_verification(organization_id: UUID, payload: SuspensionIn,
    admin: User = Depends(require_roles("admin")), _: None = Depends(require_csrf), db: Session = Depends(get_db)) -> dict:
    organization = db.scalar(select(Organization).where(Organization.id == organization_id).with_for_update())
    if organization is None:
        raise HTTPException(404, "Organization not found")
    if organization.paid_verification_status != "VERIFIED":
        raise HTTPException(409, "Only verified organizations can be suspended")
    organization.paid_verification_status = "SUSPENDED"
    organization.paid_verification_suspended_at = utc_now()
    organization.paid_verification_suspended_by = admin.id
    organization.paid_verification_suspension_reason = payload.reason.strip()
    record_audit(db, actor_user_id=admin.id, action="paid_verification_suspended",
        resource_type="organization", resource_id=organization.id, metadata={"reason": payload.reason.strip()})
    db.commit()
    return {"organizationId": str(organization.id), "paidVerificationStatus": "SUSPENDED"}


class DestinationReviewIn(BaseModel):
    status: Literal["APPROVED", "REJECTED"]
    rejection_reason: str | None = Field(default=None, max_length=2000)


@router.get("/organizations/{organization_id}/payment-destinations")
def list_payment_destinations(organization_id: UUID, _: User = Depends(require_roles("admin")), db: Session = Depends(get_db)) -> list[dict]:
    organization = db.get(Organization, organization_id)
    if organization is None:
        raise HTTPException(404, "Organization not found")
    rows = db.scalars(select(OrganizationPaymentDestination).where(
        OrganizationPaymentDestination.organization_id == organization_id
    ).order_by(OrganizationPaymentDestination.created_at.desc())).all()
    return [{"id": str(row.id), "upiId": row.upi_id, "payeeName": row.payee_name, "status": row.status,
             "submittedAt": row.submitted_at.isoformat(), "reviewedAt": row.reviewed_at.isoformat() if row.reviewed_at else None,
             "rejectionReason": row.rejection_reason} for row in rows]


@router.post("/organizations/{organization_id}/payment-destinations/{destination_id}/review")
def review_payment_destination(organization_id: UUID, destination_id: UUID, payload: DestinationReviewIn,
    admin: User = Depends(require_roles("admin")), _: None = Depends(require_csrf), db: Session = Depends(get_db)) -> dict:
    organization = db.scalar(select(Organization).where(Organization.id == organization_id).with_for_update())
    destination = db.scalar(select(OrganizationPaymentDestination).where(
        OrganizationPaymentDestination.id == destination_id,
        OrganizationPaymentDestination.organization_id == organization_id,
    ).with_for_update())
    if organization is None or destination is None:
        raise HTTPException(404, "Payment destination not found")
    if organization.paid_verification_status != "VERIFIED":
        raise HTTPException(409, "Paid verification must be verified before approving a destination")
    if destination.status not in {"UNDER_REVIEW", "LEGACY_APPROVED"}:
        raise HTTPException(409, "Payment destination is not awaiting review")
    if payload.status == "REJECTED" and not (payload.rejection_reason and payload.rejection_reason.strip()):
        raise HTTPException(422, "A rejection reason is required")
    previous = destination.status
    destination.status = payload.status
    destination.reviewed_at = utc_now()
    destination.reviewed_by = admin.id
    destination.rejection_reason = payload.rejection_reason.strip() if payload.status == "REJECTED" else None
    record_audit(db, actor_user_id=admin.id, action="payment_destination_reviewed",
        resource_type="organization_payment_destination", resource_id=destination.id,
        metadata={"organization_id": str(organization.id), "previous_status": previous,
                  "new_status": destination.status, "reason": destination.rejection_reason})
    db.commit()
    return {"id": str(destination.id), "status": destination.status, "reviewedAt": destination.reviewed_at.isoformat()}


@router.get("/organizations/{organization_id}/payment-destinations/audit")
def get_payment_destination_audit(
    organization_id: UUID,
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Internal exact-value history for investigating sensitive payment changes."""
    from models import AuditLog
    rows = db.scalars(select(AuditLog).where(AuditLog.action.in_({
        "payment_settings_updated", "payment_destination_submitted", "payment_destination_reviewed",
    })).order_by(AuditLog.created_at.desc()).limit(500)).all()
    result = []
    for row in rows:
        metadata = row.metadata_json or {}
        if metadata.get("organization_id") != str(organization_id):
            continue
        result.append({
            "id": str(row.id), "action": row.action, "actorUserId": str(row.actor_user_id) if row.actor_user_id else None,
            "eventId": metadata.get("event_id") or (row.resource_id if row.resource_type == "event" else None),
            "previousUpiId": metadata.get("previous_upi_id"), "newUpiId": metadata.get("new_upi_id"),
            "previousPayeeName": metadata.get("previous_payee_name"), "newPayeeName": metadata.get("new_payee_name"),
            "previousStatus": metadata.get("previous_status"), "newStatus": metadata.get("new_status") or metadata.get("status"),
            "reason": metadata.get("reason"), "createdAt": row.created_at.isoformat(),
        })
    return result


@router.get("/organizations/{organization_id}/direct-upi/audit")
def get_direct_upi_audit(
    organization_id: UUID,
    admin: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Return the audit history for Direct UPI access changes on this organization."""
    from models import AuditLog
    rows = db.execute(
        select(AuditLog, User.name.label("actor_name"))
        .outerjoin(User, User.id == AuditLog.actor_user_id)
        .where(
            AuditLog.resource_type == "organization",
            AuditLog.resource_id == str(organization_id),
            AuditLog.action == "direct_upi_access_updated",
        )
        .order_by(AuditLog.created_at.desc())
        .limit(50)
    ).all()
    return [
        {
            "id": str(row.AuditLog.id),
            "allowDirectUpi": (row.AuditLog.metadata_json or {}).get("allowDirectUpi"),
            "previousValue": (row.AuditLog.metadata_json or {}).get("previousValue"),
            "adminName": (row.AuditLog.metadata_json or {}).get("adminName") or row.actor_name,
            "changedAt": row.AuditLog.created_at.isoformat(),
        }
        for row in rows
    ]


@router.get("/organizers")
def list_organizers(
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> list[dict]:
    organizations = db.scalars(select(Organization).order_by(Organization.created_at.desc())).all()
    result = []
    for organization in organizations:
        pricing = get_effective_pricing(organization)
        result.append({
            "id": str(organization.id),
            "organizationId": str(organization.id),
            "name": organization.name,
            "organizationName": organization.name,
            "status": organization.status,
            "platformPricing": {
                "mode": pricing["mode"],
                "percentageBasisPoints": pricing["percentageBasisPoints"],
                "minimumFeePaise": pricing["minimumFeePaise"],
                "maximumFeePaise": pricing["maximumFeePaise"],
                "fixedFeePaise": pricing["fixedFeePaise"],
            },
        })
    return result


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


@router.put("/organizers/{organization_id}/platform-pricing")
def update_organizer_platform_pricing(organization_id: UUID, payload: OrganizerPricingIn, _: User = Depends(require_roles("admin")), __: None = Depends(require_csrf), db: Session = Depends(get_db)) -> dict:
    try:
        return update_organizer_pricing(db, organization_id=organization_id, mode=payload.mode, percentage_basis_points=payload.percentage_basis_points, minimum_fee_paise=payload.minimum_fee_paise, maximum_fee_paise=payload.maximum_fee_paise, fixed_fee_paise=payload.fixed_fee_paise)
    except PlatformFeeValidationError as exc:
        db.rollback(); raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/plans")
def list_pricing_plans(
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="Legacy organizer plans have been unwired.")


@router.put("/plans/{plan_id}")
def update_pricing_plan(
    plan_id: UUID,
    _: User = Depends(require_roles("admin")),
    __: None = Depends(require_csrf),
) -> dict:
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="Legacy organizer plans have been unwired.")


@router.put("/founding-program")
def update_founding_program_settings(
    _: User = Depends(require_roles("admin")),
    __: None = Depends(require_csrf),
) -> dict:
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="Legacy founding-program billing has been unwired.")


# ---------------------------------------------------------------------------
# Legacy plan/slab-based event billing — RETIRED.
#
# The old plan/slab billing endpoints stay as 410 responses so older clients
# cannot create or mutate historical invoice records.
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
    minimum_fee_paise: StrictInt = Field(ge=0)
    maximum_fee_paise: StrictInt = Field(ge=0)


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
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="Organizer billing has been unwired; prepaid credits are not yet available.")


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
            minimum_fee_paise=payload.minimum_fee_paise,
            maximum_fee_paise=payload.maximum_fee_paise,
        )
    except PlatformFeeValidationError as exc:
        raise _platform_fee_error(db, exc) from exc


@router.post("/platform-fees/events/{event_id}/raise")
def raise_platform_fee_endpoint(
    event_id: UUID,
    _: User = Depends(require_roles("admin")),
    __: None = Depends(require_csrf),
) -> dict:
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="Organizer billing has been unwired; use prepaid Credits.")


@router.post("/platform-fees/{billing_id}/discount")
def platform_fee_discount_endpoint(
    billing_id: UUID,
    _: User = Depends(require_roles("admin")),
    __: None = Depends(require_csrf),
) -> dict:
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="Organizer billing has been unwired; use prepaid Credits.")


@router.post("/platform-fees/{billing_id}/due-date")
def platform_fee_due_date_endpoint(
    billing_id: UUID,
    _: User = Depends(require_roles("admin")),
    __: None = Depends(require_csrf),
) -> dict:
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="Organizer billing has been unwired; use prepaid Credits.")


@router.post("/platform-fees/{billing_id}/paid")
def platform_fee_paid_endpoint(
    billing_id: UUID,
    _: User = Depends(require_roles("admin")),
    __: None = Depends(require_csrf),
) -> dict:
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="Organizer billing has been unwired; use prepaid Credits.")


@router.post("/platform-fees/{billing_id}/overdue")
def platform_fee_overdue_endpoint(
    billing_id: UUID,
    _: User = Depends(require_roles("admin")),
    __: None = Depends(require_csrf),
) -> dict:
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="Organizer billing has been unwired; use prepaid Credits.")


@router.post("/platform-fees/{billing_id}/waive")
def platform_fee_waive_endpoint(
    billing_id: UUID,
    _: User = Depends(require_roles("admin")),
    __: None = Depends(require_csrf),
) -> dict:
    raise HTTPException(status_code=status.HTTP_410_GONE, detail="Organizer billing has been unwired; use prepaid Credits.")


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
    if not EMAIL_RETRY_ENABLED:
        raise HTTPException(status_code=409, detail="Email retries are temporarily disabled")
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


@router.get("/credits/topups")
def admin_credit_topups(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    topup_status: str | None = Query(default=None, alias="status", max_length=30),
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    filters = []
    if topup_status:
        normalized_status = topup_status.strip().upper()
        if normalized_status not in {"PENDING", "APPROVED", "REJECTED"}:
            raise HTTPException(status_code=422, detail="Unsupported top-up status")
        filters.append(CreditTopupRequest.status == normalized_status)
    total = int(db.scalar(select(func.count()).select_from(CreditTopupRequest).where(*filters)) or 0)
    rows = db.scalars(
        select(CreditTopupRequest)
        .where(*filters)
        .order_by(CreditTopupRequest.requested_at.desc(), CreditTopupRequest.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    organization_ids = {row.organization_id for row in rows}
    org_names = {str(org.id): org.name for org in db.scalars(select(Organization).where(Organization.id.in_(organization_ids))).all()} if organization_ids else {}
    summary = db.execute(
        select(
            func.count(CreditTopupRequest.id),
            func.count(CreditTopupRequest.id).filter(CreditTopupRequest.status == "PENDING"),
            func.coalesce(func.sum(CreditTopupRequest.credits_paise).filter(CreditTopupRequest.status == "APPROVED"), 0),
        )
    ).one()
    return {
        "items": [{"id": str(row.id), "organizationId": str(row.organization_id), "organizationName": org_names.get(str(row.organization_id), "Unknown organization"), "amountPaise": row.amount_paise, "creditsPaise": row.credits_paise, "utrReference": row.utr_reference, "status": row.status, "requestedAt": row.requested_at, "rejectionReason": row.rejection_reason} for row in rows],
        "page": page,
        "pageSize": page_size,
        "total": total,
        "summary": {"total": int(summary[0] or 0), "pending": int(summary[1] or 0), "approvedCreditsPaise": int(summary[2] or 0)},
    }


@router.get("/credits/ledger")
def admin_credit_ledger(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    organization_id: UUID | None = Query(default=None),
    event_id: UUID | None = Query(default=None),
    export: bool = Query(default=False),
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    filters = []
    if organization_id:
        filters.append(CreditTransaction.organization_id == organization_id)
    if event_id:
        filters.append(CreditTransaction.event_id == event_id)
    total = int(db.scalar(select(func.count()).select_from(CreditTransaction).where(*filters)) or 0)
    effective_size = min(total, 5000) if export else page_size
    offset = 0 if export else (page - 1) * page_size
    rows = db.scalars(
        select(CreditTransaction)
        .where(*filters)
        .order_by(CreditTransaction.created_at.desc(), CreditTransaction.id.desc())
        .offset(offset)
        .limit(effective_size)
    ).all()
    organization_ids = {row.organization_id for row in rows}
    event_ids = {row.event_id for row in rows if row.event_id}
    registration_ids = {row.registration_id for row in rows if row.registration_id}
    org_names = {str(org.id): org.name for org in db.scalars(select(Organization).where(Organization.id.in_(organization_ids))).all()} if organization_ids else {}
    event_names = {str(event.id): event.name for event in db.scalars(select(Event).where(Event.id.in_(event_ids))).all()} if event_ids else {}
    registration_refs = {str(registration.id): registration.registration_reference or str(registration.id) for registration in db.scalars(select(Registration).where(Registration.id.in_(registration_ids))).all()} if registration_ids else {}
    organizer_options = db.execute(select(Organization.id, Organization.name).join(CreditTransaction, CreditTransaction.organization_id == Organization.id).distinct().order_by(Organization.name)).all()
    event_options = db.execute(select(Event.id, Event.name).join(CreditTransaction, CreditTransaction.event_id == Event.id).distinct().order_by(Event.name)).all()
    return {
        "items": [{"id": str(row.id), "organizationId": str(row.organization_id), "organizationName": org_names.get(str(row.organization_id), "Unknown organization"), "type": row.type, "amountPaise": row.balance_after_paise - row.balance_before_paise, "balanceAfterPaise": row.balance_after_paise, "eventId": str(row.event_id) if row.event_id else None, "eventName": event_names.get(str(row.event_id)) if row.event_id else None, "registrationId": str(row.registration_id) if row.registration_id else None, "registrationReference": registration_refs.get(str(row.registration_id)) if row.registration_id else None, "description": f"{row.description} · Registration: {registration_refs.get(str(row.registration_id))}" if row.registration_id else row.description, "reason": row.reason, "createdAt": row.created_at} for row in rows],
        "page": 1 if export else page,
        "pageSize": effective_size if export else page_size,
        "total": total,
        "truncated": bool(export and total > 5000),
        "organizerOptions": [{"id": str(row.id), "name": row.name} for row in organizer_options],
        "eventOptions": [{"id": str(row.id), "name": row.name} for row in event_options],
    }


@router.get("/credits/payment-settings")
def admin_credit_payment_settings(_: User = Depends(require_roles("admin")), db: Session = Depends(get_db)) -> dict:
    return get_credit_payment_settings(db)


@router.put("/credits/payment-settings")
def save_admin_credit_payment_settings(payload: CreditPaymentSettingsIn, admin: User = Depends(require_roles("admin")), _: None = Depends(require_csrf), db: Session = Depends(get_db)) -> dict:
    try:
        return update_credit_payment_settings(db, method=payload.method, upi_id=payload.upi_id, payee_name=payload.payee_name, updated_by=admin.id)
    except (CreditValidationError, ValueError) as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/credits/topups/{request_id}/approve")
def admin_approve_credit_topup(request_id: UUID, admin: User = Depends(require_roles("admin")), _: None = Depends(require_csrf), db: Session = Depends(get_db)) -> dict:
    try:
        row = approve_topup(db, request_id=request_id, approved_by=admin.id)
        db.commit()
        return {"id": str(row.id), "status": row.status, "creditsPaise": row.credits_paise}
    except CreditValidationError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/credits/topups/{request_id}/reject")
def admin_reject_credit_topup(request_id: UUID, payload: CreditRejectIn, _: User = Depends(require_roles("admin")), __: None = Depends(require_csrf), db: Session = Depends(get_db)) -> dict:
    try:
        row = reject_topup(db, request_id=request_id, rejection_reason=payload.rejection_reason)
        db.commit()
        return {"id": str(row.id), "status": row.status}
    except CreditValidationError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/credits/adjust")
def admin_adjust_credits(payload: CreditAdjustmentIn, admin: User = Depends(require_roles("admin")), _: None = Depends(require_csrf), db: Session = Depends(get_db)) -> dict:
    try:
        row = add_credits(db, organization_id=payload.organization_id, amount=payload.amount_paise, transaction_type="ADMIN_ADJUSTMENT", description="Admin credit adjustment", reason=payload.reason, created_by=admin.id)
        db.commit()
        return {"transactionId": str(row.id), "balanceAfterPaise": row.balance_after_paise}
    except CreditValidationError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.put("/organizations/{organization_id}/credit-deduction-mode")
def update_credit_deduction_mode(organization_id: UUID, mode: Literal["AUTOMATIC_PER_REGISTRATION", "MANUAL_EVENT_SETTLEMENT"], _: User = Depends(require_roles("admin")), __: None = Depends(require_csrf), db: Session = Depends(get_db)) -> dict:
    organization = db.scalar(select(Organization).where(Organization.id == organization_id).with_for_update())
    if organization is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    organization.credit_deduction_mode = mode
    db.commit()
    return {"organizationId": str(organization.id), "creditDeductionMode": mode}


@router.post("/credits/events/{event_id}/settle")
def settle_event_credit_debit(event_id: UUID, admin: User = Depends(require_roles("admin")), _: None = Depends(require_csrf), db: Session = Depends(get_db)) -> dict:
    try:
        row = settle_event_credits(db, event_id=event_id, created_by=admin.id); db.commit()
        return {"transactionId": str(row.id), "amountPaise": row.amount_paise, "balanceAfterPaise": row.balance_after_paise}
    except CreditValidationError as exc:
        db.rollback(); raise HTTPException(status_code=422, detail=str(exc)) from exc

@router.get("/credits/events/{event_id}/settlement-preview")
def preview_event_credit_settlement(event_id: UUID, _: User = Depends(require_roles("admin")), db: Session = Depends(get_db)) -> dict:
    try:
        summary = event_settlement_summary(db, event_id=event_id)
        summary.pop("organizationId", None)
        return summary
    except CreditValidationError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/credits/events/{event_id}/discount")
def discount_event_credits(event_id: UUID, payload: CreditReasonIn, admin: User = Depends(require_roles("admin")), _: None = Depends(require_csrf), db: Session = Depends(get_db)) -> dict:
    try:
        row = credit_event_discount(db, event_id=event_id, amount_paise=payload.amount_paise, reason=payload.reason, created_by=admin.id); db.commit()
        return {"transactionId": str(row.id), "amountPaise": row.amount_paise, "balanceAfterPaise": row.balance_after_paise}
    except CreditValidationError as exc:
        db.rollback(); raise HTTPException(status_code=422, detail=str(exc)) from exc
