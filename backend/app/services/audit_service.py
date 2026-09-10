from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from models import AuditLog

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
        )
    )
