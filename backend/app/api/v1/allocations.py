"""API endpoints for allocation number management.

This module provides endpoints for the generalized allocation number feature
that works across all sports (running, cycling, badminton, etc.).
"""

from __future__ import annotations

from app.sports import get_adapter

import datetime as dt
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_authorized_event, get_authorized_organization, get_current_user, require_csrf, require_roles
from db import get_db
from models import AllocationHistory, Event, EventCategory, Registration, User
from app.schemas.allocations import (
    AllocationBatchRequest,
    AllocationBatchResult,
    AllocationHistoryEntry,
    AllocationSummary,
    EditNumberRequest,
    PublishRequest,
    PublishResult,
    RegistrationWithAllocation,
    SportAllocationConfig,
)

router = APIRouter(prefix="/events/{event_id}/allocations", tags=["allocation"])


def _get_event_or_404(db: Session, event_id: UUID, user: User) -> Event:
    """Get event or raise 404 if not found or user doesn't have access."""
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found",
        )
    get_authorized_organization(db, user, event.organization_id)
    return event


def _can_edit_after_publish(allocation_status: str) -> bool:
    """Check if allocation can be edited after publish."""
    return allocation_status in ("draft", "published")


@router.get("", response_model=list[RegistrationWithAllocation])
def list_allocations(
    event_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[RegistrationWithAllocation]:
    """List all registrations for an event with allocation info."""
    event = _get_event_or_404(db, event_id, user)

    stmt = (
        select(Registration)
        .where(Registration.event_id == event_id)
        .order_by(Registration.created_at)
    )
    registrations = db.scalars(stmt).all()

    result = []
    for reg in registrations:
        participant = reg.participant
        category = reg.category
        result.append(
            RegistrationWithAllocation(
                id=reg.id,
                registration_reference=reg.registration_reference or "",
                status=reg.status,
                participant_name=participant.name or "",
                participant_email=participant.email,
                participant_phone=participant.phone,
                category_name=category.name if category else None,
                ticket_name=reg.ticket.name,
                team_name=participant.team_name,
                gender=participant.gender,
                age=_calculate_age(participant.date_of_birth),
                allocation_number=reg.allocation_number,
                allocation_status=reg.allocation_status,
                allocation_assigned_at=reg.allocation_assigned_at,
                allocation_updated_at=reg.allocation_updated_at,
                created_at=reg.created_at,
            )
        )
    return result


def _calculate_age(dob: dt.date | None) -> int | None:
    """Calculate age from date of birth."""
    if not dob:
        return None
    today = dt.date.today()
    age = today.year - dob.year
    if today.month < dob.month or (
        today.month == dob.month and today.day < dob.day
    ):
        age -= 1
    return age


@router.get("/summary", response_model=list[AllocationSummary])
def get_allocation_summary(
    event_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AllocationSummary]:
    """Get allocation summary grouped by category."""
    event = _get_event_or_404(db, event_id, user)

    stmt = (
        select(
            EventCategory.id,
            EventCategory.name.label("category_name"),
            func.count(Registration.id).label("total_registrations"),
            func.sum(
                func.case(
                    (Registration.allocation_status == "unassigned", 1),
                    else_=0,
                )
            ).label("unassigned"),
            func.sum(
                func.case(
                    (Registration.allocation_status == "draft", 1),
                    else_=0,
                )
            ).label("draft"),
            func.sum(
                func.case(
                    (Registration.allocation_status == "published", 1),
                    else_=0,
                )
            ).label("published"),
        )
        .join(Registration, Registration.category_id == EventCategory.id)
        .where(EventCategory.event_id == event_id)
        .group_by(EventCategory.id, EventCategory.name)
    )
    rows = db.execute(stmt).all()
    return [
        AllocationSummary(
            category_id=row.id,
            category_name=row.category_name,
            total_registrations=row.total_registrations or 0,
            unassigned=row.unassigned or 0,
            draft=row.draft or 0,
            published=row.published or 0,
        )
        for row in rows
    ]


@router.post("/batch", response_model=AllocationBatchResult)
def batch_allocate_numbers(
    event_id: UUID,
    payload: AllocationBatchRequest,
    _csrf: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AllocationBatchResult:
    """Allocate numbers for an explicit list of registration -> number assignments.

    The frontend sends the exact (already-previewed and possibly reordered)
    assignments. This scopes the batch precisely to the filtered participants
    the organizer reviewed, rather than every unassigned registration.
    """
    event = _get_event_or_404(db, event_id, user)

    total_processed = 0
    assigned = 0
    skipped = 0
    errors: list[str] = []

    # Lock the rows participating in this batch where the database supports
    # row locks. The unique index below remains the final concurrency guard.
    incoming_ids = {a.registration_id for a in payload.assignments}
    locked_regs = {
        reg.id: reg
        for reg in db.scalars(
            select(Registration).where(Registration.id.in_(incoming_ids), Registration.event_id == event_id).with_for_update()
        ).all()
    }

    # Numbers already used by other draft/published registrations in this event
    # (excluding the ones we're about to reassign).
    used_numbers: set[int] = set()
    existing_stmt = select(Registration.id, Registration.allocation_number).where(
        Registration.event_id == event_id,
        Registration.allocation_number.isnot(None),
        Registration.allocation_status.in_(("draft", "published")),
    )
    for reg_id, number in db.execute(existing_stmt.with_for_update()).all():
        if number is not None and reg_id not in incoming_ids:
            used_numbers.add(number)

    # Detect duplicate numbers within the incoming payload itself.
    seen_in_payload: set[int] = set()
    seen_registrations: set[UUID] = set()
    valid_assignments: list[tuple[Registration, int]] = []
    old_numbers: dict[UUID, int | None] = {}

    now = dt.datetime.now(dt.UTC)
    for assignment in payload.assignments:
        total_processed += 1
        number = assignment.allocation_number

        if assignment.registration_id in seen_registrations:
            skipped += 1
            errors.append(f"Registration {assignment.registration_id} appears more than once in this batch")
            continue
        if number in seen_in_payload:
            skipped += 1
            errors.append(f"Duplicate number {number} in this batch")
            continue
        if number in used_numbers:
            skipped += 1
            errors.append(f"Number {number} is already taken by another participant")
            continue

        reg = locked_regs.get(assignment.registration_id)
        if reg is None:
            skipped += 1
            errors.append(f"Registration {assignment.registration_id} not found for this event")
            continue

        seen_registrations.add(assignment.registration_id)
        seen_in_payload.add(number)
        used_numbers.add(number)
        old_numbers[reg.id] = reg.allocation_number
        valid_assignments.append((reg, number))
        assigned += 1

    # Clear changed numbers first so a valid batch can swap two existing
    # assignments without transiently violating the unique index.
    for reg, number in valid_assignments:
        if reg.allocation_number != number:
            reg.allocation_number = None
    # Flush the clears as a separate statement set; otherwise the ORM may
    # collapse a swap into direct updates and the unique index can reject it.
    db.flush()

    for reg, number in valid_assignments:
        old_number = old_numbers[reg.id]
        reg.allocation_number = number
        # New assignments become draft; already-published entries stay published.
        if reg.allocation_status != "published":
            reg.allocation_status = "draft"
        if not reg.allocation_assigned_at:
            reg.allocation_assigned_at = now
        reg.allocation_updated_at = now

        db.add(
            AllocationHistory(
                event_id=event_id,
                registration_id=reg.id,
                old_number=old_number,
                new_number=number,
                changed_by=user.id,
            )
        )

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="One or more allocation numbers were taken concurrently") from exc
    return AllocationBatchResult(
        total_processed=total_processed,
        assigned=assigned,
        skipped=skipped,
        errors=errors,
    )


@router.patch("/{registration_id}", response_model=RegistrationWithAllocation)
def edit_allocation(
    event_id: UUID,
    registration_id: UUID,
    payload: EditNumberRequest,
    _csrf: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RegistrationWithAllocation:
    """Edit allocation number for a single registration.

    This can be done at any time, even after publish.
    Editing a published entry keeps it published.
    """
    event = _get_event_or_404(db, event_id, user)

    reg = db.get(Registration, registration_id)
    if not reg or reg.event_id != event_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Registration not found",
        )

    conflict = db.scalar(
        select(Registration.id).where(
            Registration.event_id == event_id,
            Registration.allocation_number == payload.new_number,
            Registration.id != registration_id,
        )
    )
    if conflict is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Allocation number is already taken for this event")

    old_number = reg.allocation_number
    now = dt.datetime.now(dt.UTC)
    reg.allocation_number = payload.new_number
    reg.allocation_updated_at = now

    # Create audit entry
    history = AllocationHistory(
        event_id=event_id,
        registration_id=registration_id,
        old_number=old_number,
        new_number=payload.new_number,
        changed_by=user.id,
    )
    db.add(history)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Allocation number was taken concurrently") from exc

    # Reload for fresh data
    db.refresh(reg)
    participant = reg.participant
    category = reg.category
    return RegistrationWithAllocation(
        id=reg.id,
        registration_reference=reg.registration_reference or "",
        status=reg.status,
        participant_name=participant.name or "",
        participant_email=participant.email,
        participant_phone=participant.phone,
        category_name=category.name if category else None,
        ticket_name=reg.ticket.name,
        team_name=participant.team_name,
        gender=participant.gender,
        age=_calculate_age(participant.date_of_birth),
        allocation_number=reg.allocation_number,
        allocation_status=reg.allocation_status,
        allocation_assigned_at=reg.allocation_assigned_at,
        allocation_updated_at=reg.allocation_updated_at,
        created_at=reg.created_at,
    )


@router.post("/publish", response_model=PublishResult)
def publish_allocations(
    event_id: UUID,
    payload: PublishRequest,
    _csrf: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PublishResult:
    """Publish all draft allocations for an event."""
    event = _get_event_or_404(db, event_id, user)

    # Find all draft allocations
    stmt = select(Registration).where(
        Registration.event_id == event_id,
        Registration.allocation_status == "draft",
    )
    registrations = db.scalars(stmt).all()

    previous_published = db.scalar(
        select(func.count(Registration.id)).where(
            Registration.event_id == event_id,
            Registration.allocation_status == "published",
        )
    ) or 0

    now = dt.datetime.now(dt.UTC)
    for reg in registrations:
        reg.allocation_status = "published"
        reg.allocation_updated_at = now
        if not reg.allocation_assigned_at:
            reg.allocation_assigned_at = now

    db.commit()

    # TODO: Send notifications if requested
    # notify_sent = False
    # if payload.notify_participants and registrations:
    #     notify_sent = _send_allocation_notifications(registrations)

    return PublishResult(
        total_published=len(registrations),
        previous_published_count=previous_published,
        notify_sent=False,  # Placeholder for notification logic
    )


@router.get("/history", response_model=list[AllocationHistoryEntry])
def get_allocation_history(
    event_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[AllocationHistoryEntry]:
    """Get allocation history for an event."""
    event = _get_event_or_404(db, event_id, user)

    stmt = (
        select(AllocationHistory)
        .where(AllocationHistory.event_id == event_id)
        .order_by(AllocationHistory.changed_at.desc())
    )
    history_entries = db.scalars(stmt).all()

    result = []
    for entry in history_entries:
        reg_ref = (
            db.scalar(
                select(Registration.registration_reference).where(
                    Registration.id == entry.registration_id
                )
            )
            or ""
        )
        user_name = None
        if entry.changed_by:
            user = db.get(User, entry.changed_by)
            user_name = user.name if user else None

        result.append(
            AllocationHistoryEntry(
                id=entry.id,
                registration_id=entry.registration_id,
                registration_reference=reg_ref,
                old_number=entry.old_number,
                new_number=entry.new_number,
                changed_by_user_id=entry.changed_by,
                changed_by_user_name=user_name,
                changed_at=entry.changed_at,
            )
        )
    return result


@router.get("/sport-config", response_model=SportAllocationConfig)
def get_sport_allocation_config(
    event_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SportAllocationConfig:
    """Get allocation config for the event's sport."""
    event = _get_event_or_404(db, event_id, user)

    # Determine if sport supports allocation
    sport = (event.category or "running").strip().lower()
    sport_config = _get_sport_allocation_config(sport)

    return sport_config


def _get_sport_allocation_config(sport: str) -> SportAllocationConfig:
    adapter = get_adapter(sport)
    return SportAllocationConfig(number_enabled=True, number_label=adapter.number_label, scope=adapter.number_scope)


@router.get("/config", response_model=SportAllocationConfig)
def get_allocation_config(
    event_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SportAllocationConfig:
    """Get allocation config for the event's sport (alias for /sport-config)."""
    return get_sport_allocation_config(event_id, db, user)
