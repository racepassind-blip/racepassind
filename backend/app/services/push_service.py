from __future__ import annotations

import json
import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.services.auth_service import utc_now
from models import Event, EventAnnouncement, PushSubscription

logger = logging.getLogger(__name__)


def push_configuration() -> dict[str, object]:
    settings = get_settings()
    return {"enabled": settings.push_ready, "publicKey": settings.vapid_public_key if settings.push_ready else None}


def upsert_subscription(
    db: Session,
    *,
    user_id: UUID,
    event_id: UUID,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: str | None,
) -> PushSubscription:
    subscription = db.scalar(
        select(PushSubscription).where(
            PushSubscription.user_id == user_id,
            PushSubscription.event_id == event_id,
            PushSubscription.endpoint == endpoint,
        )
    )
    if subscription is None:
        subscription = PushSubscription(
            user_id=user_id,
            event_id=event_id,
            endpoint=endpoint,
            p256dh=p256dh,
            auth=auth,
            user_agent=user_agent,
        )
        db.add(subscription)
    else:
        subscription.p256dh = p256dh
        subscription.auth = auth
        subscription.user_agent = user_agent
        subscription.enabled = True
    db.flush()
    return subscription


def disable_subscription(db: Session, *, user_id: UUID, subscription_id: UUID) -> None:
    subscription = db.scalar(
        select(PushSubscription).where(
            PushSubscription.id == subscription_id,
            PushSubscription.user_id == user_id,
        )
    )
    if subscription:
        subscription.enabled = False


def _send(subscription: PushSubscription, announcement: EventAnnouncement, event_title: str) -> bool:
    settings = get_settings()
    if not settings.push_ready:
        return False
    try:
        from pywebpush import WebPushException, webpush  # type: ignore[import-not-found]
    except ImportError:
        logger.warning("push_dependency_missing")
        return False

    payload = json.dumps(
        {
            "title": f"{event_title}: {announcement.title}",
            "body": announcement.body[:240],
            "url": f"/event/{announcement.event_id}/announcements/{announcement.id}",
            "tag": f"event-announcement-{announcement.id}",
            "eventId": str(announcement.event_id),
            "announcementId": str(announcement.id),
        }
    )
    try:
        webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
            },
            data=payload,
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
        )
        return True
    except WebPushException as exc:
        response = getattr(exc, "response", None)
        if response is not None and getattr(response, "status_code", None) in {404, 410}:
            subscription.enabled = False
        logger.warning("push_delivery_failed status=%s", getattr(response, "status_code", "unknown"))
    except Exception as exc:  # delivery must never break announcement publication
        logger.warning("push_delivery_failed error=%s", type(exc).__name__)
    return False


def deliver_pending_announcement_pushes(db: Session, *, limit: int = 25) -> int:
    settings = get_settings()
    if not settings.push_ready:
        return 0
    announcements = db.scalars(
        select(EventAnnouncement)
        .where(EventAnnouncement.status == "PUBLISHED", EventAnnouncement.push_sent_at.is_(None))
        .order_by(EventAnnouncement.published_at, EventAnnouncement.id)
        .limit(limit)
    ).all()
    sent = 0
    for announcement in announcements:
        event = db.get(Event, announcement.event_id)
        if event is None:
            announcement.push_sent_at = utc_now()
            continue
        subscriptions = db.scalars(
            select(PushSubscription).where(
                PushSubscription.event_id == announcement.event_id,
                PushSubscription.enabled.is_(True),
            )
        ).all()
        for subscription in subscriptions:
            if _send(subscription, announcement, event.name):
                sent += 1
        # Mark even when there are no subscribers so a later opt-in does not
        # unexpectedly receive an old announcement.
        announcement.push_sent_at = utc_now()
    return sent
