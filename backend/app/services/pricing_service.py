from __future__ import annotations

from uuid import UUID

from sqlalchemy import and_, delete, func, select
from sqlalchemy.orm import Session

from app.services.audit_service import record_audit
from models import Event, FoundingProgram, FoundingProgramOrganization, Organization, OrganizationMember, OrganizerEventBilling, PricingPlan, Registration

BILLING_STATUSES = frozenset({"waived", "not_billed", "payment_due", "overdue", "paid_manual"})
BILLING_UNITS = frozenset({"per_event", "per_registration"})


class PricingValidationError(ValueError):
    """Raised when a pricing configuration cannot be saved."""


def _money(plan: PricingPlan | None) -> dict | None:
    if plan is None:
        return None
    return {
        "id": str(plan.id),
        "code": plan.code,
        "name": plan.name,
        "minConfirmedRegistrations": plan.min_confirmed_registrations,
        "maxConfirmedRegistrations": plan.max_confirmed_registrations,
        "pricePaise": plan.price_paise,
        "billingUnit": plan.billing_unit,
        "currency": plan.currency,
        "active": plan.active,
        "sortOrder": plan.sort_order,
    }


def serialize_plan(plan: PricingPlan) -> dict:
    return _money(plan)  # type: ignore[return-value]


def _plan_amount(plan: PricingPlan | None, confirmed_registrations: int) -> int:
    if plan is None:
        return 0
    if plan.billing_unit == "per_registration":
        return plan.price_paise * max(0, confirmed_registrations)
    return plan.price_paise


def _program_config(program: FoundingProgram, *, eligible: bool) -> dict:
    return {
        "enabled": program.enabled,
        "freeRacesCount": program.free_races_count,
        "defaultDiscountBasisPoints": program.default_discount_basis_points,
        "defaultDiscountPercent": program.default_discount_basis_points / 100,
        "eligible": eligible,
    }


def _active_plans(db: Session) -> list[PricingPlan]:
    return list(
        db.scalars(
            select(PricingPlan)
            .where(PricingPlan.active.is_(True))
            .order_by(PricingPlan.sort_order.asc(), PricingPlan.min_confirmed_registrations.asc())
        ).all()
    )


def _resolve_plan(plans: list[PricingPlan], confirmed_registrations: int) -> PricingPlan | None:
    for plan in plans:
        if plan.min_confirmed_registrations <= confirmed_registrations and (
            plan.max_confirmed_registrations is None or confirmed_registrations <= plan.max_confirmed_registrations
        ):
            return plan
    # A new race has zero confirmed registrations, but should still show the entry plan as its estimate.
    return plans[0] if plans and confirmed_registrations < plans[0].min_confirmed_registrations else None


def _confirmed_counts(db: Session, organization_id: UUID, event_ids: list[UUID]) -> dict[UUID, int]:
    if not event_ids:
        return {}
    rows = db.execute(
        select(Event.id, func.coalesce(func.sum(Registration.quantity), 0))
        .outerjoin(
            Registration,
            and_(
                Registration.event_id == Event.id,
                Registration.payment_status.in_(["approved", "not_required"]),
                Registration.status.in_(["confirmed", "checked_in"]),
            ),
        )
        .where(Event.organization_id == organization_id, Event.id.in_(event_ids))
        .group_by(Event.id)
    ).all()
    return {event_id: int(count or 0) for event_id, count in rows}


def _organization_pricing(db: Session, organization: Organization, plans: list[PricingPlan], program: FoundingProgram) -> dict:
    founding = {
        "enabled": program.enabled,
        "freeRacesCount": program.free_races_count,
        "defaultDiscountBasisPoints": program.default_discount_basis_points,
        "defaultDiscountPercent": program.default_discount_basis_points / 100,
    }
    events = list(
        db.scalars(
            select(Event)
            .where(Event.organization_id == organization.id, Event.archived_at.is_(None))
            .order_by(Event.created_at.asc(), Event.id.asc())
        ).all()
    )
    counts = _confirmed_counts(db, organization.id, [event.id for event in events])
    eligible = db.scalar(
        select(FoundingProgramOrganization).where(
            FoundingProgramOrganization.program_id == program.id,
            FoundingProgramOrganization.organization_id == organization.id,
        )
    ) is not None
    billing_by_event = {
        billing.event_id: billing
        for billing in db.scalars(
            select(OrganizerEventBilling).where(OrganizerEventBilling.event_id.in_([event.id for event in events]))
        ).all()
    }
    event_rows = []
    for index, event in enumerate(events):
        confirmed = counts.get(event.id, 0)
        plan = _resolve_plan(plans, confirmed)
        base = _plan_amount(plan, confirmed)
        is_free_race = founding["enabled"] and eligible and index < founding["freeRacesCount"]
        discount = base if is_free_race else 0
        billing = billing_by_event.get(event.id)
        stored_plan = billing.plan if billing and billing.plan_id else None
        event_rows.append(
            {
                "id": str(event.id),
                "name": event.name,
                "status": event.status,
                "createdAt": event.created_at.isoformat() if event.created_at else None,
                "confirmedRegistrations": billing.confirmed_registrations if billing else confirmed,
                "raceNumber": index + 1,
                "applicablePlan": _money(stored_plan or plan),
                "applicablePricePaise": billing.applicable_price_paise if billing else base,
                "discountPaise": billing.discount_paise if billing else discount,
                "finalAmountPaise": billing.final_amount_paise if billing else max(0, base - discount),
                "currency": billing.currency if billing else (plan.currency if plan else "INR"),
                "billingStatus": billing.billing_status if billing else ("waived" if is_free_race else "not_billed"),
                "dueAt": billing.due_at if billing else None,
                "finalizedAt": billing.finalized_at if billing else None,
                "paidAt": billing.paid_at if billing else None,
                "paymentReference": billing.payment_reference if billing else None,
            }
        )
    return {
        "id": str(organization.id),
        "name": organization.name,
        "status": organization.status,
        "confirmedRegistrations": sum(item["confirmedRegistrations"] for item in event_rows),
        "foundingProgram": {**founding, "eligible": eligible},
        "events": event_rows,
    }


def _get_or_create_program(db: Session) -> FoundingProgram:
    program = db.get(FoundingProgram, 1)
    if program is None:
        program = FoundingProgram(id=1, enabled=True, free_races_count=1, default_discount_basis_points=10_000)
        db.add(program)
        db.flush()
    return program


def get_organizer_pricing(db: Session, user) -> dict:
    if user.role == "admin":
        organizations = list(db.scalars(select(Organization).where(Organization.status == "active").order_by(Organization.name.asc())).all())
    else:
        organizations = list(
            db.scalars(
                select(Organization)
                .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
                .where(
                    OrganizationMember.user_id == user.id,
                    OrganizationMember.member_role == "organizer",
                    Organization.status == "active",
                )
                .order_by(Organization.name.asc())
            ).all()
        )
    plans = _active_plans(db)
    program = _get_or_create_program(db)
    return {
        "currency": "INR",
        "plans": [_money(plan) for plan in plans],
        "foundingProgram": {
            "enabled": program.enabled,
            "freeRacesCount": program.free_races_count,
            "defaultDiscountBasisPoints": program.default_discount_basis_points,
            "defaultDiscountPercent": program.default_discount_basis_points / 100,
        },
        "organizations": [_organization_pricing(db, organization, plans, program) for organization in organizations],
    }


def get_admin_pricing(db: Session) -> dict:
    program = _get_or_create_program(db)
    organizations = list(db.scalars(select(Organization).order_by(Organization.name.asc())).all())
    eligible_ids = {
        link.organization_id
        for link in db.scalars(select(FoundingProgramOrganization).where(FoundingProgramOrganization.program_id == program.id)).all()
    }
    return {
        "plans": [_money(plan) for plan in db.scalars(select(PricingPlan).order_by(PricingPlan.sort_order.asc())).all()],
        "foundingProgram": {
            "enabled": program.enabled,
            "freeRacesCount": program.free_races_count,
            "defaultDiscountBasisPoints": program.default_discount_basis_points,
            "defaultDiscountPercent": program.default_discount_basis_points / 100,
        },
        "organizations": [
            {"id": str(org.id), "name": org.name, "status": org.status, "eligible": org.id in eligible_ids}
            for org in organizations
        ],
    }


def _validate_ranges(db: Session, *, plan_id: UUID | None, minimum: int, maximum: int | None) -> None:
    if minimum < 0 or (maximum is not None and maximum < minimum):
        raise PricingValidationError("Registration range is invalid")
    existing = list(db.scalars(select(PricingPlan).where(PricingPlan.active.is_(True), PricingPlan.id != plan_id)).all())
    ranges = [(item.min_confirmed_registrations, item.max_confirmed_registrations, item.name) for item in existing]
    ranges.append((minimum, maximum, "updated plan"))
    ranges.sort(key=lambda item: item[0])
    for previous, current in zip(ranges, ranges[1:]):
        if previous[1] is None or current[0] <= previous[1]:
            raise PricingValidationError("Active plan registration ranges cannot overlap")


def update_plan(
    db: Session,
    *,
    plan_id: UUID,
    actor_user_id: UUID,
    name: str,
    minimum: int,
    maximum: int | None,
    price_paise: int,
    billing_unit: str,
    active: bool,
    sort_order: int,
) -> dict:
    if price_paise < 0 or sort_order < 0 or not name.strip() or billing_unit not in BILLING_UNITS:
        raise PricingValidationError("Plan name, price, billing unit, and sort order are invalid")
    plan = db.get(PricingPlan, plan_id)
    if plan is None:
        raise PricingValidationError("Plan not found")
    if active:
        _validate_ranges(db, plan_id=plan.id, minimum=minimum, maximum=maximum)
    previous = _money(plan)
    plan.name = name.strip()
    plan.min_confirmed_registrations = minimum
    plan.max_confirmed_registrations = maximum
    plan.price_paise = price_paise
    plan.billing_unit = billing_unit
    plan.active = active
    plan.sort_order = sort_order
    record_audit(db, actor_user_id=actor_user_id, action="pricing_plan_updated", resource_type="pricing_plan", resource_id=plan.id, metadata={"previous": previous, "updated": _money(plan)})
    db.commit()
    db.refresh(plan)
    return _money(plan)  # type: ignore[return-value]


def update_founding_program(db: Session, *, actor_user_id: UUID, enabled: bool, free_races_count: int, discount_basis_points: int, organization_ids: list[UUID]) -> dict:
    if free_races_count < 0 or discount_basis_points < 0 or discount_basis_points > 10_000:
        raise PricingValidationError("Founding program values are invalid")
    organizations = list(db.scalars(select(Organization).where(Organization.id.in_(organization_ids))).all()) if organization_ids else []
    if len(organizations) != len(set(organization_ids)):
        raise PricingValidationError("One or more eligible organizations were not found")
    program = _get_or_create_program(db)
    program.enabled = enabled
    program.free_races_count = free_races_count
    program.default_discount_basis_points = discount_basis_points
    db.execute(delete(FoundingProgramOrganization).where(FoundingProgramOrganization.program_id == program.id))
    for organization_id in organization_ids:
        db.add(FoundingProgramOrganization(program_id=program.id, organization_id=organization_id))
    record_audit(db, actor_user_id=actor_user_id, action="founding_program_updated", resource_type="founding_program", resource_id=program.id, metadata={"enabled": enabled, "freeRacesCount": free_races_count, "eligibleOrganizationCount": len(organization_ids)})
    db.commit()
    return {"enabled": enabled, "freeRacesCount": free_races_count, "defaultDiscountBasisPoints": discount_basis_points, "defaultDiscountPercent": discount_basis_points / 100}
