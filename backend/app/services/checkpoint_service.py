from __future__ import annotations

import datetime as dt
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.services.audit_service import record_audit
from app.services.auth_service import utc_now
from app.services.organizer_visibility_service import get_event_visibility
from models import Checkin, Event, EventCheckpoint, Organization, OrganizationMember, Participant, Registration, RegistrationParticipant, Ticket, User


_DEFAULT_CHECKPOINT_NAME = "Check-In"


def _authorized_event(db: Session, user: User, event_id: UUID) -> Event | None:
    query = (
        select(Event)
        .join(Organization, Organization.id == Event.organization_id)
        .where(Event.id == event_id, Organization.status == "active")
    )
    if user.role != "admin":
        query = query.where(
            Event.organization_id.in_(
                select(OrganizationMember.organization_id).where(
                    OrganizationMember.user_id == user.id,
                    OrganizationMember.member_role == "organizer",
                )
            )
        )
    return db.scalar(query)


def _serialize_checkpoint(checkpoint: EventCheckpoint) -> dict:
    return {
        "id": str(checkpoint.id),
        "eventId": str(checkpoint.event_id),
        "name": checkpoint.name,
        "position": checkpoint.position,
        "createdAt": checkpoint.created_at,
        "updatedAt": checkpoint.updated_at,
    }


def ensure_default_checkpoint(db: Session, event_id: UUID) -> EventCheckpoint:
    checkpoint = db.scalar(
        select(EventCheckpoint).where(EventCheckpoint.event_id == event_id).order_by(EventCheckpoint.position, EventCheckpoint.created_at).limit(1)
    )
    if checkpoint is not None:
        return checkpoint
    checkpoint = EventCheckpoint(event_id=event_id, name=_DEFAULT_CHECKPOINT_NAME, position=1)
    db.add(checkpoint)
    db.flush()
    return checkpoint


def list_event_checkpoints(db: Session, user: User, event_id: UUID) -> dict:
    event = _authorized_event(db, user, event_id)
    if event is None:
        raise ValueError("Event not found")
    checkpoints = db.scalars(
        select(EventCheckpoint).where(EventCheckpoint.event_id == event_id).order_by(EventCheckpoint.position, EventCheckpoint.created_at)
    ).all()
    if not checkpoints:
        checkpoints = [ensure_default_checkpoint(db, event_id)]
    addons = event.addon_config.get("addons", []) if isinstance(event.addon_config, dict) else []
    checkpoint_names = {checkpoint.name.casefold() for checkpoint in checkpoints}
    suggestions = [
        {"addonId": addon.get("id"), "name": addon.get("name")}
        for addon in addons
        if isinstance(addon, dict) and addon.get("id") and addon.get("name")
        and addon["name"].casefold() not in checkpoint_names
    ]
    return {
        "eventId": str(event.id),
        "eventName": event.name,
        "checkpoints": [_serialize_checkpoint(checkpoint) for checkpoint in checkpoints],
        "suggestedAddons": suggestions,
    }


def create_event_checkpoint(
    db: Session, user: User, event_id: UUID, *, name: str, position: int | None = None, addon_id: str | None = None
) -> dict:
    event = _authorized_event(db, user, event_id)
    if event is None:
        raise ValueError("Event not found")
    normalized_name = name.strip()
    if not normalized_name:
        raise ValueError("Checkpoint name is required")
    if db.scalar(select(EventCheckpoint.id).where(EventCheckpoint.event_id == event_id, func.lower(EventCheckpoint.name) == normalized_name.casefold())):
        raise ValueError("A checkpoint with this name already exists")
    checkpoints = db.scalars(select(EventCheckpoint).where(EventCheckpoint.event_id == event_id).order_by(EventCheckpoint.position)).all()
    if not checkpoints:
        checkpoints = [ensure_default_checkpoint(db, event_id)]
    insertion_position = max(1, min(position or len(checkpoints) + 1, len(checkpoints) + 1))
    # Temporarily move existing positions away from the unique constraint, then insert.
    for index, checkpoint in enumerate(checkpoints, start=1):
        checkpoint.position = -(index)
    db.flush()
    for index, checkpoint in enumerate(checkpoints, start=1):
        checkpoint.position = index if index < insertion_position else index + 1
    checkpoint = EventCheckpoint(event_id=event_id, name=normalized_name, position=insertion_position)
    db.add(checkpoint)
    db.flush()
    record_audit(
        db,
        actor_user_id=user.id,
        action="event_checkpoint_created",
        resource_type="event",
        resource_id=event_id,
        metadata={"checkpointId": str(checkpoint.id), "name": normalized_name, "addonId": addon_id},
    )
    return _serialize_checkpoint(checkpoint)


def update_event_checkpoint(db: Session, user: User, event_id: UUID, checkpoint_id: UUID, *, name: str, position: int) -> dict:
    event = _authorized_event(db, user, event_id)
    if event is None:
        raise ValueError("Event not found")
    checkpoint = db.scalar(select(EventCheckpoint).where(EventCheckpoint.id == checkpoint_id, EventCheckpoint.event_id == event_id).with_for_update())
    if checkpoint is None:
        raise ValueError("Checkpoint not found")
    normalized_name = name.strip()
    if not normalized_name:
        raise ValueError("Checkpoint name is required")
    duplicate = db.scalar(
        select(EventCheckpoint.id).where(
            EventCheckpoint.event_id == event_id,
            func.lower(EventCheckpoint.name) == normalized_name.casefold(),
            EventCheckpoint.id != checkpoint_id,
        )
    )
    if duplicate:
        raise ValueError("A checkpoint with this name already exists")
    checkpoints = db.scalars(select(EventCheckpoint).where(EventCheckpoint.event_id == event_id).order_by(EventCheckpoint.position, EventCheckpoint.created_at)).all()
    checkpoints = [item for item in checkpoints if item.id != checkpoint_id]
    insertion_position = max(1, min(position, len(checkpoints) + 1))
    for index, item in enumerate(checkpoints, start=1):
        item.position = -index
    checkpoint.position = -(len(checkpoints) + 1)
    db.flush()
    for index, item in enumerate(checkpoints, start=1):
        item.position = index if index < insertion_position else index + 1
    checkpoint.name = normalized_name
    checkpoint.position = insertion_position
    db.flush()
    record_audit(
        db,
        actor_user_id=user.id,
        action="event_checkpoint_updated",
        resource_type="event",
        resource_id=event_id,
        metadata={"checkpointId": str(checkpoint.id), "name": normalized_name, "position": insertion_position},
    )
    return _serialize_checkpoint(checkpoint)


def delete_event_checkpoint(db: Session, user: User, event_id: UUID, checkpoint_id: UUID) -> None:
    event = _authorized_event(db, user, event_id)
    if event is None:
        raise ValueError("Event not found")
    checkpoint = db.scalar(select(EventCheckpoint).where(EventCheckpoint.id == checkpoint_id, EventCheckpoint.event_id == event_id).with_for_update())
    if checkpoint is None:
        raise ValueError("Checkpoint not found")
    if db.scalar(select(Checkin.id).where(Checkin.checkpoint_id == checkpoint_id).limit(1)) is not None:
        raise ValueError("Checkpoint has scans and cannot be deleted")
    remaining = db.scalars(
        select(EventCheckpoint).where(EventCheckpoint.event_id == event_id, EventCheckpoint.id != checkpoint_id).order_by(EventCheckpoint.position)
    ).all()
    if not remaining:
        raise ValueError("At least one checkpoint is required")
    for index, item in enumerate(remaining, start=1):
        item.position = -index
    db.flush()
    for index, item in enumerate(remaining, start=1):
        item.position = index
    db.delete(checkpoint)
    db.flush()
    record_audit(
        db,
        actor_user_id=user.id,
        action="event_checkpoint_deleted",
        resource_type="event",
        resource_id=event_id,
        metadata={"checkpointId": str(checkpoint_id)},
    )


def _participant_names(registration: Registration) -> list[str]:
    return [member.participant.name for member in registration.participant_memberships] or [registration.participant.name]


def _scan_payload(scan: Checkin) -> dict:
    return {
        "checkpointId": str(scan.checkpoint_id) if scan.checkpoint_id else None,
        "checkpointName": scan.checkpoint.name if scan.checkpoint else _DEFAULT_CHECKPOINT_NAME,
        "position": scan.checkpoint.position if scan.checkpoint else 1,
        "scannedAt": scan.checked_in_at,
        "scannedBy": str(scan.checked_in_by) if scan.checked_in_by else None,
        "deviceInfo": scan.device_info,
    }


def _registration_matrix_item(registration: Registration, checkpoints: list[EventCheckpoint]) -> dict:
    scans_by_checkpoint = {scan.checkpoint_id: scan for scan in registration.checkins if scan.checkpoint_id is not None}
    legacy_scan = next((scan for scan in registration.checkins if scan.checkpoint_id is None), None)
    if legacy_scan is not None and checkpoints and checkpoints[0].position == 1 and checkpoints[0].id not in scans_by_checkpoint:
        scans_by_checkpoint[checkpoints[0].id] = legacy_scan
    scans = [_scan_payload(scan) for scan in sorted(registration.checkins, key=lambda scan: scan.checked_in_at)]
    return {
        "registrationId": str(registration.id),
        "registrationReference": registration.registration_reference,
        "participantName": registration.participant.name,
        "participantNames": _participant_names(registration),
        "participantCount": registration.participant_count,
        "ticketName": registration.ticket.name,
        "scans": {
            str(checkpoint.id): _scan_payload(scans_by_checkpoint[checkpoint.id]) if checkpoint.id in scans_by_checkpoint else None
            for checkpoint in checkpoints
        },
        "timeline": scans,
    }


def get_event_checkin_matrix(db: Session, user: User, event_id: UUID) -> dict:
    event = _authorized_event(db, user, event_id)
    if event is None:
        raise ValueError("Event not found")
    checkpoint_response = list_event_checkpoints(db, user, event_id)
    checkpoints = db.scalars(
        select(EventCheckpoint).where(EventCheckpoint.event_id == event_id).order_by(EventCheckpoint.position, EventCheckpoint.created_at)
    ).all()
    visibility = get_event_visibility(db, user, event_id)
    visible_ids = visibility.get("visibleConfirmedRegistrationIds", [])
    query = (
        select(Registration)
        .options(
            joinedload(Registration.participant),
            joinedload(Registration.ticket),
            selectinload(Registration.participant_memberships).joinedload(RegistrationParticipant.participant),
            selectinload(Registration.checkins).joinedload(Checkin.checkpoint),
        )
        .where(Registration.event_id == event_id, Registration.status.in_(("confirmed", "checked_in")))
        .order_by(Registration.created_at.asc(), Registration.id.asc())
    )
    if visible_ids:
        query = query.where(Registration.id.in_(visible_ids))
    else:
        query = query.where(False)
    registrations = db.scalars(query).unique().all()
    items = [_registration_matrix_item(registration, checkpoints) for registration in registrations]
    total_participants = sum(max(1, registration.participant_count) * max(1, registration.quantity) for registration in registrations)
    counts = []
    for checkpoint in checkpoints:
        served = sum(
            max(1, registration.participant_count) * max(1, registration.quantity)
            for registration in registrations
            if any(scan.checkpoint_id == checkpoint.id for scan in registration.checkins)
            or (checkpoint.position == 1 and any(scan.checkpoint_id is None for scan in registration.checkins))
        )
        counts.append({"checkpointId": str(checkpoint.id), "scanned": served, "total": total_participants})
    return {
        "eventId": str(event.id),
        "eventName": event.name,
        "checkpoints": checkpoint_response["checkpoints"],
        "suggestedAddons": checkpoint_response["suggestedAddons"],
        "counts": counts,
        "items": items,
        "total": len(items),
        "totalParticipants": total_participants,
    }


def get_registration_checkin_timeline(db: Session, user: User, registration_id: UUID) -> dict:
    registration = db.scalar(
        select(Registration)
        .options(
            joinedload(Registration.participant),
            joinedload(Registration.ticket),
            selectinload(Registration.participant_memberships).joinedload(RegistrationParticipant.participant),
            selectinload(Registration.checkins).joinedload(Checkin.checkpoint),
        )
        .where(Registration.id == registration_id)
    )
    if registration is None or _authorized_event(db, user, registration.event_id) is None:
        raise ValueError("Registration not found")
    visibility = get_event_visibility(db, user, registration.event_id)
    if registration.id not in visibility.get("visibleConfirmedRegistrationIds", set()) or registration.status not in {"confirmed", "checked_in"}:
        raise ValueError("Registration not found")
    return _registration_matrix_item(
        registration,
        db.scalars(select(EventCheckpoint).where(EventCheckpoint.event_id == registration.event_id).order_by(EventCheckpoint.position)).all(),
    )
