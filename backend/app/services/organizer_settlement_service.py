from __future__ import annotations

import datetime as dt
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.services.audit_service import record_audit
from app.services.checkout_payments import fingerprint
from models import (
    CheckoutPayment,
    CheckoutReceipt,
    CashfreePaymentResolution,
    ManagedRegistrationCollection,
    Event,
    OrganizerPayableAdjustment,
    OrganizerSettlement,
    Payment,
    Refund,
    Registration,
    User,
    REFUND_STATUS_REFUNDED,
)


class SettlementValidationError(ValueError):
    pass


SETTLEMENT_METHODS = frozenset({"BANK_TRANSFER", "UPI", "OTHER"})


def _event(db: Session, event_id: UUID, *, lock: bool = False) -> Event:
    query = select(Event).where(Event.id == event_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    event = db.scalar(query)
    if event is None:
        raise SettlementValidationError("Event not found")
    return event


def post_verified_collection(db: Session, *, receipt_id: UUID) -> None:
    """Internal adapter hook, called in the payment transaction after verification.

    Never exposed as an admin/browser operation. No guessing or historical
    backfill from legacy payment status. Sandbox and split funds are excluded.
    Gateway caller locks its domain owner, then events in sorted ID order,
    then the shared payment. Settlement writers lock only event then transfer.
    """
    receipt = db.get(CheckoutReceipt, receipt_id)
    if receipt is None:
        raise SettlementValidationError("Verified receipt not found")
    checkout = db.get(CheckoutPayment, receipt.checkout_payment_id)
    if checkout is None or checkout.mode != "CASHFREE_PLATFORM" or receipt.environment != "production":
        return
    resolved = db.scalar(select(CashfreePaymentResolution.id).where(
        CashfreePaymentResolution.checkout_payment_id == checkout.id,
        CashfreePaymentResolution.receipt_id == receipt.id,
        CashfreePaymentResolution.action == "FULFILL",
        CashfreePaymentResolution.status == "FULFILLED"))
    if (receipt.provider != "cashfree" or (receipt.disposition != "confirmed" and not resolved) or checkout.status != "successful"
            or checkout.currency != "INR" or checkout.provider_environment != receipt.environment
            or not checkout.provider_order_id or not receipt.payment_id or not receipt.account
            or checkout.provider_account != receipt.account or checkout.amount_paise != receipt.amount_paise):
        raise SettlementValidationError("Receipt is not valid production collection evidence")
    registrations = db.scalars(select(Registration).join(Payment, Payment.registration_id == Registration.id)
        .where(Payment.order_id == checkout.event_order_id)).all()
    if not registrations:
        raise SettlementValidationError("Managed receipt has no registration allocations")
    for event_id in sorted({r.event_id for r in registrations}, key=str):
        _event(db, event_id, lock=True)
    if any(r.participant_total_paise is None or r.total_amount_paise is None for r in registrations):
        raise SettlementValidationError("Missing historical amount snapshots")
    if sum(r.participant_total_paise for r in registrations) != checkout.amount_paise or sum(r.platform_fee_paise for r in registrations) != checkout.fee_paise:
        raise SettlementValidationError("Registration allocations do not reconcile with the receipt")
    for registration in registrations:
        if registration.platform_fee_bearer not in {"ORGANIZER", "PARTICIPANT"}:
            raise SettlementValidationError("Invalid fee bearer snapshot")
        expected = registration.total_amount_paise + (registration.platform_fee_paise if registration.platform_fee_bearer == "PARTICIPANT" else 0)
        if expected != registration.participant_total_paise or registration.platform_fee_paise > expected:
            raise SettlementValidationError("Invalid registration financial snapshot")
        existing = db.scalar(select(ManagedRegistrationCollection).where(ManagedRegistrationCollection.registration_id == registration.id))
        if existing:
            if existing.receipt_id != receipt.id:
                raise SettlementValidationError("Registration already allocated to another receipt")
            continue
        event = db.get(Event, registration.event_id)
        db.add(ManagedRegistrationCollection(registration_id=registration.id, receipt_id=receipt.id,
            event_id=event.id, organizer_id=event.organization_id,
            registration_amount_paise=registration.total_amount_paise,
            platform_fee_paise=registration.platform_fee_paise, total_paid_paise=registration.participant_total_paise,
            organizer_payable_paise=registration.participant_total_paise - registration.platform_fee_paise,
            participant_count=registration.participant_count or 1))
    db.flush()


def settlement_summary(db: Session, *, event_id: UUID) -> dict:
    # A summary must not mix collections before a concurrent commit with paid
    # transfers after it. All financial writers serialize on this event lock.
    event = _event(db, event_id, lock=True)
    rows = db.scalars(select(ManagedRegistrationCollection).where(
        ManagedRegistrationCollection.event_id == event.id)).all()
    registration_ids = [r.registration_id for r in rows]
    by_registration = {r.registration_id: r for r in rows}
    gross_collections = sum(r.total_paid_paise for r in rows)
    gross_payable = sum(r.organizer_payable_paise for r in rows)
    participant_count = sum(r.participant_count for r in rows)

    refund_deduction = 0
    refund_count = 0
    if registration_ids:
        refunds = db.scalars(
            select(Refund).where(
                Refund.registration_id.in_(registration_ids),
                Refund.event_id == event.id,
                Refund.organizer_id == event.organization_id,
                Refund.payment_provider == "CASHFREE",
                Refund.status == REFUND_STATUS_REFUNDED,
                Refund.is_manual_refund.is_(False),
            )
        ).all()
        refunded_by_registration = {}
        for refund in refunds:
            approved = int(refund.approved_refund_amount or 0)
            fee_refund = int(refund.platform_fee_refund_amount or 0)
            collection = by_registration[refund.registration_id]
            if approved <= 0 or approved > collection.total_paid_paise or fee_refund < 0 or fee_refund > min(approved, collection.platform_fee_paise):
                raise SettlementValidationError("Refund amounts do not reconcile with the collection; review required")
            refunded_by_registration[refund.registration_id] = refunded_by_registration.get(refund.registration_id, 0) + approved
            if refunded_by_registration[refund.registration_id] > collection.total_paid_paise:
                raise SettlementValidationError("Cumulative refunds exceed the original collection")
            refund_deduction += approved - fee_refund
        refund_count = len(refunded_by_registration)

    adjustments = int(db.scalar(select(func.coalesce(func.sum(OrganizerPayableAdjustment.amount_paise), 0)).where(
        OrganizerPayableAdjustment.kind == "PAYABLE",
        OrganizerPayableAdjustment.event_id == event.id,
        OrganizerPayableAdjustment.organizer_id == event.organization_id,
    )) or 0)
    reversals = int(db.scalar(select(func.coalesce(func.sum(OrganizerPayableAdjustment.amount_paise), 0)).where(
        OrganizerPayableAdjustment.event_id == event.id,
        OrganizerPayableAdjustment.kind == "SETTLEMENT_REVERSAL",
    )) or 0)
    paid = int(db.scalar(select(func.coalesce(func.sum(OrganizerSettlement.amount_paise), 0)).where(
        OrganizerSettlement.event_id == event.id,
        OrganizerSettlement.organizer_id == event.organization_id,
        OrganizerSettlement.status == "PAID",
    )) or 0)
    pending = int(db.scalar(select(func.coalesce(func.sum(OrganizerSettlement.amount_paise), 0)).where(
        OrganizerSettlement.event_id == event.id,
        OrganizerSettlement.organizer_id == event.organization_id,
        OrganizerSettlement.status == "PENDING",
    )) or 0)
    organizer_payable = gross_payable - refund_deduction + adjustments
    outstanding = organizer_payable - paid + reversals
    return {
        "eventId": str(event.id),
        "eventName": event.name,
        "organizerId": str(event.organization_id),
        "organizerName": event.organization.name if event.organization else None,
        "paymentMode": event.payment_collection_method,
        "paidRegistrationCount": len(rows),
        "totalRegistrationCount": int(db.scalar(select(func.count()).select_from(Registration).where(Registration.event_id == event.id)) or 0),
        "paidParticipantCount": participant_count,
        "refundedRegistrationCount": refund_count,
        "grossCollectionsPaise": gross_collections,
        "grossOrganizerPayablePaise": gross_payable,
        "refundsPaise": refund_deduction,
        "adjustmentsPaise": adjustments,
        "organizerPayablePaise": organizer_payable,
        "settledAmountPaise": paid - reversals,
        "recordedPaidPaise": paid,
        "reversedPaise": reversals,
        "recoverablePaise": max(0, -outstanding),
        "pendingSettlementPaise": pending,
        "outstandingAmountPaise": outstanding,
        "availableToSettlePaise": max(0, outstanding - pending),
        "reservationShortfallPaise": max(0, pending - max(0, outstanding)),
    }


def serialize_settlement(row: OrganizerSettlement) -> dict:
    return {
        "id": str(row.id), "organizerId": str(row.organizer_id), "eventId": str(row.event_id),
        "version": row.version,
        "amountPaise": row.amount_paise, "method": row.method, "referenceNumber": row.reference_number,
        "settlementDate": row.settlement_date.isoformat(), "status": row.status, "notes": row.notes,
        "provider": row.provider, "providerTransferId": row.provider_transfer_id,
        "providerStatus": row.provider_status, "createdBy": str(row.created_by),
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
    }


def list_settlements(db: Session, *, event_id: UUID) -> list[dict]:
    event = _event(db, event_id)
    rows = db.scalars(select(OrganizerSettlement).where(
        OrganizerSettlement.event_id == event.id,
        OrganizerSettlement.organizer_id == event.organization_id,
    ).order_by(OrganizerSettlement.settlement_date.desc(), OrganizerSettlement.created_at.desc())).all()
    users = {u.id: u.name for u in db.scalars(select(User).where(User.id.in_({r.created_by for r in rows}))).all()}
    return [{**serialize_settlement(row), "createdByName": users.get(row.created_by, str(row.created_by))} for row in rows]


def create_settlement(db: Session, *, event_id: UUID, actor_user_id: UUID, amount_paise: int,
                      method: str, reference_number: str | None, settlement_date: dt.date,
                      status: str, notes: str | None, idempotency_key: str) -> OrganizerSettlement:
    event = _event(db, event_id, lock=True)
    reference_number = (reference_number or "").strip().upper() or None
    notes = (notes or "").strip() or None
    idempotency_key = idempotency_key.strip()
    digest = fingerprint(dict(amount=amount_paise, method=method, reference=reference_number,
                              date=str(settlement_date), status=status, notes=notes))
    existing = db.scalar(select(OrganizerSettlement).where(
        OrganizerSettlement.event_id == event.id,
        OrganizerSettlement.idempotency_key == idempotency_key,
    ))
    if existing is not None:
        if existing.request_fingerprint != digest:
            raise SettlementValidationError("Idempotency key was already used with different settlement details")
        return existing
    if type(amount_paise) is not int or not 100 <= amount_paise <= 2_147_483_647:
        raise SettlementValidationError("Settlement must be at least ₹1 and within the supported amount limit")
    if len(idempotency_key) < 8 or len(idempotency_key) > 120:
        raise SettlementValidationError("Request key must be 8–120 characters")
    if settlement_date > dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30))).date():
        raise SettlementValidationError("Settlement date cannot be in the future")
    if status == "PAID" and not reference_number:
        raise SettlementValidationError("A bank / UPI reference is required for a paid transfer")
    if reference_number and db.scalar(select(OrganizerSettlement.id).where(OrganizerSettlement.reference_number == reference_number)):
        raise SettlementValidationError("This transfer reference is already recorded")
    if method not in SETTLEMENT_METHODS or status not in {"PENDING", "PAID"}:
        raise SettlementValidationError("Invalid settlement method or initial status")
    summary = settlement_summary(db, event_id=event.id)
    if amount_paise > summary["availableToSettlePaise"]:
        raise SettlementValidationError("Settlement amount exceeds the available outstanding balance")
    row = OrganizerSettlement(
        organizer_id=event.organization_id, event_id=event.id, amount_paise=amount_paise,
        method=method, reference_number=(reference_number or "").strip() or None,
        settlement_date=settlement_date, status=status, notes=(notes or "").strip() or None,
        idempotency_key=idempotency_key.strip(), provider="MANUAL", created_by=actor_user_id,
        request_fingerprint=digest,
    )
    if not row.idempotency_key:
        raise SettlementValidationError("Idempotency key is required")
    db.add(row)
    db.flush()
    record_audit(db, actor_user_id=actor_user_id, action="organizer_settlement_created",
                 resource_type="organizer_settlement", resource_id=row.id,
                 metadata={"eventId": str(event.id), "amountPaise": amount_paise, "status": status})
    return row


def update_pending_settlement(db: Session, *, settlement_id: UUID, actor_user_id: UUID,
                              amount_paise: int, method: str, reference_number: str | None,
                              settlement_date: dt.date, status: str, notes: str | None,
                              event_id: UUID, expected_version: int) -> OrganizerSettlement:
    _event(db, event_id, lock=True)
    row = db.scalar(select(OrganizerSettlement).where(OrganizerSettlement.id == settlement_id,
        OrganizerSettlement.event_id == event_id).with_for_update().execution_options(populate_existing=True))
    if row is None:
        raise SettlementValidationError("Settlement not found")
    if row.status != "PENDING":
        raise SettlementValidationError("Only pending settlements can be edited")
    if row.version != expected_version:
        raise SettlementValidationError("Another admin changed this transfer. Reload before editing")
    if type(amount_paise) is not int or amount_paise <= 0 or method not in SETTLEMENT_METHODS or status not in {"PENDING", "PAID", "FAILED", "CANCELLED"}:
        raise SettlementValidationError("Invalid settlement update")
    summary = settlement_summary(db, event_id=row.event_id)
    available_including_this = summary["outstandingAmountPaise"] - summary["pendingSettlementPaise"] + row.amount_paise
    if status in {"PAID", "PENDING"} and amount_paise > available_including_this:
        raise SettlementValidationError("Settlement amount exceeds the available outstanding balance")
    before = serialize_settlement(row)
    reference_number = (reference_number or "").strip().upper() or None
    if status == "PAID" and not reference_number:
        raise SettlementValidationError("A reference is required for a paid transfer")
    if amount_paise < 100 or amount_paise > 2_147_483_647:
        raise SettlementValidationError("Invalid amount: minimum ₹1")
    if settlement_date > dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30))).date():
        raise SettlementValidationError("Settlement date cannot be in the future")
    if reference_number and db.scalar(select(OrganizerSettlement.id).where(
        OrganizerSettlement.reference_number == reference_number, OrganizerSettlement.id != row.id)):
        raise SettlementValidationError("This transfer reference is already recorded")
    row.amount_paise, row.method, row.reference_number = amount_paise, method, (reference_number or "").strip() or None
    row.settlement_date, row.status, row.notes = settlement_date, status, (notes or "").strip() or None
    row.version += 1
    db.flush()
    record_audit(db, actor_user_id=actor_user_id, action="organizer_settlement_updated",
                 resource_type="organizer_settlement", resource_id=row.id,
                 metadata={"before": before, "status": status, "amountPaise": amount_paise})
    return row


def create_adjustment(db: Session, *, event_id: UUID, actor_user_id: UUID, amount_paise: int, reason: str,
                      idempotency_key: str, settlement_id: UUID | None = None) -> OrganizerPayableAdjustment:
    event = _event(db, event_id, lock=True)
    reason = reason.strip()
    idempotency_key = idempotency_key.strip()
    if len(idempotency_key) < 8:
        raise SettlementValidationError("An idempotency key is required")
    digest = fingerprint(dict(amount=amount_paise, reason=reason, settlement=str(settlement_id)))
    existing = db.scalar(select(OrganizerPayableAdjustment).where(
        OrganizerPayableAdjustment.event_id == event.id, OrganizerPayableAdjustment.idempotency_key == idempotency_key))
    if existing:
        if existing.request_fingerprint != digest:
            raise SettlementValidationError("Request key already used with different details")
        return existing
    if type(amount_paise) is not int or amount_paise == 0 or len(reason.strip()) < 3:
        raise SettlementValidationError("A non-zero amount and reason are required")
    summary = settlement_summary(db, event_id=event.id)
    if abs(amount_paise) > 2_147_483_647:
        raise SettlementValidationError("Amount exceeds supported limit")
    if summary["paidRegistrationCount"] == 0:
        raise SettlementValidationError("Adjustments require verified managed collections")
    if settlement_id:
        original = db.scalar(select(OrganizerSettlement).where(OrganizerSettlement.id == settlement_id,
            OrganizerSettlement.event_id == event.id, OrganizerSettlement.status == "PAID"))
        reversed_amount = int(db.scalar(select(func.coalesce(func.sum(OrganizerPayableAdjustment.amount_paise), 0)).where(
            OrganizerPayableAdjustment.settlement_id == settlement_id)) or 0)
        if not original or amount_paise <= 0 or amount_paise > original.amount_paise - reversed_amount:
            raise SettlementValidationError("Reversal exceeds the remaining paid transfer amount")
    row = OrganizerPayableAdjustment(organizer_id=event.organization_id, event_id=event.id,
                                     amount_paise=amount_paise, reason=reason.strip(), created_by=actor_user_id,
                                     idempotency_key=idempotency_key, request_fingerprint=digest,
                                     settlement_id=settlement_id, kind="SETTLEMENT_REVERSAL" if settlement_id else "PAYABLE")
    db.add(row)
    db.flush()
    record_audit(db, actor_user_id=actor_user_id, action="organizer_payable_adjusted",
                 resource_type="organizer_payable_adjustment", resource_id=row.id,
                 metadata={"eventId": str(event.id), "amountPaise": amount_paise, "reason": reason.strip()})
    return row
