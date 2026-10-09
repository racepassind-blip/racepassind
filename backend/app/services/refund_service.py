"""Refund management service for SportPass.

Architecture:
  - Direct UPI refunds: manual — organizer marks sent with a UTR.
  - Cashfree refunds: admin initiates through the verified Cashfree integration.

Safety rules:
  - Never auto-trigger a Direct UPI refund from SportPass's account.
  - UTR is mandatory before Direct UPI refund can be marked sent.
  - Approved refund amount can never exceed original_total_paid.
  - Duplicate active refund requests per registration are blocked.
  - All state transitions are recorded in AuditLog.
"""
from __future__ import annotations

import datetime as dt
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, joinedload

from app.services.audit_service import record_audit
from app.services.auth_service import utc_now
from models import (
    Event,
    Organization,
    Participant,
    Payment,
    Refund,
    Registration,
    PAYMENT_PROVIDER_CASHFREE,
    PAYMENT_PROVIDER_DIRECT_UPI,
    REFUND_ACTIVE_STATUSES,
    REFUND_STATUS_APPROVED,
    REFUND_STATUS_CANCELLED,
    REFUND_STATUS_REFUND_SENT,
    REFUND_STATUS_REFUNDED,
    REFUND_STATUS_REJECTED,
    REFUND_STATUS_REQUESTED,
    REFUND_TERMINAL_STATUSES,
)

# Refund reasons shown to participants
REFUND_REASONS = [
    "Cannot attend",
    "Injury or medical reason",
    "Personal emergency",
    "Duplicate registration",
    "Event change",
    "Other",
]


# ---------------------------------------------------------------------------
# Eligibility helpers
# ---------------------------------------------------------------------------

def _payment_provider_for_payment(payment: Payment) -> str:
    """Derive the payment provider enum from the Payment record."""
    if payment.payment_gateway in ("manual_upi", "free", ""):
        return PAYMENT_PROVIDER_DIRECT_UPI
    if payment.payment_gateway and payment.payment_gateway.lower().startswith("cashfree"):
        return PAYMENT_PROVIDER_CASHFREE
    return PAYMENT_PROVIDER_DIRECT_UPI


def _calculate_requested_refund(
    *,
    registration_amount: int,
    platform_fee: int,
    refund_percentage: int,
    platform_fee_refundable: bool,
) -> tuple[int, int]:
    """Return (registration_refund_paise, platform_fee_refund_paise).

    Refund percentage applies only to the registration fee.
    Platform fee is either fully refunded or not at all — never partial.
    """
    reg_refund = (registration_amount * max(0, min(100, refund_percentage))) // 100
    fee_refund = platform_fee if platform_fee_refundable else 0
    return reg_refund, fee_refund


def check_refund_eligibility(
    db: Session,
    registration_id: UUID,
    *,
    for_participant: bool = True,
) -> dict:
    """Return eligibility dict. 'eligible' key is True only when all checks pass.

    Checks:
      - registration exists and is confirmed/paid
      - event refund policy is enabled
      - no active refund already exists
      - refund cutoff has not passed (if applicable)
      - policy type is not no_refund (when for_participant=True)
    """
    registration = db.scalar(
        select(Registration)
        .options(joinedload(Registration.payment))
        .where(Registration.id == registration_id)
    )
    if registration is None:
        return {"eligible": False, "reason": "Registration not found"}

    if registration.status not in ("confirmed", "checked_in"):
        return {"eligible": False, "reason": "Registration is not in a confirmed state"}

    if registration.payment_status not in ("approved", "not_required"):
        return {"eligible": False, "reason": "Registration payment has not been approved"}

    event = db.get(Event, registration.event_id)
    if event is None:
        return {"eligible": False, "reason": "Event not found"}

    if not event.refund_policy_enabled:
        return {"eligible": False, "reason": "This event does not have a refund policy"}

    # no_refund policy blocks participant-initiated requests
    if for_participant and event.refund_policy_type == "no_refund":
        return {"eligible": False, "reason": "This event does not allow refunds after registration"}

    # Check cutoff
    if event.refund_cutoff_at is not None:
        now = utc_now()
        cutoff = event.refund_cutoff_at
        if cutoff.tzinfo is None:
            cutoff = cutoff.replace(tzinfo=dt.timezone.utc)
        if now > cutoff:
            return {"eligible": False, "reason": "The refund cutoff date has passed"}

    # Check for existing active refund
    existing = db.scalar(
        select(Refund).where(
            Refund.registration_id == registration_id,
            Refund.status.in_(REFUND_ACTIVE_STATUSES),
        )
    )
    if existing is not None:
        return {"eligible": False, "reason": "A refund request is already in progress for this registration"}

    # Check for already-refunded
    already_done = db.scalar(
        select(Refund).where(
            Refund.registration_id == registration_id,
            Refund.status == REFUND_STATUS_REFUNDED,
        )
    )
    if already_done is not None:
        return {"eligible": False, "reason": "A refund has already been completed for this registration"}

    return {"eligible": True, "reason": None, "event": event, "registration": registration}


# ---------------------------------------------------------------------------
# Participant actions
# ---------------------------------------------------------------------------

def request_refund(
    db: Session,
    *,
    registration_id: UUID,
    actor_user_id: UUID | None,
    refund_reason: str,
    participant_comments: str | None,
) -> Refund:
    """Create a new REQUESTED refund for a confirmed paid registration."""
    # Match settlement/refund writers: event first, then registration.
    event_id = db.scalar(select(Registration.event_id).where(Registration.id == registration_id))
    if event_id is not None:
        db.scalar(select(Event).where(Event.id == event_id).with_for_update())
    db.scalar(select(Registration).where(Registration.id == registration_id)
              .with_for_update().execution_options(populate_existing=True))
    eligibility = check_refund_eligibility(db, registration_id, for_participant=True)
    if not eligibility["eligible"]:
        raise ValueError(eligibility["reason"])

    registration: Registration = eligibility["registration"]
    event: Event = eligibility["event"]

    payment = registration.payment
    if payment is None:
        raise ValueError("No payment record found for this registration")

    provider = _payment_provider_for_payment(payment)

    # Calculate requested refund amount based on policy
    refund_pct = event.refund_percentage if event.refund_percentage is not None else 100
    platform_fee_refundable = event.platform_fee_refundable and registration.platform_fee_bearer == "PARTICIPANT"

    reg_amount = registration.total_amount_paise or 0
    fee_amount = registration.platform_fee_paise or 0

    requested_reg_refund, requested_fee_refund = _calculate_requested_refund(
        registration_amount=reg_amount,
        platform_fee=fee_amount,
        refund_percentage=refund_pct,
        platform_fee_refundable=platform_fee_refundable,
    )
    total_requested = requested_reg_refund + requested_fee_refund

    now = utc_now()
    refund = Refund(
        registration_id=registration.id,
        event_id=registration.event_id,
        participant_id=registration.participant_id,
        organizer_id=event.organization_id,
        payment_method=payment.method or "manual_upi",
        payment_provider=provider,
        original_registration_amount=reg_amount,
        original_platform_fee=fee_amount,
        original_total_paid=registration.participant_total_paise or reg_amount,
        requested_refund_amount=total_requested,
        platform_fee_refund_amount=requested_fee_refund,
        refund_reason=refund_reason[:120],
        participant_comments=participant_comments,
        status=REFUND_STATUS_REQUESTED,
        requested_at=now,
    )
    db.add(refund)
    db.flush()

    record_audit(
        db,
        actor_user_id=actor_user_id,
        action="refund_requested",
        resource_type="refund",
        resource_id=refund.id,
        metadata={"registrationId": str(registration.id), "provider": provider, "requestedAmountPaise": total_requested},
    )
    db.commit()
    return db.get(Refund, refund.id)


def _locked_refund(db: Session, refund_id: UUID) -> Refund:
    event_id = db.scalar(select(Refund.event_id).where(Refund.id == refund_id))
    if event_id is None:
        raise ValueError("Refund not found")
    db.scalar(select(Event).where(Event.id == event_id).with_for_update())
    return db.scalar(select(Refund).where(Refund.id == refund_id).with_for_update()
                     .execution_options(populate_existing=True))


def confirm_refund_received(
    db: Session,
    *,
    refund_id: UUID,
    actor_user_id: UUID | None,
) -> Refund:
    """Participant confirms they received the refund — moves REFUND_SENT → REFUNDED."""
    refund = _locked_refund(db, refund_id)
    if refund is None:
        raise ValueError("Refund not found")
    if refund.status != REFUND_STATUS_REFUND_SENT:
        raise ValueError("Refund cannot be confirmed in its current state")

    # Serialize completed refund effects with manual settlement decisions.
    db.scalar(select(Event).where(Event.id == refund.event_id).with_for_update())

    now = utc_now()
    refund.status = REFUND_STATUS_REFUNDED
    refund.confirmed_at = now
    refund.updated_at = now

    # Update registration payment_status
    registration = db.get(Registration, refund.registration_id)
    if registration is not None:
        registration.payment_status = "refunded"

    record_audit(
        db,
        actor_user_id=actor_user_id,
        action="refund_confirmed_received",
        resource_type="refund",
        resource_id=refund.id,
        metadata={"refundId": str(refund.id)},
    )
    db.commit()
    return refund


# ---------------------------------------------------------------------------
# Organizer actions
# ---------------------------------------------------------------------------

def review_refund(
    db: Session,
    *,
    refund_id: UUID,
    reviewer_user_id: UUID,
    decision: str,
    approved_amount_paise: int | None,
    organizer_comments: str | None,
) -> Refund:
    """Organizer approves or rejects a REQUESTED refund."""
    if decision not in ("approve", "reject"):
        raise ValueError("Decision must be 'approve' or 'reject'")

    refund = _locked_refund(db, refund_id)
    if refund is None:
        raise ValueError("Refund not found")
    if refund.status != REFUND_STATUS_REQUESTED:
        raise ValueError("Refund is not in REQUESTED status")

    now = utc_now()
    refund.reviewed_by = reviewer_user_id
    refund.reviewed_at = now
    refund.updated_at = now
    refund.organizer_comments = organizer_comments

    if decision == "approve":
        # Validate and clamp approved amount
        max_refundable = refund.original_total_paid
        if approved_amount_paise is None:
            approved_amount_paise = refund.requested_refund_amount
        if approved_amount_paise > max_refundable:
            raise ValueError(f"Approved refund amount cannot exceed original amount paid (₹{max_refundable / 100:.2f})")
        if approved_amount_paise <= 0:
            raise ValueError("Approved refund amount must be greater than zero")
        if refund.payment_provider == "CASHFREE" and approved_amount_paise < refund.platform_fee_refund_amount:
            raise ValueError("Approved amount cannot be less than the platform fee refund")

        refund.approved_refund_amount = approved_amount_paise
        refund.status = REFUND_STATUS_APPROVED
        refund.approved_at = now

        record_audit(
            db,
            actor_user_id=reviewer_user_id,
            action="refund_approved",
            resource_type="refund",
            resource_id=refund.id,
            metadata={"approvedAmountPaise": approved_amount_paise},
        )
    else:
        if not organizer_comments:
            raise ValueError("A rejection reason is required")
        refund.status = REFUND_STATUS_REJECTED
        record_audit(
            db,
            actor_user_id=reviewer_user_id,
            action="refund_rejected",
            resource_type="refund",
            resource_id=refund.id,
            metadata={},
        )

    db.commit()
    return refund


def mark_refund_sent(
    db: Session,
    *,
    refund_id: UUID,
    reviewer_user_id: UUID,
    refund_utr: str,
    actual_amount_paise: int | None,
    organizer_comments: str | None,
    refund_proof_url: str | None,
) -> Refund:
    """Organizer marks Direct UPI refund as sent with mandatory UTR.

    SportPass NEVER transfers money on behalf of the organizer.
    The organizer must manually send via UPI and enter the UTR here.
    """
    refund = _locked_refund(db, refund_id)
    if refund is None:
        raise ValueError("Refund not found")
    if refund.status != REFUND_STATUS_APPROVED:
        raise ValueError("Refund must be APPROVED before it can be marked as sent")
    if refund.payment_provider != PAYMENT_PROVIDER_DIRECT_UPI:
        raise ValueError("This flow is only for Direct UPI refunds")

    utr = (refund_utr or "").strip()
    if not utr:
        raise ValueError("UTR/transaction reference is required to mark refund as sent")

    now = utc_now()
    refund.refund_utr = utr
    refund.refund_proof_url = refund_proof_url
    refund.status = REFUND_STATUS_REFUND_SENT
    refund.refunded_at = now
    refund.updated_at = now
    if organizer_comments:
        refund.organizer_comments = organizer_comments
    if actual_amount_paise is not None:
        # Allow organizer to record the actual sent amount (must not exceed original)
        if actual_amount_paise <= 0 or actual_amount_paise > refund.original_total_paid:
            raise ValueError("Actual refund amount cannot exceed the original amount paid")
        refund.approved_refund_amount = actual_amount_paise

    record_audit(
        db,
        actor_user_id=reviewer_user_id,
        action="refund_marked_sent",
        resource_type="refund",
        resource_id=refund.id,
        metadata={"hasUtr": True, "amountPaise": refund.approved_refund_amount},
    )
    db.commit()
    return refund


# ---------------------------------------------------------------------------
# Provider dispatch
# ---------------------------------------------------------------------------

def process_refund(db: Session, refund: Refund, *, reviewer_user_id: UUID) -> dict:
    """Dispatch to the correct provider refund processor.

    Direct UPI remains manual. Cashfree uses the same verified processor as
    the admin API; callers must authorize the actor before invoking this.
    """
    if refund.payment_provider == PAYMENT_PROVIDER_DIRECT_UPI:
        return _process_manual_upi_refund(refund)
    if refund.payment_provider == PAYMENT_PROVIDER_CASHFREE:
        from app.services.cashfree_refunds import reconcile_cashfree_refund
        return {"status": reconcile_cashfree_refund(
            db, refund_id=refund.id, initiate=True, actor_user_id=reviewer_user_id,
        )}
    return {"status": "NOT_IMPLEMENTED", "message": f"Unknown provider: {refund.payment_provider}"}


def _process_manual_upi_refund(refund: Refund) -> dict:
    """Direct UPI refunds are processed manually by the organizer.

    SportPass cannot call any API here — the money went directly to the
    organizer's UPI account and must be returned the same way.
    The flow: organizer sends money → enters UTR → mark_refund_sent().
    """
    return {
        "status": "MANUAL_REQUIRED",
        "message": "Direct UPI refund must be processed manually by the organizer.",
    }


def _refund_page_after(db: Session, cursor: str):
    """Return a stable (created_at, id) keyset boundary for the supplied row."""
    try:
        cursor_id = UUID(cursor)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid refund cursor") from exc
    boundary = db.execute(select(Refund.created_at, Refund.id).where(Refund.id == cursor_id)).one_or_none()
    if boundary is None:
        raise ValueError("Refund cursor not found")
    created_at, refund_id = boundary
    return or_(Refund.created_at < created_at,
               and_(Refund.created_at == created_at, Refund.id < refund_id))


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------

def get_refund_with_context(db: Session, refund_id: UUID) -> Refund | None:
    return db.scalar(
        select(Refund)
        .options(
            joinedload(Refund.registration).joinedload(Registration.ticket),
            joinedload(Refund.event),
            joinedload(Refund.participant),
            joinedload(Refund.organization),
            joinedload(Refund.reviewer),
        )
        .where(Refund.id == refund_id)
    )


def list_refunds_for_organizer(
    db: Session,
    *,
    organizer_id: UUID,
    event_id: UUID | None = None,
    status: str | None = None,
    payment_provider: str | None = None,
    limit: int = 50,
    cursor: str | None = None,
) -> list[Refund]:
    query = (
        select(Refund)
        .options(
            joinedload(Refund.registration).joinedload(Registration.ticket),
            joinedload(Refund.event),
            joinedload(Refund.participant),
        )
        .where(Refund.organizer_id == organizer_id)
        .order_by(Refund.created_at.desc(), Refund.id.desc())
    )
    if event_id:
        query = query.where(Refund.event_id == event_id)
    if status:
        query = query.where(Refund.status == status)
    if payment_provider:
        query = query.where(Refund.payment_provider == payment_provider)
    if cursor:
        query = query.where(_refund_page_after(db, cursor))
    return list(db.scalars(query.limit(limit + 1)))


def list_refunds_for_admin(
    db: Session,
    *,
    event_id: UUID | None = None,
    organizer_id: UUID | None = None,
    status: str | None = None,
    payment_provider: str | None = None,
    limit: int = 50,
    cursor: str | None = None,
) -> list[Refund]:
    query = (
        select(Refund)
        .options(
            joinedload(Refund.registration).joinedload(Registration.ticket),
            joinedload(Refund.event),
            joinedload(Refund.participant),
            joinedload(Refund.organization),
        )
        .order_by(Refund.created_at.desc(), Refund.id.desc())
    )
    if event_id:
        query = query.where(Refund.event_id == event_id)
    if organizer_id:
        query = query.where(Refund.organizer_id == organizer_id)
    if status:
        query = query.where(Refund.status == status)
    if payment_provider:
        query = query.where(Refund.payment_provider == payment_provider)
    if cursor:
        query = query.where(_refund_page_after(db, cursor))
    return list(db.scalars(query.limit(limit + 1)))


def create_manual_refund(
    db: Session,
    *,
    organizer_id: UUID,
    event_id: UUID,
    registration_id: UUID | None,
    participant_name: str,
    participant_contact: str | None,
    amount_paise: int,
    refund_reason: str,
    notes: str | None,
    refund_utr: str | None,
    actor_user_id: UUID,
) -> Refund:
    """Organizer creates a manual refund not tied to any SportPass registration.

    These records are flagged is_manual_refund=True and are excluded from
    event earnings and billing calculations. They exist purely as an audit
    trail for cash/outside-platform refunds the organizer issues manually.
    If registration_id is supplied the refund is linked to that registration
    for tracking but still excluded from automated billing calculations.
    """
    # Verify the event belongs to this organizer
    event = db.scalar(
        select(Event).where(Event.id == event_id, Event.organization_id == organizer_id).with_for_update()
    )
    if event is None:
        raise ValueError("Event not found or does not belong to your organisation")

    # If registration_id is given, it must belong to this exact event and
    # organization before any participant data is associated with the refund.
    # The event ownership check above is not sufficient on its own because a
    # caller could otherwise attach another organizer's registration ID.
    participant_id = None
    if registration_id:
        reg = db.scalar(
            select(Registration)
            .join(Event, Event.id == Registration.event_id)
            .where(
                Registration.id == registration_id,
                Registration.event_id == event_id,
                Event.organization_id == organizer_id,
            )
            .with_for_update(of=Registration).execution_options(populate_existing=True)
        )
        if reg is None:
            raise ValueError("Registration not found for this event or organisation")
        if reg.payment and reg.payment.payment_gateway == "cashfree":
            raise ValueError("Cashfree registrations must use the managed refund flow")
        if db.scalar(select(Refund.id).where(Refund.registration_id == reg.id,
                Refund.status.in_(REFUND_ACTIVE_STATUSES | {REFUND_STATUS_REFUNDED}))) is not None:
            raise ValueError("A refund already exists for this registration")
        participant_id = reg.participant_id

    now = utc_now()
    status = REFUND_STATUS_REFUND_SENT if refund_utr else REFUND_STATUS_APPROVED

    refund = Refund(
        registration_id=registration_id,
        event_id=event_id,
        participant_id=participant_id,
        organizer_id=organizer_id,
        is_manual_refund=True,
        manual_participant_name=participant_name.strip(),
        manual_participant_contact=(participant_contact or "").strip() or None,
        payment_method="manual",
        payment_provider=PAYMENT_PROVIDER_DIRECT_UPI,
        original_registration_amount=amount_paise,
        original_platform_fee=0,
        original_total_paid=amount_paise,
        requested_refund_amount=amount_paise,
        approved_refund_amount=amount_paise,
        platform_fee_refund_amount=0,
        refund_reason=refund_reason[:120],
        organizer_comments=notes,
        status=status,
        requested_at=now,
        reviewed_at=now,
        approved_at=now,
        refunded_at=now if refund_utr else None,
        refund_utr=refund_utr,
    )
    db.add(refund)
    db.flush()

    record_audit(
        db,
        actor_user_id=actor_user_id,
        action="manual_refund_created",
        resource_type="refund",
        resource_id=refund.id,
        metadata={
            "participantName": participant_name,
            "amountPaise": amount_paise,
            "hasUtr": bool(refund_utr),
            "linkedRegistrationId": str(registration_id) if registration_id else None,
        },
    )
    db.commit()
    return db.get(Refund, refund.id)


def get_refund_for_registration(db: Session, registration_id: UUID) -> Refund | None:
    """Return the most recent refund for a registration (any status)."""
    return db.scalar(
        select(Refund)
        .where(Refund.registration_id == registration_id)
        .order_by(Refund.created_at.desc())
    )


def serialize_refund(refund: Refund) -> dict:
    """Common serialisation for refund objects returned by the API."""
    return {
        "id": str(refund.id),
        "registrationId": str(refund.registration_id) if refund.registration_id else None,
        "eventId": str(refund.event_id),
        "participantId": str(refund.participant_id) if refund.participant_id else None,
        "organizerId": str(refund.organizer_id),
        "isManualRefund": refund.is_manual_refund,
        "manualParticipantName": refund.manual_participant_name,
        "manualParticipantContact": refund.manual_participant_contact,
        "paymentMethod": refund.payment_method,
        "paymentProvider": refund.payment_provider,
        "originalRegistrationAmount": refund.original_registration_amount,
        "originalPlatformFee": refund.original_platform_fee,
        "originalTotalPaid": refund.original_total_paid,
        "requestedRefundAmount": refund.requested_refund_amount,
        "approvedRefundAmount": refund.approved_refund_amount,
        "platformFeeRefundAmount": refund.platform_fee_refund_amount,
        "refundReason": refund.refund_reason,
        "participantComments": refund.participant_comments,
        "organizerComments": refund.organizer_comments,
        "status": refund.status,
        "refundUtr": refund.refund_utr,
        "refundProofUrl": refund.refund_proof_url,
        "providerRefundId": refund.provider_refund_id,
        "providerRefundStatus": refund.provider_refund_status,
        "initiatedBy": str(refund.initiated_by) if refund.initiated_by else None,
        "initiatedAt": refund.initiated_at,
        "requestedAt": refund.requested_at,
        "reviewedAt": refund.reviewed_at,
        "approvedAt": refund.approved_at,
        "refundedAt": refund.refunded_at,
        "confirmedAt": refund.confirmed_at,
        # Embedded context (populated when loaded with joinedload)
        "event": {"id": str(refund.event.id), "name": refund.event.name} if refund.event else None,
        "participant": {
            "id": str(refund.participant.id),
            "name": refund.participant.name,
            "email": refund.participant.email,
            "phone": refund.participant.phone,
        } if refund.participant else None,
        "registration": {
            "id": str(refund.registration.id),
            "registrationReference": refund.registration.registration_reference,
            "ticket": {
                "name": refund.registration.ticket.name,
            } if refund.registration and refund.registration.ticket else None,
        } if refund.registration else None,
        "organization": {
            "id": str(refund.organization.id),
            "name": refund.organization.name,
        } if refund.organization else None,
        "createdAt": refund.created_at,
        "updatedAt": refund.updated_at,
    }
