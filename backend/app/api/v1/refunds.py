"""Refund management API routes for SportPass.

Endpoints:
  Participant (auth required):
    POST  /registrations/{registration_id}/refund-request
    POST  /refunds/{refund_id}/confirm-received
    GET   /registrations/{registration_id}/refund         — current refund state

  Organizer:
    GET   /organizer/refunds
    GET   /organizer/refunds/{refund_id}
    POST  /organizer/refunds/{refund_id}/review
    POST  /organizer/refunds/{refund_id}/mark-sent

  Admin:
    GET   /admin/refunds
    GET   /admin/refunds/{refund_id}
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_authorized_event, get_current_user, require_csrf, require_roles
from app.schemas.refunds import RefundDecisionIn, RefundMarkSentIn, RefundRequestIn
from app.services.email_service import (
    send_refund_approved_notification,
    send_refund_rejected_notification,
    send_refund_requested_notification,
    send_refund_sent_notification,
)
from app.services.refund_service import (
    check_refund_eligibility,
    confirm_refund_received,
    get_refund_for_registration,
    get_refund_with_context,
    list_refunds_for_admin,
    list_refunds_for_organizer,
    mark_refund_sent,
    request_refund,
    review_refund,
    serialize_refund,
)
from db import get_db
from models import (
    Event,
    Organization,
    OrganizationMember,
    Refund,
    Registration,
    User,
    REFUND_STATUS_REFUND_SENT,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Participant endpoints
# ---------------------------------------------------------------------------

@router.post("/registrations/{registration_id}/refund-request", status_code=201)
def create_refund_request(
    registration_id: UUID,
    payload: RefundRequestIn,
    _csrf=Depends(require_csrf),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Submit a refund request for a confirmed registration."""
    # Verify ownership — user must own the registration
    registration = db.scalar(
        select(Registration).where(
            Registration.id == registration_id,
            Registration.user_id == user.id,
        )
    )
    if registration is None:
        raise HTTPException(status_code=404, detail="Registration not found")

    try:
        refund = request_refund(
            db,
            registration_id=registration_id,
            actor_user_id=user.id,
            refund_reason=payload.refund_reason,
            participant_comments=payload.participant_comments,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # Notify organizer (best-effort — never fail the request)
    try:
        loaded = get_refund_with_context(db, refund.id)
        if loaded:
            send_refund_requested_notification(db, loaded)
    except Exception:
        pass

    loaded = get_refund_with_context(db, refund.id)
    return serialize_refund(loaded)


@router.get("/registrations/{registration_id}/refund")
def get_registration_refund(
    registration_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the current refund status for a registration, or eligibility info."""
    registration = db.scalar(
        select(Registration).where(
            Registration.id == registration_id,
            Registration.user_id == user.id,
        )
    )
    if registration is None:
        raise HTTPException(status_code=404, detail="Registration not found")

    refund = get_refund_for_registration(db, registration_id)
    if refund:
        loaded = get_refund_with_context(db, refund.id)
        return {"refund": serialize_refund(loaded), "eligibility": None}

    eligibility = check_refund_eligibility(db, registration_id, for_participant=True)
    return {
        "refund": None,
        "eligibility": {
            "eligible": eligibility["eligible"],
            "reason": eligibility["reason"],
        },
    }


@router.post("/refunds/{refund_id}/confirm-received")
def confirm_received(
    refund_id: UUID,
    _csrf=Depends(require_csrf),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Participant confirms they received the refund."""
    # Verify the refund belongs to this user's registration
    refund = db.scalar(
        select(Refund)
        .join(Registration, Registration.id == Refund.registration_id)
        .where(Refund.id == refund_id, Registration.user_id == user.id)
    )
    if refund is None:
        raise HTTPException(status_code=404, detail="Refund not found")
    if refund.status != REFUND_STATUS_REFUND_SENT:
        raise HTTPException(status_code=422, detail="Refund cannot be confirmed in its current state")

    try:
        updated = confirm_refund_received(db, refund_id=refund_id, actor_user_id=user.id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    loaded = get_refund_with_context(db, updated.id)
    return serialize_refund(loaded)


# ---------------------------------------------------------------------------
# Organizer endpoints
# ---------------------------------------------------------------------------

def _assert_organizer_owns_refund(db: Session, user: User, refund: Refund) -> None:
    """Raise 404 unless this user (organizer or admin) owns the event."""
    if user.role == "admin":
        return
    membership = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == refund.organizer_id,
            OrganizationMember.user_id == user.id,
            OrganizationMember.member_role == "organizer",
        )
    )
    if membership is None:
        raise HTTPException(status_code=404, detail="Refund not found")


@router.get("/organizer/refunds")
def organizer_list_refunds(
    event_id: UUID | None = None,
    refund_status: str | None = None,
    payment_provider: str | None = None,
    limit: int = 50,
    cursor: str | None = None,
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
):
    """List refunds for the organizer's events."""
    if user.role == "admin":
        # Admin calling this endpoint sees all (use /admin/refunds for filtering by org)
        refunds = list_refunds_for_admin(
            db,
            event_id=event_id,
            status=refund_status,
            payment_provider=payment_provider,
            limit=limit,
            cursor=cursor,
        )
        has_more = len(refunds) > limit
        return {
            "refunds": [serialize_refund(r) for r in refunds[:limit]],
            "hasMore": has_more,
            "nextCursor": str(refunds[limit - 1].id) if has_more and refunds else None,
        }

    # Find organizer_id for this user
    membership = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.member_role == "organizer",
        )
    )
    if membership is None:
        return {"refunds": [], "hasMore": False, "nextCursor": None}

    refunds = list_refunds_for_organizer(
        db,
        organizer_id=membership.organization_id,
        event_id=event_id,
        status=refund_status,
        payment_provider=payment_provider,
        limit=limit,
        cursor=cursor,
    )
    has_more = len(refunds) > limit
    return {
        "refunds": [serialize_refund(r) for r in refunds[:limit]],
        "hasMore": has_more,
        "nextCursor": str(refunds[limit - 1].id) if has_more and refunds else None,
    }


@router.get("/organizer/refunds/{refund_id}")
def organizer_get_refund(
    refund_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
):
    """Get a single refund detail for organizer review."""
    refund = db.scalar(select(Refund).where(Refund.id == refund_id))
    if refund is None:
        raise HTTPException(status_code=404, detail="Refund not found")
    _assert_organizer_owns_refund(db, user, refund)
    loaded = get_refund_with_context(db, refund_id)
    return serialize_refund(loaded)


@router.post("/organizer/refunds/{refund_id}/review")
def organizer_review_refund(
    refund_id: UUID,
    payload: RefundDecisionIn,
    _csrf=Depends(require_csrf),
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
):
    """Approve or reject a REQUESTED refund."""
    refund = db.scalar(select(Refund).where(Refund.id == refund_id))
    if refund is None:
        raise HTTPException(status_code=404, detail="Refund not found")
    _assert_organizer_owns_refund(db, user, refund)

    try:
        updated = review_refund(
            db,
            refund_id=refund_id,
            reviewer_user_id=user.id,
            decision=payload.decision,
            approved_amount_paise=payload.approved_amount_paise,
            organizer_comments=payload.organizer_comments,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # Send notification (best-effort)
    try:
        loaded = get_refund_with_context(db, updated.id)
        if loaded:
            if payload.decision == "approve":
                send_refund_approved_notification(db, loaded)
            else:
                send_refund_rejected_notification(db, loaded)
    except Exception:
        pass

    loaded = get_refund_with_context(db, updated.id)
    return serialize_refund(loaded)


@router.post("/organizer/refunds/{refund_id}/mark-sent")
def organizer_mark_refund_sent(
    refund_id: UUID,
    payload: RefundMarkSentIn,
    _csrf=Depends(require_csrf),
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
):
    """Mark a Direct UPI refund as sent with the UTR/transaction reference."""
    refund = db.scalar(select(Refund).where(Refund.id == refund_id))
    if refund is None:
        raise HTTPException(status_code=404, detail="Refund not found")
    _assert_organizer_owns_refund(db, user, refund)

    try:
        updated = mark_refund_sent(
            db,
            refund_id=refund_id,
            reviewer_user_id=user.id,
            refund_utr=payload.refund_utr,
            actual_amount_paise=payload.actual_amount_paise,
            organizer_comments=payload.organizer_comments,
            refund_proof_url=payload.refund_proof_url,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # Notify participant (best-effort)
    try:
        loaded = get_refund_with_context(db, updated.id)
        if loaded:
            send_refund_sent_notification(db, loaded)
    except Exception:
        pass

    loaded = get_refund_with_context(db, updated.id)
    return serialize_refund(loaded)


# ---------------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------------

@router.get("/admin/refunds")
def admin_list_refunds(
    event_id: UUID | None = None,
    organizer_id: UUID | None = None,
    refund_status: str | None = None,
    payment_provider: str | None = None,
    limit: int = 50,
    cursor: str | None = None,
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    """Admin view: all refunds across SportPass with full filtering."""
    refunds = list_refunds_for_admin(
        db,
        event_id=event_id,
        organizer_id=organizer_id,
        status=refund_status,
        payment_provider=payment_provider,
        limit=limit,
        cursor=cursor,
    )
    has_more = len(refunds) > limit
    return {
        "refunds": [serialize_refund(r) for r in refunds[:limit]],
        "hasMore": has_more,
        "nextCursor": str(refunds[limit - 1].id) if has_more and refunds else None,
    }


@router.get("/admin/refunds/{refund_id}")
def admin_get_refund(
    refund_id: UUID,
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    """Admin: full refund detail."""
    loaded = get_refund_with_context(db, refund_id)
    if loaded is None:
        raise HTTPException(status_code=404, detail="Refund not found")
    return serialize_refund(loaded)
