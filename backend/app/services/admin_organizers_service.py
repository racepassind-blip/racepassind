"""Per-organizer overview aggregation for the admin Organizers page.

Uses standard PostgreSQL/SQLAlchemy aggregation only. No provider-specific APIs.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models import Event, OrganizerEventBilling, Organization, Registration, User

# Match the confirmed/approved filters used by the admin dashboard so revenue and
# participant counts are consistent across the admin surface.
_CONFIRMED_REGISTRATION_STATUSES = ("confirmed", "checked_in")
_CONFIRMED_PAYMENT_STATUSES = ("approved", "not_required")

# Billing statuses that represent money still owed to SportPass.
_OUTSTANDING_BILLING_STATUSES = ("payment_due", "overdue")


def _num(value) -> int:
    return int(value or 0)


def get_admin_organizers_overview(db: Session) -> list[dict]:
    """Return one row per organization with events, participants, revenue,
    verification status, and billing rollups."""

    # Events + published counts per organization (exclude archived).
    event_rows = db.execute(
        select(
            Event.organization_id,
            func.count(Event.id),
            func.count(Event.id).filter(Event.status == "published"),
        )
        .where(Event.archived_at.is_(None))
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
        )
        .group_by(Event.organization_id)
    ).all()
    reg_by_org = {row[0]: (_num(row[1]), _num(row[2])) for row in reg_rows}

    # Billing rollups per organization.
    billing_due_rows = db.execute(
        select(
            OrganizerEventBilling.organization_id,
            func.coalesce(func.sum(OrganizerEventBilling.final_amount_paise), 0),
        )
        .where(OrganizerEventBilling.billing_status.in_(_OUTSTANDING_BILLING_STATUSES))
        .group_by(OrganizerEventBilling.organization_id)
    ).all()
    billing_due_by_org = {row[0]: _num(row[1]) for row in billing_due_rows}

    billing_paid_rows = db.execute(
        select(
            OrganizerEventBilling.organization_id,
            func.coalesce(func.sum(OrganizerEventBilling.final_amount_paise), 0),
        )
        .where(OrganizerEventBilling.billing_status == "paid_manual")
        .group_by(OrganizerEventBilling.organization_id)
    ).all()
    billing_paid_by_org = {row[0]: _num(row[1]) for row in billing_paid_rows}

    overdue_rows = db.execute(
        select(
            OrganizerEventBilling.organization_id,
            func.count(OrganizerEventBilling.id),
        )
        .where(OrganizerEventBilling.billing_status == "overdue")
        .group_by(OrganizerEventBilling.organization_id)
    ).all()
    overdue_by_org = {row[0]: _num(row[1]) for row in overdue_rows}

    organizations = db.scalars(
        select(Organization).order_by(Organization.created_at.desc())
    ).all()

    # Resolve responsible-person names (organization creators) in one query.
    creator_ids = {org.created_by for org in organizations if org.created_by}
    creators: dict = {}
    if creator_ids:
        for user in db.scalars(select(User).where(User.id.in_(creator_ids))).all():
            creators[user.id] = user

    result = []
    for org in organizations:
        events_total, events_published = events_by_org.get(org.id, (0, 0))
        participants, revenue_paise = reg_by_org.get(org.id, (0, 0))
        creator = creators.get(org.created_by) if org.created_by else None
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
                "billingDuePaise": billing_due_by_org.get(org.id, 0),
                "billingCollectedPaise": billing_paid_by_org.get(org.id, 0),
                "overdueBillingCount": overdue_by_org.get(org.id, 0),
                "allowDirectUpi": org.allow_direct_upi,
            }
        )
    return result
