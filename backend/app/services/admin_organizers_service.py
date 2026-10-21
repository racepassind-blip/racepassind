"""Per-organizer overview aggregation for the admin Organizers page.

Uses standard PostgreSQL/SQLAlchemy aggregation only. No provider-specific APIs.
"""

from __future__ import annotations
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.services.platform_fee_service import get_effective_pricing
from models import Event, Organization, OrganizationMember, Registration, User

# Match the confirmed/approved filters used by the admin dashboard so revenue and
# participant counts are consistent across the admin surface.
_CONFIRMED_REGISTRATION_STATUSES = ("confirmed", "checked_in")
_CONFIRMED_PAYMENT_STATUSES = ("approved", "not_required")


def _num(value) -> int:
    return int(value or 0)


def get_admin_organizers_overview(db: Session, *, page: int = 1, page_size: int = 24, search: str | None = None, verification_status: str | None = None, organization_id: UUID | None = None) -> dict:
    """Return one row per organization with events, participants, revenue,
    verification status, and billing rollups."""

    organization_filters = []
    if organization_id:
        organization_filters.append(Organization.id == organization_id)
    if verification_status:
        organization_filters.append(Organization.paid_verification_status == verification_status)
    creator_alias = User
    if search:
        term = f"%{search.strip()}%"
        organization_filters.append(or_(Organization.name.ilike(term), Organization.city.ilike(term), Organization.state.ilike(term), creator_alias.name.ilike(term), creator_alias.email.ilike(term)))
    organization_query = select(Organization).outerjoin(creator_alias, creator_alias.id == Organization.created_by).where(*organization_filters)
    total = int(db.scalar(select(func.count()).select_from(Organization).outerjoin(creator_alias, creator_alias.id == Organization.created_by).where(*organization_filters)) or 0)
    organizations = db.scalars(organization_query.order_by(Organization.created_at.desc(), Organization.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    organization_ids = [organization.id for organization in organizations]

    # Events + published counts per organization (exclude archived).
    event_rows = db.execute(
        select(
            Event.organization_id,
            func.count(Event.id),
            func.count(Event.id).filter(Event.status == "published"),
        )
        .where(Event.archived_at.is_(None), Event.organization_id.in_(organization_ids))
        .group_by(Event.organization_id)
    ).all()
    events_by_org = {row[0]: (_num(row[1]), _num(row[2])) for row in event_rows}

    # Confirmed participants and approved registration revenue per organization.
    reg_rows = db.execute(
        select(
            Event.organization_id,
            func.coalesce(func.sum(Registration.quantity), 0),
            func.coalesce(func.sum(Registration.total_amount_paise), 0),
        )
        .join(Event, Event.id == Registration.event_id)
        .where(
            Registration.status.in_(_CONFIRMED_REGISTRATION_STATUSES),
            Registration.payment_status.in_(_CONFIRMED_PAYMENT_STATUSES),
            Event.organization_id.in_(organization_ids),
        )
        .group_by(Event.organization_id)
    ).all()
    reg_by_org = {row[0]: (_num(row[1]), _num(row[2])) for row in reg_rows}

    # Resolve responsible-person names (organization creators) in one query.
    creator_ids = {org.created_by for org in organizations if org.created_by}
    creators: dict = {}
    if creator_ids:
        for user in db.scalars(select(User).where(User.id.in_(creator_ids))).all():
            creators[user.id] = user

    # `Organization.created_by` records who created/approved the organization,
    # which may be an admin. The contact shown to admins should be the actual
    # organizer member who owns the organization.
    organizer_members: dict = {}
    if organization_ids:
        member_rows = db.execute(
            select(OrganizationMember.organization_id, User)
            .join(User, User.id == OrganizationMember.user_id)
            .where(
                OrganizationMember.organization_id.in_(organization_ids),
                OrganizationMember.member_role == "organizer",
            )
            .order_by(OrganizationMember.created_at.asc(), OrganizationMember.id.asc())
        ).all()
        for organization_id, user in member_rows:
            organizer_members.setdefault(organization_id, user)

    result = []
    for org in organizations:
        events_total, events_published = events_by_org.get(org.id, (0, 0))
        participants, revenue_paise = reg_by_org.get(org.id, (0, 0))
        creator = organizer_members.get(org.id) or (creators.get(org.created_by) if org.created_by else None)
        result.append(
            {
                "organizationId": str(org.id),
                "organizationName": org.name,
                "responsiblePerson": creator.name if creator else None,
                "email": creator.email if creator else None,
                "phone": creator.phone if creator else None,
                "city": org.city,
                "state": org.state,
                "status": org.status,
                "createdAt": org.created_at.isoformat() if org.created_at else None,
                "eventsTotal": events_total,
                "eventsPublished": events_published,
                "totalParticipants": participants,
                "approvedRevenuePaise": revenue_paise,
                "paidVerificationStatus": org.paid_verification_status,
                "allowDirectUpi": org.allow_direct_upi,
                "allowCashfree": org.allow_cashfree,
                "creditDeductionMode": org.credit_deduction_mode,
                "platformPricing": get_effective_pricing(org),
            }
        )
    global_regs = db.execute(
        select(func.coalesce(func.sum(Registration.quantity), 0), func.coalesce(func.sum(Registration.total_amount_paise), 0))
        .join(Event, Event.id == Registration.event_id)
        .where(Registration.status.in_(_CONFIRMED_REGISTRATION_STATUSES), Registration.payment_status.in_(_CONFIRMED_PAYMENT_STATUSES))
    ).one()
    return {
        "items": result,
        "page": page,
        "pageSize": page_size,
        "total": total,
        "summary": {
            "organizers": int(db.scalar(select(func.count()).select_from(Organization)) or 0),
            "pendingVerification": int(db.scalar(select(func.count()).select_from(Organization).where(Organization.paid_verification_status == "UNDER_REVIEW")) or 0),
            "participants": _num(global_regs[0]),
            "approvedRevenuePaise": _num(global_regs[1]),
        },
    }
