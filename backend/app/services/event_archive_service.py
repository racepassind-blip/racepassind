from uuid import UUID

from uuid import UUID

from sqlalchemy.orm import Session

from app.services.audit_service import record_audit
from models import Event


def restore_event_record(db: Session, event: Event, actor_user_id: UUID) -> None:
    event.archived_at = None
    record_audit(
        db,
        actor_user_id=actor_user_id,
        action="event_restored",
        resource_type="event",
        resource_id=event.id,
        metadata={"status": event.status},
    )
