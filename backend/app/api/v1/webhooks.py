from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.services.auth_service import hash_password, normalize_email
from db import get_db
from models import ClerkWebhookEvent, User
from svix import Webhook, WebhookVerificationError

router = APIRouter()


def _identity_from_event(data: dict) -> tuple[str, str | None, str]:
    clerk_id = str(data.get("id") or "")
    emails = data.get("email_addresses") or []
    primary_id = data.get("primary_email_address_id")
    primary = next((item for item in emails if item.get("id") == primary_id and item.get("verification", {}).get("status") == "verified"), None)
    email = normalize_email(primary["email_address"]) if primary else None
    name = " ".join(part for part in (data.get("first_name"), data.get("last_name")) if part) or (email.split("@", 1)[0] if email else "SportPass user")
    return clerk_id, email, name[:120]


def _sync_user(db: Session, event_type: str, data: dict, occurred_at: dt.datetime | None = None) -> None:
    clerk_id, email, name = _identity_from_event(data)
    if not clerk_id:
        return
    user = db.scalar(select(User).where(User.clerk_user_id == clerk_id).with_for_update())
    if event_type == "user.deleted":
        if user is not None:
            user.is_active = False
            user.clerk_deleted_at = occurred_at or dt.datetime.now(dt.timezone.utc)
        return
    if user is not None and user.clerk_deleted_at and occurred_at and occurred_at <= user.clerk_deleted_at:
        return
    if user is None and email:
        matches = db.scalars(select(User).where(User.normalized_email == email).with_for_update()).all()
        if len(matches) == 1:
            user = matches[0]
    if user is None:
        # Webhooks are identity synchronization only; password remains unusable
        # for Clerk-created accounts and local business roles stay participant.
        user = User(name=name, email=email or f"{clerk_id}@clerk.invalid", normalized_email=email, password_hash=hash_password(clerk_id + "-legacy-disabled"), role="participant", is_active=True, clerk_user_id=clerk_id)
        db.add(user)
    else:
        if user.clerk_user_id and user.clerk_user_id != clerk_id:
            return
        user.clerk_user_id = clerk_id
        user.clerk_deleted_at = None
        user.is_active = True
        if email:
            user.email = email
            user.normalized_email = email
        user.name = name


@router.post("/clerk", status_code=status.HTTP_200_OK)
async def clerk_webhook(request: Request, db: Session = Depends(get_db)) -> dict[str, str]:
    secret = get_settings().clerk_webhook_signing_secret
    if not secret:
        raise HTTPException(status_code=503, detail="Clerk webhook is not configured")
    body = await request.body()
    try:
        Webhook(secret).verify(body, dict(request.headers))
    except Exception as exc:
        # Do not reveal signature details to callers.
        raise HTTPException(status_code=400, detail="Invalid webhook signature") from exc
    import json
    payload = json.loads(body)
    event_id = str(payload.get("id") or request.headers.get("svix-id") or "")
    event_type = str(payload.get("type") or "")
    if not event_id or event_type not in {"user.created", "user.updated", "user.deleted"}:
        raise HTTPException(status_code=400, detail="Unsupported webhook event")
    if db.scalar(select(ClerkWebhookEvent).where(ClerkWebhookEvent.event_id == event_id)):
        return {"status": "ok"}
    try:
        db.add(ClerkWebhookEvent(event_id=event_id, event_type=event_type))
        db.flush()
        raw_timestamp = payload.get("timestamp")
        occurred_at = dt.datetime.fromtimestamp(raw_timestamp / 1000, tz=dt.timezone.utc) if isinstance(raw_timestamp, (int, float)) else None
        _sync_user(db, event_type, payload.get("data") or {}, occurred_at)
        db.commit()
    except IntegrityError:
        db.rollback()
    return {"status": "ok"}
