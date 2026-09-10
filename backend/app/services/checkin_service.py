from __future__ import annotations

import datetime as dt
import hmac
import re
from urllib.parse import parse_qs, urlparse
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.services.auth_service import hash_opaque_token, utc_now
from app.services.audit_service import record_audit
from models import Checkin, Event, Organization, OrganizationMember, Registration, Ticket

_TICKET_VERSION = "1"
_RAW_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{20,200}$")
_MAX_DEVICE_INFO_LENGTH = 240


class CheckinCredentialError(ValueError):
    pass


class CheckinNotAllowedError(ValueError):
    pass


def parse_ticket_credential(value: str) -> str:
    credential = value.strip()
    if not credential or len(credential) > 300:
        raise CheckinCredentialError("Invalid check-in credential")

    if credential.startswith("racepass://"):
        parsed = urlparse(credential)
        if parsed.scheme != "racepass" or parsed.netloc != "ticket" or parsed.path not in {"", "/"}:
            raise CheckinCredentialError("Invalid check-in credential")
        parameters = parse_qs(parsed.query, keep_blank_values=True)
        if set(parameters) != {"v", "t"} or any(len(values) != 1 for values in parameters.values()):
            raise CheckinCredentialError("Invalid check-in credential")
        if parameters["v"][0] != _TICKET_VERSION:
            raise CheckinCredentialError("Unsupported ticket version")
        token = parameters["t"][0]
    else:
        token = credential

    if not _RAW_TOKEN_PATTERN.fullmatch(token):
        raise CheckinCredentialError("Invalid check-in credential")
    return token


def normalize_registration_reference(value: str) -> str:
    reference = value.strip().upper()
    if not reference or len(reference) > 80 or not re.fullmatch(r"[A-Z0-9-]+", reference):
        raise CheckinCredentialError("Invalid registration reference")
    return reference


def checkin_attempt_material(*, credential: str | None, registration_reference: str | None) -> str:
    if credential:
        return credential[:300]
    return (registration_reference or "")[:80]


def _active_organization_ids_for_user(user):
    return select(OrganizationMember.organization_id).join(
        Organization, Organization.id == OrganizationMember.organization_id
    ).where(
        OrganizationMember.user_id == user.id,
        OrganizationMember.member_role == "organizer",
        Organization.status == "active",
    )


def _scoped_registration_query(user):
    query = (
        select(Registration)
        .join(Event, Event.id == Registration.event_id)
        .join(Organization, Organization.id == Event.organization_id)
        .where(Organization.status == "active")
        .options(
            selectinload(Registration.participant),
            selectinload(Registration.ticket).selectinload(Ticket.category),
        )
    )
    if user.role != "admin":
        query = query.where(Event.organization_id.in_(_active_organization_ids_for_user(user)))
    return query


def _load_registration_by_token(db: Session, user, token: str) -> Registration | None:
    token_hash = hash_opaque_token(token)
    registration = db.scalar(
        _scoped_registration_query(user)
        .where(Registration.ticket_token_hash == token_hash)
        .with_for_update()
    )
    if registration is None or not registration.ticket_token_hash:
        return None
    if not hmac.compare_digest(registration.ticket_token_hash, token_hash):
        return None
    return registration


def _load_registration_by_reference(db: Session, user, reference: str) -> Registration | None:
    return db.scalar(
        _scoped_registration_query(user)
        .where(Registration.registration_reference == reference)
        .with_for_update()
    )


def _safe_device_info(device_info: str | None) -> str | None:
    if not device_info:
        return None
    sanitized = "".join(character if ord(character) >= 32 and ord(character) != 127 else " " for character in device_info)
    return sanitized.strip()[:_MAX_DEVICE_INFO_LENGTH] or None


def _checkin_response(registration: Registration, event: Event, *, already_checked_in: bool) -> dict:
    return {
        "registrationReference": registration.registration_reference,
        "event": {"id": str(event.id), "name": event.name, "location": event.location},
        "participantName": registration.participant.name,
        "ticketName": registration.ticket.name,
        "status": "checked_in",
        "alreadyCheckedIn": already_checked_in,
        "checkedInAt": registration.checked_in_at,
        "message": "Already checked in" if already_checked_in else "Participant checked in",
    }


def check_in_registration(
    db: Session,
    user,
    *,
    credential: str | None = None,
    registration_reference: str | None = None,
    device_info: str | None = None,
) -> dict:
    if bool(credential) == bool(registration_reference):
        raise CheckinCredentialError("Provide exactly one ticket credential or registration reference")

    source = "qr" if credential else "reference"
    if credential:
        token = parse_ticket_credential(credential)
        registration = _load_registration_by_token(db, user, token)
    else:
        reference = normalize_registration_reference(registration_reference or "")
        registration = _load_registration_by_reference(db, user, reference)

    if registration is None:
        raise CheckinCredentialError("Check-in credential invalid or not authorized")

    event = db.get(Event, registration.event_id)
    if event is None:
        raise CheckinCredentialError("Check-in credential invalid or not authorized")

    existing_checkin = db.scalar(
        select(Checkin)
        .where(Checkin.registration_id == registration.id)
        .order_by(Checkin.checked_in_at.asc())
    )
    if existing_checkin is not None or registration.checked_in or registration.status == "checked_in":
        checked_in_at = existing_checkin.checked_in_at if existing_checkin is not None else registration.checked_in_at or utc_now()
        if existing_checkin is None:
            existing_checkin = Checkin(
                registration_id=registration.id,
                checked_in_by=user.id,
                checked_in_at=checked_in_at,
                device_info=_safe_device_info(device_info),
            )
            db.add(existing_checkin)
        registration.checked_in = True
        registration.status = "checked_in"
        registration.checked_in_at = checked_in_at
        record_audit(
            db,
            actor_user_id=user.id,
            action="participant_check_in_duplicate",
            resource_type="registration",
            resource_id=registration.id,
            metadata={"source": source, "alreadyCheckedIn": True},
        )
        db.commit()
        return _checkin_response(registration, event, already_checked_in=True)

    if registration.status != "confirmed":
        record_audit(
            db,
            actor_user_id=user.id,
            action="participant_check_in_failed",
            resource_type="registration",
            resource_id=registration.id,
            metadata={"source": source, "reason": "registration_not_confirmed"},
        )
        db.commit()
        raise CheckinNotAllowedError("Registration is not confirmed for check-in")

    checked_in_at = utc_now()
    registration.status = "checked_in"
    registration.checked_in = True
    registration.checked_in_at = checked_in_at
    db.add(
        Checkin(
            registration_id=registration.id,
            checked_in_by=user.id,
            checked_in_at=checked_in_at,
            device_info=_safe_device_info(device_info),
        )
    )
    record_audit(
        db,
        actor_user_id=user.id,
        action="participant_checked_in",
        resource_type="registration",
        resource_id=registration.id,
        metadata={"source": source},
    )
    db.commit()
    return _checkin_response(registration, event, already_checked_in=False)
