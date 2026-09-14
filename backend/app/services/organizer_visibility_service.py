from __future__ import annotations

import datetime as dt
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.services.pricing_service import _active_plans
from app.services.auth_service import utc_now
from models import Event, FoundingProgram, OrganizerEventBilling, Organization, OrganizationMember, PricingPlan, Registration

VISIBILITY_GRACE_HOURS = 48
_VISIBLE_REGISTRATION_STATUSES = ("awaiting_payment", "pending_verification", "confirmed", "checked_in")
_CONFIRMED_REGISTRATION_STATUSES = ("confirmed", "checked_in")
_CONFIRMED_PAYMENT_STATUSES = ("approved", "not_required")


def confirmed_registration_condition():
    return and_(
        Registration.payment_status.in_(_CONFIRMED_PAYMENT_STATUSES),
        Registration.status.in_(_CONFIRMED_REGISTRATION_STATUSES),
    )


def _authorized_event_ids(db: Session, user, event_id: UUID | None = None) -> list[UUID]:
    query = select(Event.id).join(Organization, Organization.id == Event.organization_id).where(Organization.status == "active")
    if event_id is not None:
        query = query.where(Event.id == event_id)
    if user.role != "admin":
        query = query.join(OrganizationMember, OrganizationMember.organization_id == Event.organization_id).where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.member_role == "organizer",
        )
    return list(db.scalars(query).all())


def _entitlement_plan(db: Session, event_id: UUID, plans: list[PricingPlan]) -> PricingPlan | None:
    billing = db.scalar(
        select(OrganizerEventBilling)
        .options(selectinload(OrganizerEventBilling.plan))
        .where(OrganizerEventBilling.event_id == event_id)
    )
    if billing is not None and billing.billing_status in {"paid_manual", "waived"} and billing.plan is not None:
        return billing.plan
    return plans[0] if plans else None


def _next_plan(plans: list[PricingPlan], plan: PricingPlan | None) -> PricingPlan | None:
    if plan is None:
        return plans[0] if plans else None
    ordered = sorted(plans, key=lambda item: (item.sort_order, item.min_confirmed_registrations))
    for index, candidate in enumerate(ordered):
        if candidate.id == plan.id:
            return ordered[index + 1] if index + 1 < len(ordered) else None
    return None


def _serialize_plan(plan: PricingPlan | None) -> dict | None:
    if plan is None:
        return None
    return {
        "code": plan.code,
        "name": plan.name,
        "maxConfirmedRegistrations": plan.max_confirmed_registrations,
        "pricePaise": plan.price_paise,
        "billingUnit": plan.billing_unit,
    }


def _event_visibility(db: Session, user, event_id: UUID, plans: list[PricingPlan]) -> dict:
    plan = None if user.role == "admin" else _entitlement_plan(db, event_id, plans)
    next_plan = _next_plan(plans, plan)
    rows = db.execute(
        select(
            Registration.id,
            Registration.created_at,
            Registration.quantity,
            Registration.ticket_id,
            Registration.category_id,
            Registration.status,
            Registration.payment_status,
            Registration.checked_in,
            Registration.total_amount_paise,
        )
        .where(Registration.event_id == event_id, Registration.status.in_(_VISIBLE_REGISTRATION_STATUSES))
        .order_by(Registration.created_at.asc(), Registration.id.asc())
    ).all()
    total_confirmed = sum(
        int(row.quantity or 0)
        for row in rows
        if row.payment_status in _CONFIRMED_PAYMENT_STATUSES and row.status in _CONFIRMED_REGISTRATION_STATUSES
    )

    limit = plan.max_confirmed_registrations if plan else None
    running_quantity = 0
    running_active_quantity = 0
    overflow_started_at = None
    visible_confirmed_ids: set[UUID] = set()
    visible_confirmed_by_ticket: dict[UUID, int] = {}
    visible_confirmed_by_category: dict[UUID | None, int] = {}
    visible_checked_in_quantity = 0
    visible_approved_amount = 0
    visible_confirmed_records = 0
    visible_checked_in_records = 0
    locked_confirmed_quantity = 0
    locked_confirmed_records = 0

    for row in rows:
        is_confirmed = row.payment_status in _CONFIRMED_PAYMENT_STATUSES and row.status in _CONFIRMED_REGISTRATION_STATUSES
        if row.status in _VISIBLE_REGISTRATION_STATUSES and limit is not None:
            projected_active_quantity = running_active_quantity + int(row.quantity or 0)
            if overflow_started_at is None and projected_active_quantity > limit and row.created_at is not None:
                overflow_started_at = row.created_at
            running_active_quantity = projected_active_quantity
        if not is_confirmed:
            continue
        quantity = int(row.quantity or 0)
        starts_within_limit = limit is None or running_quantity < limit
        visible_quantity = quantity if limit is None else max(0, min(quantity, limit - running_quantity))
        running_quantity += quantity
        if visible_quantity > 0:
            visible_confirmed_ids.add(row.id)
            visible_confirmed_by_ticket[row.ticket_id] = visible_confirmed_by_ticket.get(row.ticket_id, 0) + visible_quantity
            visible_confirmed_by_category[row.category_id] = visible_confirmed_by_category.get(row.category_id, 0) + visible_quantity
            visible_confirmed_records += 1
            if row.status == "checked_in" or row.checked_in:
                visible_checked_in_quantity += visible_quantity
                visible_checked_in_records += 1
            if row.payment_status in _CONFIRMED_PAYMENT_STATUSES:
                visible_approved_amount += int(row.total_amount_paise or 0) if visible_quantity == quantity else 0
        if visible_quantity < quantity:
            locked_confirmed_quantity += quantity - visible_quantity
            locked_confirmed_records += 1
        if not starts_within_limit and visible_quantity == 0:
            locked_confirmed_quantity += 0

    now = utc_now()
    grace_ends_at = None
    grace_active = False
    if overflow_started_at is not None and limit is not None and total_confirmed > limit:
        aware_started_at = overflow_started_at if overflow_started_at.tzinfo else overflow_started_at.replace(tzinfo=dt.timezone.utc)
        grace_ends_at = aware_started_at + dt.timedelta(hours=VISIBILITY_GRACE_HOURS)
        grace_active = now < grace_ends_at

    if grace_active:
        visible_confirmed_ids = {
            row.id
            for row in rows
            if row.payment_status in _CONFIRMED_PAYMENT_STATUSES and row.status in _CONFIRMED_REGISTRATION_STATUSES
        }
        visible_confirmed_by_ticket = {}
        visible_confirmed_by_category = {}
        visible_checked_in_quantity = 0
        visible_approved_amount = 0
        visible_confirmed_records = 0
        visible_checked_in_records = 0
        for row in rows:
            if row.id not in visible_confirmed_ids:
                continue
            quantity = int(row.quantity or 0)
            visible_confirmed_by_ticket[row.ticket_id] = visible_confirmed_by_ticket.get(row.ticket_id, 0) + quantity
            visible_confirmed_by_category[row.category_id] = visible_confirmed_by_category.get(row.category_id, 0) + quantity
            visible_confirmed_records += 1
            if row.status == "checked_in" or row.checked_in:
                visible_checked_in_quantity += quantity
                visible_checked_in_records += 1
            visible_approved_amount += int(row.total_amount_paise or 0)
        locked_confirmed_quantity = 0
        locked_confirmed_records = 0

    effective_limit = None if grace_active else limit
    locked_summary = None
    if locked_confirmed_quantity > 0 and next_plan is not None:
        unit = "registration" if next_plan.billing_unit == "per_registration" else "event"
        locked_summary = {
            "message": (
                f"{locked_confirmed_quantity} more registrations are locked. These participants have registered and may have already "
                f"paid you directly — upgrade to {next_plan.name} (₹{next_plan.price_paise / 100:g} / {unit}) to view their details, "
                "confirm payments, and include them in check-in and bib allotment."
            ),
            "upgradePlan": _serialize_plan(next_plan),
        }

    return {
        "plan": _serialize_plan(plan),
        "upgradePlan": _serialize_plan(next_plan),
        "planLimit": limit,
        "effectiveLimit": effective_limit,
        "totalConfirmedQuantity": total_confirmed,
        "visibleConfirmedQuantity": total_confirmed - locked_confirmed_quantity,
        "lockedConfirmedQuantity": locked_confirmed_quantity,
        "lockedConfirmedRecords": locked_confirmed_records,
        "visibleConfirmedRecords": visible_confirmed_records,
        "visibleCheckedInQuantity": visible_checked_in_quantity,
        "visibleCheckedInRecords": visible_checked_in_records,
        "visibleApprovedAmountPaise": visible_approved_amount,
        "visibleConfirmedRegistrationIds": visible_confirmed_ids,
        "visibleConfirmedByTicket": visible_confirmed_by_ticket,
        "visibleConfirmedByCategory": visible_confirmed_by_category,
        "graceActive": grace_active,
        "graceEndsAt": grace_ends_at.isoformat() if grace_ends_at else None,
        "lockedSummary": locked_summary,
        "isLocked": locked_confirmed_quantity > 0,
    }


def get_event_visibility(db: Session, user, event_id: UUID) -> dict:
    plans = _active_plans(db)
    return _event_visibility(db, user, event_id, plans)


def get_visibility_for_events(db: Session, user, event_ids: list[UUID]) -> dict[UUID, dict]:
    if not event_ids:
        return {}
    plans = _active_plans(db)
    return {event_id: _event_visibility(db, user, event_id, plans) for event_id in event_ids}


def serialize_visibility(visibility: dict) -> dict:
    return {
        "plan": visibility["plan"],
        "upgradePlan": visibility["upgradePlan"],
        "planLimit": visibility["planLimit"],
        "effectiveLimit": visibility["effectiveLimit"],
        "totalConfirmedQuantity": visibility["totalConfirmedQuantity"],
        "visibleConfirmedQuantity": visibility["visibleConfirmedQuantity"],
        "lockedConfirmedQuantity": visibility["lockedConfirmedQuantity"],
        "lockedConfirmedRecords": visibility["lockedConfirmedRecords"],
        "visibleConfirmedRecords": visibility["visibleConfirmedRecords"],
        "visibleCheckedInQuantity": visibility["visibleCheckedInQuantity"],
        "visibleCheckedInRecords": visibility["visibleCheckedInRecords"],
        "visibleApprovedAmountPaise": visibility["visibleApprovedAmountPaise"],
        "graceActive": visibility["graceActive"],
        "graceEndsAt": visibility["graceEndsAt"],
        "lockedSummary": visibility["lockedSummary"],
        "isLocked": visibility["isLocked"],
    }


def visibility_filter_for_events(
    db: Session,
    user,
    event_ids: list[UUID],
    *,
    visibility_by_event: dict[UUID, dict] | None = None,
):
    if visibility_by_event is None:
        visibility_by_event = get_visibility_for_events(db, user, event_ids)
    limits = {event_id: visibility["effectiveLimit"] for event_id, visibility in visibility_by_event.items()}
    limited_ids = [event_id for event_id, limit in limits.items() if limit is not None]
    if not limited_ids:
        return None
    cumulative_quantity = func.sum(Registration.quantity).over(
        partition_by=Registration.event_id,
        order_by=(Registration.created_at.asc(), Registration.id.asc()),
        rows=(None, 0),
    ).label("confirmed_cumulative_quantity")
    ranked = (
        select(Registration.id.label("registration_id"), Registration.event_id, cumulative_quantity)
        .where(Registration.event_id.in_(limited_ids), confirmed_registration_condition())
        .subquery()
    )
    conditions = []
    for event_id, limit in limits.items():
        if limit is None:
            conditions.append(Registration.event_id == event_id)
        else:
            conditions.append(
                and_(
                    Registration.event_id == event_id,
                    or_(ranked.c.confirmed_cumulative_quantity.is_(None), ranked.c.confirmed_cumulative_quantity <= limit),
                )
            )
    return ranked, or_(*conditions)
