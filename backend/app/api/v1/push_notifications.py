from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_csrf, require_roles
from app.services.push_service import disable_subscription, push_configuration, upsert_subscription
from db import get_db
from models import Event, PushSubscription, Registration, User

router = APIRouter()


class PushKeysIn(BaseModel):
    p256dh: str = Field(min_length=16, max_length=255)
    auth: str = Field(min_length=8, max_length=255)


class PushSubscriptionIn(BaseModel):
    event_id: UUID
    endpoint: str = Field(min_length=32, max_length=2048)
    keys: PushKeysIn
    user_agent: str | None = Field(default=None, max_length=512)


@router.get("/push/public-key")
def push_public_key() -> dict[str, object]:
    return push_configuration()


@router.get("/push/subscriptions/status")
def push_subscription_status(
    event_id: UUID = Query(...),
    user: User = Depends(require_roles("participant", "user", "organizer", "admin")),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    event = db.get(Event, event_id)
    if event is None or event.archived_at is not None:
        raise HTTPException(status_code=404, detail="Event not found")
    eligible = user.role in {"admin", "organizer"} or db.scalar(
        select(Registration.id).where(
            Registration.event_id == event_id,
            Registration.user_id == user.id,
            Registration.status.in_(("confirmed", "checked_in")),
        )
    ) is not None
    enabled = db.scalar(
        select(PushSubscription.id).where(
            PushSubscription.user_id == user.id,
            PushSubscription.event_id == event_id,
            PushSubscription.enabled.is_(True),
        )
    ) is not None
    return {"eligible": eligible, "enabled": enabled}


@router.post("/push/subscriptions", status_code=status.HTTP_201_CREATED)
def register_push_subscription(
    payload: PushSubscriptionIn,
    user: User = Depends(require_roles("participant", "user", "organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict[str, str | bool]:
    if not push_configuration()["enabled"]:
        raise HTTPException(status_code=503, detail="Push notifications are not configured")
    event = db.get(Event, payload.event_id)
    if event is None or event.archived_at is not None:
        raise HTTPException(status_code=404, detail="Event not found")
    registered = db.scalar(
        select(Registration.id).where(
            Registration.event_id == payload.event_id,
            Registration.user_id == user.id,
            Registration.status.in_(("confirmed", "checked_in")),
        )
    )
    if registered is None and user.role not in {"admin", "organizer"}:
        raise HTTPException(status_code=403, detail="A confirmed event registration is required")
    subscription = upsert_subscription(
        db,
        user_id=user.id,
        event_id=payload.event_id,
        endpoint=payload.endpoint,
        p256dh=payload.keys.p256dh,
        auth=payload.keys.auth,
        user_agent=payload.user_agent,
    )
    return {"id": str(subscription.id), "enabled": True}


@router.delete("/push/subscriptions/{subscription_id}", status_code=status.HTTP_204_NO_CONTENT)
def unregister_push_subscription(
    subscription_id: UUID,
    user: User = Depends(require_roles("participant", "user", "organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> None:
    disable_subscription(db, user_id=user.id, subscription_id=subscription_id)
