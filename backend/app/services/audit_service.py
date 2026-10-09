from __future__ import annotations

from uuid import UUID
from datetime import datetime, timezone

from sqlalchemy.orm import Session
from sqlalchemy import select

from models import AllocationHistory, AuditLog, User

_SENSITIVE_METADATA_PARTS = (
    "password",
    "secret",
    "token",
    "claim_code",
    "confirmation",
    "cookie",
    "authorization",
    "utr",
    "participant",
    "user_agent",
)
_MAX_STRING_LENGTH = 240


def _safe_metadata_value(key: str, value, depth: int = 0):
    normalized_key = key.lower().replace("-", "_")
    if any(part in normalized_key for part in _SENSITIVE_METADATA_PARTS):
        return value if isinstance(value, bool) else "[redacted]"
    if depth >= 3:
        return "[redacted]"
    if isinstance(value, dict):
        return {str(child_key): _safe_metadata_value(str(child_key), child_value, depth + 1) for child_key, child_value in value.items()}
    if isinstance(value, list):
        return [_safe_metadata_value(key, child_value, depth + 1) for child_value in value[:20]]
    if isinstance(value, str):
        sanitized = "".join(character if ord(character) >= 32 and ord(character) != 127 else " " for character in value)
        return sanitized[:_MAX_STRING_LENGTH]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)[:_MAX_STRING_LENGTH]


def safe_audit_metadata(metadata: dict | None) -> dict | None:
    if metadata is None:
        return None
    return {str(key): _safe_metadata_value(str(key), value) for key, value in metadata.items()}


def record_audit(
    db: Session,
    *,
    actor_user_id: UUID | None,
    action: str,
    resource_type: str,
    resource_id: UUID | str | None,
    metadata: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action=action,
            resource_type=resource_type,
            resource_id=str(resource_id) if resource_id is not None else None,
            metadata_json=safe_audit_metadata(metadata),
            # PostgreSQL now() is fixed at transaction start. Use each action's
            # timestamp so transitions in one transaction display in order.
            created_at=datetime.now(timezone.utc),
        )
    )


def audit_history(db: Session, *, resource_type: str, resource_id) -> list[dict]:
    """For authorized admin detail views; do not expose through public routes."""
    rows = db.execute(select(AuditLog, User.name).outerjoin(User, User.id == AuditLog.actor_user_id)
        .where(AuditLog.resource_type == resource_type, AuditLog.resource_id == str(resource_id))
        .order_by(AuditLog.created_at, AuditLog.id)).all()
    return [{"id": str(row.id), "action": row.action, "createdAt": row.created_at,
             "actor": name or ("System" if row.actor_user_id is None else "Former user"),
             "actorId": str(row.actor_user_id) if row.actor_user_id else None,
             "details": row.metadata_json or {}} for row, name in rows]


def record_allocation_change(
    db: Session,
    *,
    event_id: UUID,
    registration_id: UUID,
    old_number: int | None,
    new_number: int | None,
    changed_by_user_id: UUID,
) -> None:
    """Record an allocation number change in the history table."""
    db.add(
        AllocationHistory(
            event_id=event_id,
            registration_id=registration_id,
            old_number=old_number,
            new_number=new_number,
            changed_by=changed_by_user_id,
        )
    )
