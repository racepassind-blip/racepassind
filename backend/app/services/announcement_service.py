from __future__ import annotations

import datetime as dt
import logging
from threading import Event as StopEvent, Thread
from html import escape as escape_html
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.api.deps import get_authorized_event
from app.services.audit_service import record_audit
from app.services.auth_service import utc_now
from app.services.email_service import broadcast_event_update
from app.config import get_settings
from models import Event, EventAnnouncement, Organization, Registration, Ticket, User


MAX_TITLE_LENGTH = 180
MAX_BODY_LENGTH = 10_000
STATUSES = {"DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"}
logger = logging.getLogger(__name__)
LOCK_ID = 734019823


def normalize_text(value: str, *, field: str, max_length: int) -> str:
    normalized = value.replace("\r\n", "\n").strip()
    if not normalized:
        raise ValueError(f"{field} is required")
    if len(normalized) > max_length:
        raise ValueError(f"{field} must be {max_length} characters or fewer")
    return normalized


def _as_utc(value: dt.datetime | None) -> dt.datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc)


def serialize_announcement(item: EventAnnouncement, *, public: bool = False) -> dict:
    result = {
        "id": str(item.id),
        "title": item.title,
        "body": item.body,
        "status": item.status,
        "scheduledFor": item.scheduled_for.isoformat() if item.scheduled_for else None,
        "publishedAt": item.published_at.isoformat() if item.published_at else None,
        "updatedAt": item.updated_at.isoformat() if item.updated_at else None,
        "isPinned": bool(item.is_pinned),
    }
    if not public:
        result.update({
            "eventId": str(item.event_id),
            "createdAt": item.created_at.isoformat() if item.created_at else None,
            "createdBy": str(item.created_by),
            "updatedBy": str(item.updated_by),
        })
    return result


def list_public_announcements(db: Session, event_id: UUID, *, page: int = 1, page_size: int = 20) -> dict:
    event = db.scalar(select(Event).where(Event.id == event_id, Event.status == "published", Event.archived_at.is_(None)))
    if event is None:
        raise LookupError("Event not found")
    now = utc_now()
    filters = [EventAnnouncement.event_id == event_id, EventAnnouncement.status == "PUBLISHED", EventAnnouncement.published_at <= now]
    total = int(db.scalar(select(func.count()).select_from(EventAnnouncement).where(*filters)) or 0)
    rows = db.scalars(select(EventAnnouncement).where(*filters).order_by(EventAnnouncement.is_pinned.desc(), EventAnnouncement.published_at.desc(), EventAnnouncement.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    items = [serialize_announcement(row, public=True) for row in rows]
    return {
        "event": {"id": str(event.id), "title": event.title, "date": event.date, "category": event.category},
        "items": items,
        "announcements": items,
        "page": page,
        "pageSize": page_size,
        "total": total,
    }


def get_public_announcement(db: Session, event_id: UUID, announcement_id: UUID) -> dict:
    event = db.scalar(select(Event).where(Event.id == event_id, Event.status == "published", Event.archived_at.is_(None)))
    if event is None:
        raise LookupError("Event not found")
    item = db.scalar(select(EventAnnouncement).where(EventAnnouncement.id == announcement_id, EventAnnouncement.event_id == event_id, EventAnnouncement.status == "PUBLISHED", EventAnnouncement.published_at <= utc_now()))
    if item is None:
        raise LookupError("Announcement not found")
    return {"event": {"id": str(event.id), "title": event.title, "date": event.date, "category": event.category}, "announcement": serialize_announcement(item, public=True)}


def list_participant_announcements(db: Session, user: User, *, limit: int = 12) -> dict:
    """Recent public updates only for events confirmed under this account."""
    rows = db.execute(
        select(EventAnnouncement, Event, Organization)
        .join(Event, Event.id == EventAnnouncement.event_id)
        .join(Organization, Organization.id == Event.organization_id)
        .join(Registration, Registration.event_id == Event.id)
        .where(
            Registration.user_id == user.id,
            Registration.status.in_(("confirmed", "checked_in")),
            Event.status == "published",
            Event.archived_at.is_(None),
            EventAnnouncement.status == "PUBLISHED",
            EventAnnouncement.published_at <= utc_now(),
        )
        .order_by(EventAnnouncement.is_pinned.desc(), EventAnnouncement.published_at.desc(), EventAnnouncement.id.desc())
        .limit(limit * 3)
    ).all()
    seen: set[UUID] = set()
    items: list[dict] = []
    for announcement, event, organization in rows:
        if announcement.id in seen:
            continue
        seen.add(announcement.id)
        items.append({
            "event": {
                "id": str(event.id),
                "title": event.title,
                "date": event.date,
                "location": event.location,
                "organizer": organization.name,
            },
            "announcement": serialize_announcement(announcement, public=True),
        })
        if len(items) >= limit:
            break
    return {"items": items}


def list_organizer_announcements(db: Session, user: User, event_id: UUID) -> list[dict]:
    event = get_authorized_event(db, user, event_id)
    rows = db.scalars(
        select(EventAnnouncement)
        .where(EventAnnouncement.event_id == event.id)
        .order_by(EventAnnouncement.updated_at.desc(), EventAnnouncement.id.desc())
    ).all()
    return [serialize_announcement(row) for row in rows]


def get_organizer_announcement(db: Session, user: User, event_id: UUID, announcement_id: UUID) -> dict:
    event = get_authorized_event(db, user, event_id)
    item = db.scalar(select(EventAnnouncement).where(EventAnnouncement.id == announcement_id, EventAnnouncement.event_id == event.id))
    if item is None:
        raise LookupError("Announcement not found")
    return serialize_announcement(item)


def delete_draft(db: Session, user: User, event_id: UUID, announcement_id: UUID) -> None:
    event = get_authorized_event(db, user, event_id)
    item = db.scalar(select(EventAnnouncement).where(EventAnnouncement.id == announcement_id, EventAnnouncement.event_id == event.id).with_for_update())
    if item is None:
        raise LookupError("Announcement not found")
    if item.status != "DRAFT":
        raise ValueError("Only drafts can be deleted")
    record_audit(db, actor_user_id=user.id, action="ANNOUNCEMENT_DRAFT_DELETED", resource_type="EVENT_ANNOUNCEMENT", resource_id=item.id, metadata={"event_id": str(event.id)})
    db.delete(item)


def broadcast_announcement_email(db: Session, user: User, event_id: UUID, announcement_id: UUID) -> dict:
    event = get_authorized_event(db, user, event_id)
    has_paid_ticket = db.scalar(select(Ticket.id).where(Ticket.event_id == event.id, Ticket.price > 0).limit(1)) is not None
    if not has_paid_ticket and not event.features_unlocked:
        raise ValueError("Email communications are available for paid events only")
    item = db.scalar(select(EventAnnouncement).where(EventAnnouncement.id == announcement_id, EventAnnouncement.event_id == event.id))
    if item is None:
        raise LookupError("Announcement not found")
    if item.status != "PUBLISHED":
        raise ValueError("Only published announcements can be emailed")
    origin = get_settings().frontend_origins[0]
    public_url = f"{origin}/event/{event.id}/announcements/{item.id}"
    subject = f"{event.name}: {item.title}"
    body = f"{event.name}\n\n{item.title}\n\n{item.body}\n\nRead the full update: {public_url}\n\nSent via SportPass India."
    html_body = (
        '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111;">'
        f"<h2>{escape_html(item.title)}</h2>"
        f"<p>{escape_html(item.body).replace(chr(10), '<br>')}</p>"
        f'<p><a href="{escape_html(public_url, quote=True)}">Read the full update</a></p>'
        '<p style="color:#666;font-size:13px;margin-top:16px;">Sent via SportPass India.</p>'
        "</div>"
    )
    summary = broadcast_event_update(db, event_id=event.id, subject=subject, body=body, html_body=html_body,
                                     reference_type="EVENT_ANNOUNCEMENT", reference_id=str(item.id), dedupe=True)
    record_audit(db, actor_user_id=user.id, action="ANNOUNCEMENT_DISTRIBUTED", resource_type="EVENT_ANNOUNCEMENT", resource_id=item.id,
                 metadata={"event_id": str(event.id), "channel": "email", "recipient_count": summary.get("totalRecipients", 0)})
    return {"announcementId": str(item.id), **summary}


def create_announcement(db: Session, user: User, event_id: UUID, *, title: str, body: str, status: str = "DRAFT", scheduled_for: dt.datetime | None = None, is_pinned: bool = False) -> dict:
    event = get_authorized_event(db, user, event_id)
    title = normalize_text(title, field="Title", max_length=MAX_TITLE_LENGTH)
    body = normalize_text(body, field="Body", max_length=MAX_BODY_LENGTH)
    scheduled_for = _as_utc(scheduled_for)
    _validate_state(event, status, scheduled_for)
    if status == "ARCHIVED":
        raise ValueError("New announcements must start as a draft, scheduled update, or published update")
    now = utc_now()
    item = EventAnnouncement(event_id=event.id, title=title, body=body, status=status, scheduled_for=scheduled_for,
                             published_at=now if status == "PUBLISHED" else None, is_pinned=False,
                             created_by=user.id, updated_by=user.id)
    db.add(item)
    db.flush()
    if is_pinned:
        _set_pinned(db, item)
    record_audit(db, actor_user_id=user.id, action="ANNOUNCEMENT_CREATED", resource_type="EVENT_ANNOUNCEMENT", resource_id=item.id,
                 metadata={"event_id": str(event.id), "status": status})
    return serialize_announcement(item)


def update_announcement(db: Session, user: User, event_id: UUID, announcement_id: UUID, *, title: str | None = None, body: str | None = None,
                        status: str | None = None, scheduled_for: dt.datetime | None = None, is_pinned: bool | None = None) -> dict:
    event = get_authorized_event(db, user, event_id)
    item = db.scalar(select(EventAnnouncement).where(EventAnnouncement.id == announcement_id, EventAnnouncement.event_id == event.id).with_for_update())
    if item is None:
        raise LookupError("Announcement not found")
    previous_status = item.status
    next_status = status or previous_status
    next_scheduled = _as_utc(scheduled_for if status == "SCHEDULED" or scheduled_for is not None else item.scheduled_for)
    _validate_state(event, next_status, next_scheduled)
    _validate_transition(previous_status, next_status)
    if title is not None:
        item.title = normalize_text(title, field="Title", max_length=MAX_TITLE_LENGTH)
    if body is not None:
        item.body = normalize_text(body, field="Body", max_length=MAX_BODY_LENGTH)
    if status is not None:
        item.status = status
        item.scheduled_for = next_scheduled if status == "SCHEDULED" else None
        if status == "PUBLISHED" and previous_status != "PUBLISHED":
            item.published_at = utc_now()
        if status != "PUBLISHED":
            item.is_pinned = False
    elif scheduled_for is not None:
        item.scheduled_for = scheduled_for
    item.updated_by = user.id
    if is_pinned is True:
        _set_pinned(db, item)
    elif is_pinned is False:
        item.is_pinned = False
    action = "ANNOUNCEMENT_UPDATED"
    if previous_status != item.status:
        action = {
            "ARCHIVED": "ANNOUNCEMENT_ARCHIVED",
            "PUBLISHED": "ANNOUNCEMENT_PUBLISHED" if previous_status != "ARCHIVED" else "ANNOUNCEMENT_RESTORED",
            "DRAFT": "ANNOUNCEMENT_DRAFTED",
            "SCHEDULED": "ANNOUNCEMENT_SCHEDULED",
        }[item.status]
    record_audit(db, actor_user_id=user.id, action=action, resource_type="EVENT_ANNOUNCEMENT", resource_id=item.id,
                 metadata={"event_id": str(event.id), "previous_status": previous_status, "status": item.status})
    db.flush()
    return serialize_announcement(item)


def _validate_state(event: Event, status: str, scheduled_for: dt.datetime | None) -> None:
    if status not in STATUSES:
        raise ValueError("Unsupported announcement status")
    if event.archived_at is not None and status in {"PUBLISHED", "SCHEDULED"}:
        raise ValueError("Archived events cannot publish announcements")
    if status == "SCHEDULED" and (scheduled_for is None or scheduled_for <= utc_now()):
        raise ValueError("Scheduled publication must be in the future")


def _validate_transition(previous: str, next_status: str) -> None:
    allowed = {
        "DRAFT": {"DRAFT", "SCHEDULED", "PUBLISHED"},
        "SCHEDULED": {"DRAFT", "SCHEDULED", "PUBLISHED"},
        "PUBLISHED": {"PUBLISHED", "ARCHIVED"},
        "ARCHIVED": {"ARCHIVED", "PUBLISHED"},
    }
    if next_status not in allowed.get(previous, set()):
        raise ValueError(f"Cannot move an announcement from {previous.lower()} to {next_status.lower()}")


def _set_pinned(db: Session, item: EventAnnouncement) -> None:
    if item.status != "PUBLISHED":
        raise ValueError("Only published announcements can be pinned")
    existing = db.scalars(select(EventAnnouncement).where(EventAnnouncement.event_id == item.event_id, EventAnnouncement.is_pinned.is_(True), EventAnnouncement.id != item.id).with_for_update()).all()
    for row in existing:
        row.is_pinned = False
    # Flush the unpin before assigning the replacement. SQLite (and some
    # PostgreSQL plans) may otherwise batch both updates in an order that
    # briefly violates the partial unique index.
    if existing:
        db.flush()
    item.is_pinned = True


def publish_due_announcements(db: Session, *, now: dt.datetime | None = None, limit: int = 100) -> int:
    current = now or utc_now()
    rows = db.scalars(select(EventAnnouncement).where(EventAnnouncement.status == "SCHEDULED", EventAnnouncement.scheduled_for <= current).order_by(EventAnnouncement.scheduled_for).limit(limit).with_for_update()).all()
    published = 0
    for item in rows:
        event = db.get(Event, item.event_id)
        if event is None or event.archived_at is not None:
            item.status = "ARCHIVED"
            item.scheduled_for = None
            continue
        item.status = "PUBLISHED"
        item.published_at = current
        item.scheduled_for = None
        published += 1
    return published


def start_announcement_worker(session_factory, engine):
    """Publish scheduled announcements in the API process with replica election."""
    stop = StopEvent()

    def run():
        while not stop.is_set():
            try:
                with engine.connect() as lock:
                    acquired = engine.dialect.name != "postgresql" or lock.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": LOCK_ID})
                    if acquired:
                        with session_factory() as db:
                            count = publish_due_announcements(db)
                            db.commit()
                        # Delivery runs after the publication transaction so a
                        # push provider outage can never roll back an update.
                        with session_factory() as db:
                            from app.services.push_service import deliver_pending_announcement_pushes

                            deliver_pending_announcement_pushes(db)
                            db.commit()
            except Exception as exc:
                logger.warning("announcement_sweep_failed error=%s", type(exc).__name__)
            stop.wait(30)

    worker = Thread(target=run, name="announcement-publisher", daemon=True)
    worker.start()
    return stop, worker
