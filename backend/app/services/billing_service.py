from __future__ import annotations

import datetime as dt
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.services.audit_service import record_audit
from app.services.auth_service import utc_now
from app.services.pricing_service import _active_plans, _organization_pricing
from models import Event, FoundingProgram, Organization, OrganizerEventBilling

BILLING_STATUSES = frozenset({"waived", "not_billed", "payment_due", "overdue", "paid_manual"})


class BillingValidationError(ValueError):
    """Raised when a billing operation cannot be completed."""


def _program(db: Session) -> FoundingProgram:
    program = db.get(FoundingProgram, 1)
    if program is not None:
        return program
    return FoundingProgram(id=1, enabled=True, free_races_count=1, default_discount_basis_points=10_000)


def _sync_overdue(billing: OrganizerEventBilling, now: dt.datetime | None = None) -> bool:
    now = now or utc_now()
    if billing.billing_status == "payment_due" and billing.due_at is not None:
        due_at = billing.due_at if billing.due_at.tzinfo else billing.due_at.replace(tzinfo=dt.timezone.utc)
        if now > due_at:
            billing.billing_status = "overdue"
            return True
    return False


def _serialize_billing(billing: OrganizerEventBilling, event: Event | None = None, organization: Organization | None = None) -> dict:
    return {
        "id": str(billing.id),
        "eventId": str(billing.event_id),
        "eventName": event.name if event else None,
        "eventStatus": event.status if event else None,
        "organizationId": str(billing.organization_id),
        "organizationName": organization.name if organization else None,
        "planId": str(billing.plan_id) if billing.plan_id else None,
        "planCode": billing.plan_code,
        "planName": billing.plan_name,
        "billingUnit": billing.plan.billing_unit if billing.plan else None,
        "confirmedRegistrations": billing.confirmed_registrations,
        "applicablePricePaise": billing.applicable_price_paise,
        "discountPaise": billing.discount_paise,
        "finalAmountPaise": billing.final_amount_paise,
        "currency": billing.currency,
        "billingStatus": billing.billing_status,
        "dueAt": billing.due_at,
        "finalizedAt": billing.finalized_at,
        "paidAt": billing.paid_at,
        "paymentReference": billing.payment_reference,
        "notes": billing.notes,
    }


def _preview_for_event(db: Session, event: Event) -> dict:
    plans = _active_plans(db)
    pricing = _organization_pricing(db, event.organization, plans, _program(db))
    preview = next((item for item in pricing["events"] if item["id"] == str(event.id)), None)
    if preview is None:
        raise BillingValidationError("Event is not available for billing")
    return preview


def _preview_record(event: Event, preview: dict) -> dict:
    return {
        "id": None,
        "eventId": str(event.id),
        "eventName": event.name,
        "eventStatus": event.status,
        "organizationId": str(event.organization_id),
        "organizationName": event.organization.name,
        "planId": preview["applicablePlan"]["id"] if preview["applicablePlan"] else None,
        "planCode": preview["applicablePlan"]["code"] if preview["applicablePlan"] else None,
        "planName": preview["applicablePlan"]["name"] if preview["applicablePlan"] else None,
        "billingUnit": preview["applicablePlan"]["billingUnit"] if preview["applicablePlan"] else None,
        "confirmedRegistrations": preview["confirmedRegistrations"],
        "applicablePricePaise": preview["applicablePricePaise"],
        "discountPaise": preview["discountPaise"],
        "finalAmountPaise": preview["finalAmountPaise"],
        "currency": preview["currency"],
        "billingStatus": "not_billed",
        "dueAt": None,
        "finalizedAt": None,
        "paidAt": None,
        "paymentReference": None,
        "notes": None,
    }


def list_admin_billing(db: Session) -> list[dict]:
    events = list(
        db.scalars(
            select(Event)
            .join(Organization, Organization.id == Event.organization_id)
            .options(selectinload(Event.organization), selectinload(Event.billing))
            .where(Event.archived_at.is_(None))
            .order_by(Event.created_at.desc(), Event.id.desc())
        ).all()
    )
    changed = False
    records = []
    for event in events:
        if event.billing is not None:
            changed = _sync_overdue(event.billing) or changed
            records.append(_serialize_billing(event.billing, event, event.organization))
        else:
            records.append(_preview_record(event, _preview_for_event(db, event)))
    if changed:
        db.commit()
    return records


def finalize_event_billing(db: Session, *, event_id: UUID, actor_user_id: UUID, due_days: int) -> dict:
    if due_days < 1 or due_days > 90:
        raise BillingValidationError("Due period must be between 1 and 90 days")
    event = db.scalar(
        select(Event)
        .options(selectinload(Event.organization), selectinload(Event.billing))
        .where(Event.id == event_id)
        .with_for_update()
    )
    if event is None or event.archived_at is not None:
        raise BillingValidationError("Event not found")
    if event.billing is not None:
        changed = _sync_overdue(event.billing)
        if changed:
            db.commit()
        return _serialize_billing(event.billing, event, event.organization)

    preview = _preview_for_event(db, event)
    now = utc_now()
    is_waived = preview["billingStatus"] == "waived"
    plan = preview["applicablePlan"]
    billing = OrganizerEventBilling(
        event_id=event.id,
        organization_id=event.organization_id,
        plan_id=UUID(plan["id"]) if plan else None,
        plan_code=plan["code"] if plan else None,
        plan_name=plan["name"] if plan else None,
        confirmed_registrations=preview["confirmedRegistrations"],
        applicable_price_paise=preview["applicablePricePaise"],
        discount_paise=preview["discountPaise"],
        final_amount_paise=preview["finalAmountPaise"],
        currency=preview["currency"],
        billing_status="waived" if is_waived else "payment_due",
        due_at=None if is_waived else now + dt.timedelta(days=due_days),
        finalized_at=now,
    )
    db.add(billing)
    record_audit(
        db,
        actor_user_id=actor_user_id,
        action="organizer_event_billing_finalized",
        resource_type="organizer_event_billing",
        resource_id=event.id,
        metadata={"billingStatus": billing.billing_status, "finalAmountPaise": billing.final_amount_paise, "dueDays": due_days},
    )
    db.commit()
    db.refresh(billing)
    return _serialize_billing(billing, event, event.organization)


def mark_billing_paid(
    db: Session,
    *,
    billing_id: UUID,
    actor_user_id: UUID,
    payment_reference: str | None,
    notes: str | None,
) -> dict:
    billing = db.scalar(
        select(OrganizerEventBilling)
        .options(selectinload(OrganizerEventBilling.event), selectinload(OrganizerEventBilling.organization))
        .where(OrganizerEventBilling.id == billing_id)
        .with_for_update()
    )
    if billing is None:
        raise BillingValidationError("Billing record not found")
    _sync_overdue(billing)
    if billing.billing_status == "waived":
        raise BillingValidationError("A waived billing record cannot be marked paid")
    if billing.billing_status == "not_billed":
        raise BillingValidationError("Finalize the billing record before marking it paid")
    billing.billing_status = "paid_manual"
    billing.paid_at = utc_now()
    billing.payment_reference = payment_reference.strip() if payment_reference else None
    billing.notes = notes.strip() if notes else billing.notes
    record_audit(
        db,
        actor_user_id=actor_user_id,
        action="organizer_event_billing_marked_paid",
        resource_type="organizer_event_billing",
        resource_id=billing.id,
        metadata={"hasPaymentReference": bool(billing.payment_reference), "amountPaise": billing.final_amount_paise},
    )
    db.commit()
    return _serialize_billing(billing, billing.event, billing.organization)


def waive_billing(db: Session, *, billing_id: UUID, actor_user_id: UUID, notes: str | None) -> dict:
    billing = db.scalar(
        select(OrganizerEventBilling)
        .options(selectinload(OrganizerEventBilling.event), selectinload(OrganizerEventBilling.organization))
        .where(OrganizerEventBilling.id == billing_id)
        .with_for_update()
    )
    if billing is None:
        raise BillingValidationError("Billing record not found")
    billing.billing_status = "waived"
    billing.due_at = None
    billing.paid_at = None
    billing.notes = notes.strip() if notes else billing.notes
    record_audit(
        db,
        actor_user_id=actor_user_id,
        action="organizer_event_billing_waived",
        resource_type="organizer_event_billing",
        resource_id=billing.id,
        metadata={"amountPaise": billing.final_amount_paise},
    )
    db.commit()
    return _serialize_billing(billing, billing.event, billing.organization)
