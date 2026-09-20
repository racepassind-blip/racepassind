"""SportPass Organizer Platform Fee billing.

This is a SEPARATE, additive billing flow that runs alongside the existing
`billing_service` / `OrganizerEventBilling` (plan + founding-program) ledger.
It is NOT a replacement for it and it does not touch it.

Pricing rule (introductory pricing, configurable via `PlatformFeeConfig`):

    SportPass fee = (percentage_basis_points / 10000) * registration_revenue
                    + per_registration_paise * paid_registration_count

Only PAID events accrue a platform fee. A "paid registration" is a confirmed,
approved paid registration (revenue collected). Free events and free
registrations never generate a platform-fee bill.

Statuses:
    accruing     - implicit: fees are accruing, no bill has been raised yet
                   (represented by the absence of a billing row)
    payment_due  - a bill has been raised and is awaiting payment
    paid         - payment received and recorded
    overdue      - payment_due and past the due date
    waived       - fee waived by an admin, nothing to pay
"""

from __future__ import annotations

import datetime as dt
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session, selectinload

from app.services.audit_service import record_audit
from app.services.auth_service import utc_now
from models import (
    Event,
    EventCategory,
    Organization,
    OrganizerPlatformFeeBilling,
    PlatformFeeConfig,
    Registration,
)

# Persisted statuses (the "accruing" state is implicit — no row exists yet).
PLATFORM_FEE_STATUSES = frozenset({"payment_due", "paid", "overdue", "waived"})

# A paid registration for platform-fee purposes is a confirmed registration
# whose category/ticket actually carries a price (total_amount_paise > 0).
#
# Free vs paid is derived from the amount, NOT from payment_status. This is
# what makes offline / manual registrations for a PAID category count as paid
# even if the organizer has not (yet) flagged "payment received" — the money is
# owed either way. A registration for a FREE category has amount 0 and never
# counts. We only count confirmed/checked-in registrations so that
# awaiting-payment or rejected ones are excluded until they are confirmed.
_CONFIRMED_STATUSES = ("confirmed", "checked_in")


class PlatformFeeValidationError(ValueError):
    """Raised when a platform-fee operation cannot be completed."""


# ---------------------------------------------------------------------------
# Configuration (single source of truth for the rate)
# ---------------------------------------------------------------------------

def get_or_create_config(db: Session) -> PlatformFeeConfig:
    config = db.get(PlatformFeeConfig, 1)
    if config is None:
        config = PlatformFeeConfig(
            id=1,
            label="Introductory Pricing",
            percentage_basis_points=500,
            per_registration_paise=1000,
            currency="INR",
            default_due_days=14,
        )
        db.add(config)
        db.flush()
    return config


def serialize_config(config: PlatformFeeConfig) -> dict:
    return {
        "label": config.label,
        "percentageBasisPoints": config.percentage_basis_points,
        "percentagePercent": config.percentage_basis_points / 100,
        "perRegistrationPaise": config.per_registration_paise,
        "currency": config.currency,
        "defaultDueDays": config.default_due_days,
        "updatedAt": config.updated_at,
    }


def get_config(db: Session) -> dict:
    return serialize_config(get_or_create_config(db))


def update_config(
    db: Session,
    *,
    actor_user_id: UUID,
    label: str | None,
    percentage_basis_points: int,
    per_registration_paise: int,
    default_due_days: int,
) -> dict:
    if percentage_basis_points < 0 or percentage_basis_points > 10_000:
        raise PlatformFeeValidationError("Percentage must be between 0 and 10000 basis points")
    if per_registration_paise < 0:
        raise PlatformFeeValidationError("Per-registration fee must be a non-negative amount in paise")
    if default_due_days < 1 or default_due_days > 90:
        raise PlatformFeeValidationError("Default due period must be between 1 and 90 days")

    config = get_or_create_config(db)
    previous = serialize_config(config)
    if label is not None and label.strip():
        config.label = label.strip()
    config.percentage_basis_points = percentage_basis_points
    config.per_registration_paise = per_registration_paise
    config.default_due_days = default_due_days
    record_audit(
        db,
        actor_user_id=actor_user_id,
        action="platform_fee_config_updated",
        resource_type="platform_fee_config",
        resource_id=config.id,
        metadata={
            "previous": {
                "percentageBasisPoints": previous["percentageBasisPoints"],
                "perRegistrationPaise": previous["perRegistrationPaise"],
                "defaultDueDays": previous["defaultDueDays"],
            },
            "updated": {
                "percentageBasisPoints": config.percentage_basis_points,
                "perRegistrationPaise": config.per_registration_paise,
                "defaultDueDays": config.default_due_days,
            },
        },
    )
    db.commit()
    db.refresh(config)
    return serialize_config(config)


# ---------------------------------------------------------------------------
# Fee calculation from actual paid registrations
# ---------------------------------------------------------------------------

def compute_fee_paise(
    *,
    registration_revenue_paise: int,
    paid_registration_count: int,
    percentage_basis_points: int,
    per_registration_paise: int,
) -> int:
    """SportPass fee = pct% of revenue + flat per paid registration.

    Uses integer arithmetic in paise; the percentage component is rounded to
    the nearest paise (round-half-up).
    """
    percentage_component = (
        registration_revenue_paise * percentage_basis_points + 5_000
    ) // 10_000
    flat_component = per_registration_paise * max(0, paid_registration_count)
    return int(percentage_component + flat_component)


# Valid fee-bearer values, shared by events and registration snapshots.
FEE_BEARER_ORGANIZER = "ORGANIZER"
FEE_BEARER_PARTICIPANT = "PARTICIPANT"
FEE_BEARERS = frozenset({FEE_BEARER_ORGANIZER, FEE_BEARER_PARTICIPANT})


def compute_registration_fee_paise(
    *,
    base_amount_paise: int,
    percentage_basis_points: int,
    per_registration_paise: int,
) -> int:
    """The SportPass fee for a SINGLE registration of a given base amount.

    Free registrations (base 0) never accrue a fee. Otherwise the fee is
    5% of the base + ₹10 (i.e. the standard rule applied to one registration).
    """
    if base_amount_paise <= 0:
        return 0
    return compute_fee_paise(
        registration_revenue_paise=base_amount_paise,
        paid_registration_count=1,
        percentage_basis_points=percentage_basis_points,
        per_registration_paise=per_registration_paise,
    )


def compute_participant_pricing(
    db: Session,
    *,
    base_amount_paise: int,
    fee_bearer: str,
) -> dict:
    """Single source of truth for participant-facing pricing.

    Returns a snapshot dict with the base amount, the SportPass fee, the bearer,
    and the participant total. When the organizer absorbs the fee the participant
    total equals the base amount; when the participant bears it, the fee is added.
    The organizer is always owed the same SportPass fee regardless of bearer — that
    is tracked separately by the billing flow off the base amount.
    """
    bearer = fee_bearer if fee_bearer in FEE_BEARERS else FEE_BEARER_ORGANIZER
    config = get_or_create_config(db)
    fee_paise = compute_registration_fee_paise(
        base_amount_paise=base_amount_paise,
        percentage_basis_points=config.percentage_basis_points,
        per_registration_paise=config.per_registration_paise,
    )
    participant_total_paise = base_amount_paise + (fee_paise if bearer == FEE_BEARER_PARTICIPANT else 0)
    return {
        "baseAmountPaise": base_amount_paise,
        "platformFeePaise": fee_paise,
        "platformFeeBearer": bearer,
        "participantTotalPaise": participant_total_paise,
        "percentageBasisPoints": config.percentage_basis_points,
        "perRegistrationPaise": config.per_registration_paise,
        "currency": config.currency,
    }


def _paid_registration_stats(db: Session, event_ids: list[UUID]) -> dict[UUID, tuple[int, int]]:
    """Return {event_id: (paid_registration_count, revenue_paise)}.

    A paid registration is a confirmed (or checked-in) registration whose
    amount is greater than zero. This covers both online paid registrations and
    offline / manual registrations for a priced category, regardless of whether
    the organizer has flagged payment as received. Free-category registrations
    (amount 0) are excluded, so free events never accrue a fee.
    """
    if not event_ids:
        return {}
    rows = db.execute(
        select(
            Registration.event_id,
            func.coalesce(func.sum(Registration.quantity), 0),
            func.coalesce(func.sum(Registration.total_amount_paise), 0),
        )
        .where(
            Registration.event_id.in_(event_ids),
            Registration.status.in_(_CONFIRMED_STATUSES),
            Registration.total_amount_paise > 0,
        )
        .group_by(Registration.event_id)
    ).all()
    return {event_id: (int(count or 0), int(revenue or 0)) for event_id, count, revenue in rows}


def _category_breakdown(db: Session, event_ids: list[UUID]) -> dict[UUID, list[dict]]:
    """Return {event_id: [ {category, paid/free reg counts, revenue}, ... ]}.

    Splits confirmed registrations per category into paid (amount > 0) and free
    (amount == 0) so organizers can see exactly which categories contribute to
    the SportPass fee and which do not. Registrations with no category are
    grouped under an "Uncategorized" bucket.
    """
    if not event_ids:
        return {}
    rows = db.execute(
        select(
            Registration.event_id,
            Registration.category_id,
            EventCategory.name,
            func.coalesce(func.sum(Registration.quantity), 0),
            func.coalesce(func.sum(Registration.total_amount_paise), 0),
            func.count(),
        )
        .outerjoin(EventCategory, EventCategory.id == Registration.category_id)
        .where(
            Registration.event_id.in_(event_ids),
            Registration.status.in_(_CONFIRMED_STATUSES),
        )
        .group_by(Registration.event_id, Registration.category_id, EventCategory.name)
    ).all()

    # Accumulate per (event, category) splitting paid vs free by row amount.
    grouped: dict[UUID, dict[str, dict]] = {}
    for event_id, category_id, category_name, qty, revenue, entries in rows:
        qty = int(qty or 0)
        revenue = int(revenue or 0)
        entries = int(entries or 0)
        key = str(category_id) if category_id else "__none__"
        bucket = grouped.setdefault(event_id, {})
        row = bucket.setdefault(
            key,
            {
                "categoryId": str(category_id) if category_id else None,
                "categoryName": category_name or "Uncategorized",
                "paidRegistrations": 0,
                "freeRegistrations": 0,
                "revenuePaise": 0,
                "unitPricePaise": 0,
            },
        )
        if revenue > 0:
            row["paidRegistrations"] += qty
            row["revenuePaise"] += revenue
            if qty > 0:
                # Approximate per-entry price for display (revenue / paid qty).
                row["unitPricePaise"] = revenue // qty
        else:
            row["freeRegistrations"] += qty

    return {
        event_id: sorted(buckets.values(), key=lambda item: item["categoryName"].casefold())
        for event_id, buckets in grouped.items()
    }


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------

def _billing_status_for(billing: OrganizerPlatformFeeBilling, now: dt.datetime) -> str:
    if billing.billing_status == "payment_due" and billing.due_at is not None:
        due_at = billing.due_at if billing.due_at.tzinfo else billing.due_at.replace(tzinfo=dt.timezone.utc)
        if now > due_at:
            return "overdue"
    return billing.billing_status


def _sync_overdue(billing: OrganizerPlatformFeeBilling, now: dt.datetime | None = None) -> bool:
    now = now or utc_now()
    new_status = _billing_status_for(billing, now)
    if new_status != billing.billing_status:
        billing.billing_status = new_status
        return True
    return False


def _serialize_billing(
    billing: OrganizerPlatformFeeBilling,
    *,
    event: Event | None = None,
    organization: Organization | None = None,
    category_breakdown: list[dict] | None = None,
) -> dict:
    event = event or billing.event
    organization = organization or billing.organization
    return {
        "id": str(billing.id),
        "eventId": str(billing.event_id),
        "eventName": event.name if event else None,
        "eventStatus": event.status if event else None,
        "organizationId": str(billing.organization_id),
        "organizationName": organization.name if organization else None,
        "invoiceNumber": billing.invoice_number,
        "paidRegistrationCount": billing.paid_registration_count,
        "registrationRevenuePaise": billing.registration_revenue_paise,
        "percentageBasisPoints": billing.percentage_basis_points,
        "perRegistrationPaise": billing.per_registration_paise,
        "grossFeePaise": billing.gross_fee_paise,
        "discountPaise": billing.discount_paise,
        "finalAmountPaise": billing.final_amount_paise,
        "currency": billing.currency,
        "billingStatus": billing.billing_status,
        "dueAt": billing.due_at,
        "finalizedAt": billing.finalized_at,
        "paidAt": billing.paid_at,
        "paymentReference": billing.payment_reference,
        "notes": billing.notes,
        "feeBreakdown": _fee_breakdown(
            registration_revenue_paise=billing.registration_revenue_paise,
            paid_registration_count=billing.paid_registration_count,
            percentage_basis_points=billing.percentage_basis_points,
            per_registration_paise=billing.per_registration_paise,
            discount_paise=billing.discount_paise,
        ),
        "categoryBreakdown": category_breakdown or [],
    }


def _fee_breakdown(
    *,
    registration_revenue_paise: int,
    paid_registration_count: int,
    percentage_basis_points: int,
    per_registration_paise: int,
    discount_paise: int,
) -> dict:
    """A plain-language breakdown of how the SportPass fee was calculated.

    Returns each component in paise plus human-readable formulas so the UI can
    render the maths without re-deriving it.
    """
    percentage_component = (registration_revenue_paise * percentage_basis_points + 5_000) // 10_000
    flat_component = per_registration_paise * max(0, paid_registration_count)
    gross = percentage_component + flat_component
    return {
        "percentageBasisPoints": percentage_basis_points,
        "percentagePercent": percentage_basis_points / 100,
        "registrationRevenuePaise": registration_revenue_paise,
        "percentageComponentPaise": percentage_component,
        "perRegistrationPaise": per_registration_paise,
        "paidRegistrationCount": paid_registration_count,
        "flatComponentPaise": flat_component,
        "grossFeePaise": gross,
        "discountPaise": discount_paise,
        "finalAmountPaise": max(0, gross - discount_paise),
    }


def _preview_row(
    event: Event,
    organization: Organization,
    *,
    paid_count: int,
    revenue_paise: int,
    config: PlatformFeeConfig,
    category_breakdown: list[dict] | None = None,
) -> dict:
    """A synthesized (unraised) row for a paid event that is still accruing."""
    gross = compute_fee_paise(
        registration_revenue_paise=revenue_paise,
        paid_registration_count=paid_count,
        percentage_basis_points=config.percentage_basis_points,
        per_registration_paise=config.per_registration_paise,
    )
    return {
        "id": None,
        "eventId": str(event.id),
        "eventName": event.name,
        "eventStatus": event.status,
        "organizationId": str(event.organization_id),
        "organizationName": organization.name,
        "invoiceNumber": None,
        "paidRegistrationCount": paid_count,
        "registrationRevenuePaise": revenue_paise,
        "percentageBasisPoints": config.percentage_basis_points,
        "perRegistrationPaise": config.per_registration_paise,
        "grossFeePaise": gross,
        "discountPaise": 0,
        "finalAmountPaise": gross,
        "currency": config.currency,
        "billingStatus": "accruing",
        "dueAt": None,
        "finalizedAt": None,
        "paidAt": None,
        "paymentReference": None,
        "notes": None,
        "feeBreakdown": _fee_breakdown(
            registration_revenue_paise=revenue_paise,
            paid_registration_count=paid_count,
            percentage_basis_points=config.percentage_basis_points,
            per_registration_paise=config.per_registration_paise,
            discount_paise=0,
        ),
        "categoryBreakdown": category_breakdown or [],
    }


# ---------------------------------------------------------------------------
# Paid-event detection
# ---------------------------------------------------------------------------

def _is_paid_event(event: Event, paid_count: int, revenue_paise: int) -> bool:
    """A paid event is one that has any priced ticket.

    We treat an event as paid if any of its tickets has a non-zero price, OR
    if it has already collected paid-registration revenue. This keeps free
    events out of the platform-fee flow entirely.
    """
    if revenue_paise > 0 or paid_count > 0:
        return True
    tickets = event.tickets if event.tickets is not None else []
    return any((ticket.price or 0) > 0 for ticket in tickets)


# ---------------------------------------------------------------------------
# Listing (admin + organizer)
# ---------------------------------------------------------------------------

def _load_paid_events(db: Session, *, organization_ids: list[UUID] | None) -> list[Event]:
    query = (
        select(Event)
        .options(selectinload(Event.organization), selectinload(Event.tickets))
        .where(Event.archived_at.is_(None))
        .order_by(Event.created_at.desc(), Event.id.desc())
    )
    if organization_ids is not None:
        if not organization_ids:
            return []
        query = query.where(Event.organization_id.in_(organization_ids))
    return list(db.scalars(query).unique().all())


def _list_records(db: Session, *, organization_ids: list[UUID] | None) -> list[dict]:
    config = get_or_create_config(db)
    events = _load_paid_events(db, organization_ids=organization_ids)
    stats = _paid_registration_stats(db, [event.id for event in events])
    existing = {
        billing.event_id: billing
        for billing in db.scalars(
            select(OrganizerPlatformFeeBilling)
            .options(selectinload(OrganizerPlatformFeeBilling.event), selectinload(OrganizerPlatformFeeBilling.organization))
            .where(OrganizerPlatformFeeBilling.event_id.in_([event.id for event in events]))
        ).all()
    } if events else {}

    breakdowns = _category_breakdown(db, [event.id for event in events])

    now = utc_now()
    changed = False
    records: list[dict] = []
    for event in events:
        paid_count, revenue_paise = stats.get(event.id, (0, 0))
        categories = breakdowns.get(event.id, [])
        billing = existing.get(event.id)
        if billing is not None:
            changed = _sync_overdue(billing, now) or changed
            records.append(_serialize_billing(billing, event=event, organization=event.organization, category_breakdown=categories))
            continue
        # Only paid events show up in the platform-fee flow.
        if not _is_paid_event(event, paid_count, revenue_paise):
            continue
        records.append(_preview_row(event, event.organization, paid_count=paid_count, revenue_paise=revenue_paise, config=config, category_breakdown=categories))
    if changed:
        db.commit()
    return records


def list_admin_platform_fees(db: Session) -> dict:
    config = get_or_create_config(db)
    return {
        "config": serialize_config(config),
        "records": _list_records(db, organization_ids=None),
    }


def list_organizer_platform_fees(db: Session, organization_ids: list[UUID]) -> dict:
    config = get_or_create_config(db)
    records = _list_records(db, organization_ids=organization_ids)
    outstanding = sum(
        record["finalAmountPaise"]
        for record in records
        if record["billingStatus"] in {"payment_due", "overdue"}
    )
    accrued = sum(record["finalAmountPaise"] for record in records if record["billingStatus"] == "accruing")
    return {
        "config": serialize_config(config),
        "records": records,
        "summary": {
            "accruedFeePaise": accrued,
            "outstandingPaise": outstanding,
            "currency": config.currency,
        },
    }


# ---------------------------------------------------------------------------
# Invoice numbering
# ---------------------------------------------------------------------------

def _next_invoice_number(db: Session, now: dt.datetime) -> str:
    count = db.scalar(select(func.count()).select_from(OrganizerPlatformFeeBilling)) or 0
    return f"SPF-{now.year}-{count + 1:06d}"


# ---------------------------------------------------------------------------
# Mutations
# ---------------------------------------------------------------------------

def _load_event(db: Session, event_id: UUID) -> Event:
    event = db.scalar(
        select(Event)
        .options(selectinload(Event.organization), selectinload(Event.tickets), selectinload(Event.billing))
        .where(Event.id == event_id)
        .with_for_update(of=Event)
    )
    if event is None or event.archived_at is not None:
        raise PlatformFeeValidationError("Event not found")
    return event


def raise_bill(
    db: Session,
    *,
    event_id: UUID,
    actor_user_id: UUID,
    discount_paise: int = 0,
    due_days: int | None = None,
) -> dict:
    """Generate/raise a platform-fee bill for a paid event from actual paid registrations."""
    event = _load_event(db, event_id)
    existing = db.scalar(
        select(OrganizerPlatformFeeBilling)
        .where(OrganizerPlatformFeeBilling.event_id == event.id)
        .with_for_update()
    )
    if existing is not None:
        _sync_overdue(existing)
        db.commit()
        return _serialize_billing(existing, event=event, organization=event.organization)

    config = get_or_create_config(db)
    stats = _paid_registration_stats(db, [event.id])
    paid_count, revenue_paise = stats.get(event.id, (0, 0))
    if not _is_paid_event(event, paid_count, revenue_paise):
        raise PlatformFeeValidationError("Free events do not accrue a SportPass platform fee")

    gross = compute_fee_paise(
        registration_revenue_paise=revenue_paise,
        paid_registration_count=paid_count,
        percentage_basis_points=config.percentage_basis_points,
        per_registration_paise=config.per_registration_paise,
    )
    if discount_paise < 0 or discount_paise > gross:
        raise PlatformFeeValidationError("Discount must be between 0 and the gross fee")

    now = utc_now()
    days = config.default_due_days if due_days is None else due_days
    if days < 1 or days > 90:
        raise PlatformFeeValidationError("Due period must be between 1 and 90 days")

    billing = OrganizerPlatformFeeBilling(
        event_id=event.id,
        organization_id=event.organization_id,
        invoice_number=_next_invoice_number(db, now),
        paid_registration_count=paid_count,
        registration_revenue_paise=revenue_paise,
        percentage_basis_points=config.percentage_basis_points,
        per_registration_paise=config.per_registration_paise,
        gross_fee_paise=gross,
        discount_paise=discount_paise,
        final_amount_paise=max(0, gross - discount_paise),
        currency=config.currency,
        billing_status="payment_due",
        due_at=now + dt.timedelta(days=days),
        finalized_at=now,
    )
    db.add(billing)
    record_audit(
        db,
        actor_user_id=actor_user_id,
        action="platform_fee_bill_raised",
        resource_type="organizer_platform_fee_billing",
        resource_id=event.id,
        metadata={
            "grossFeePaise": gross,
            "discountPaise": discount_paise,
            "finalAmountPaise": billing.final_amount_paise,
            "paidRegistrationCount": paid_count,
            "dueDays": days,
        },
    )
    db.commit()
    db.refresh(billing)
    return _serialize_billing(billing, event=event, organization=event.organization)


def _load_billing(db: Session, billing_id: UUID) -> OrganizerPlatformFeeBilling:
    billing = db.scalar(
        select(OrganizerPlatformFeeBilling)
        .options(selectinload(OrganizerPlatformFeeBilling.event), selectinload(OrganizerPlatformFeeBilling.organization))
        .where(OrganizerPlatformFeeBilling.id == billing_id)
        .with_for_update()
    )
    if billing is None:
        raise PlatformFeeValidationError("Billing record not found")
    return billing


def apply_discount(db: Session, *, billing_id: UUID, actor_user_id: UUID, discount_paise: int) -> dict:
    billing = _load_billing(db, billing_id)
    if billing.billing_status in {"paid", "waived"}:
        raise PlatformFeeValidationError("Cannot change discount on a paid or waived bill")
    if discount_paise < 0 or discount_paise > billing.gross_fee_paise:
        raise PlatformFeeValidationError("Discount must be between 0 and the gross fee")
    previous_discount = billing.discount_paise
    billing.discount_paise = discount_paise
    billing.final_amount_paise = max(0, billing.gross_fee_paise - discount_paise)
    _sync_overdue(billing)
    record_audit(
        db,
        actor_user_id=actor_user_id,
        action="platform_fee_discount_applied",
        resource_type="organizer_platform_fee_billing",
        resource_id=billing.id,
        metadata={
            "previousDiscountPaise": previous_discount,
            "discountPaise": discount_paise,
            "finalAmountPaise": billing.final_amount_paise,
        },
    )
    db.commit()
    return _serialize_billing(billing)


def set_due_date(db: Session, *, billing_id: UUID, actor_user_id: UUID, due_at: dt.datetime) -> dict:
    billing = _load_billing(db, billing_id)
    if billing.billing_status in {"paid", "waived"}:
        raise PlatformFeeValidationError("Cannot change the due date on a paid or waived bill")
    previous = billing.due_at
    normalized = due_at if due_at.tzinfo else due_at.replace(tzinfo=dt.timezone.utc)
    billing.due_at = normalized
    billing.billing_status = "payment_due"
    _sync_overdue(billing)
    record_audit(
        db,
        actor_user_id=actor_user_id,
        action="platform_fee_due_date_set",
        resource_type="organizer_platform_fee_billing",
        resource_id=billing.id,
        metadata={
            "previousDueAt": previous.isoformat() if previous else None,
            "dueAt": normalized.isoformat(),
        },
    )
    db.commit()
    return _serialize_billing(billing)


def mark_paid(
    db: Session,
    *,
    billing_id: UUID,
    actor_user_id: UUID,
    payment_reference: str | None,
    notes: str | None,
) -> dict:
    billing = _load_billing(db, billing_id)
    if billing.billing_status == "waived":
        raise PlatformFeeValidationError("A waived bill cannot be marked paid")
    billing.billing_status = "paid"
    billing.paid_at = utc_now()
    billing.payment_reference = payment_reference.strip() if payment_reference else billing.payment_reference
    billing.notes = notes.strip() if notes else billing.notes
    record_audit(
        db,
        actor_user_id=actor_user_id,
        action="platform_fee_marked_paid",
        resource_type="organizer_platform_fee_billing",
        resource_id=billing.id,
        metadata={
            "hasPaymentReference": bool(billing.payment_reference),
            "finalAmountPaise": billing.final_amount_paise,
        },
    )
    db.commit()
    return _serialize_billing(billing)


def mark_overdue(db: Session, *, billing_id: UUID, actor_user_id: UUID) -> dict:
    billing = _load_billing(db, billing_id)
    if billing.billing_status in {"paid", "waived"}:
        raise PlatformFeeValidationError("Only an outstanding bill can be marked overdue")
    billing.billing_status = "overdue"
    record_audit(
        db,
        actor_user_id=actor_user_id,
        action="platform_fee_marked_overdue",
        resource_type="organizer_platform_fee_billing",
        resource_id=billing.id,
        metadata={"finalAmountPaise": billing.final_amount_paise},
    )
    db.commit()
    return _serialize_billing(billing)


def waive_bill(db: Session, *, billing_id: UUID, actor_user_id: UUID, notes: str | None) -> dict:
    billing = _load_billing(db, billing_id)
    billing.billing_status = "waived"
    billing.due_at = None
    billing.paid_at = None
    billing.notes = notes.strip() if notes else billing.notes
    record_audit(
        db,
        actor_user_id=actor_user_id,
        action="platform_fee_waived",
        resource_type="organizer_platform_fee_billing",
        resource_id=billing.id,
        metadata={"finalAmountPaise": billing.final_amount_paise},
    )
    db.commit()
    return _serialize_billing(billing)
