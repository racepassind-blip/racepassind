from __future__ import annotations

import datetime as dt
from collections.abc import Callable

from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.services.auth_service import hash_opaque_token, utc_now
from db import get_db
from models import AuthSession, Organization, OrganizationMember, User

SESSION_COOKIE = "racepass_session"
CSRF_COOKIE = "racepass_csrf"


def get_current_user(
    db: Session = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> User:
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    session = db.scalar(
        select(AuthSession)
        .options(joinedload(AuthSession.user))
        .where(
            AuthSession.token_hash == hash_opaque_token(session_token),
            AuthSession.revoked_at.is_(None),
        )
    )
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    now = utc_now()
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=dt.timezone.utc)
    if expires_at <= now:
        session.revoked_at = now
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")

    user = session.user
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    return user


def get_optional_current_user(
    db: Session = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> User | None:
    if not session_token:
        return None

    session = db.scalar(
        select(AuthSession)
        .options(joinedload(AuthSession.user))
        .where(
            AuthSession.token_hash == hash_opaque_token(session_token),
            AuthSession.revoked_at.is_(None),
        )
    )
    if session is None:
        return None

    now = utc_now()
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=dt.timezone.utc)
    if expires_at <= now:
        session.revoked_at = now
        db.commit()
        return None

    user = session.user
    return user if user is not None and user.is_active else None


def require_csrf(
    request: Request,
    csrf_cookie: str | None = Cookie(default=None, alias=CSRF_COOKIE),
    csrf_header: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> None:
    if not csrf_cookie or not csrf_header or csrf_cookie != csrf_header:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your session has expired. Please refresh the page and try again.",
        )


def require_roles(*roles: str) -> Callable:
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user

    return dependency


def get_authorized_organization(db: Session, user: User, organization_id):
    organization = db.get(Organization, organization_id)
    if organization is None or organization.status != "active":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    if user.role == "admin":
        return organization

    membership = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == organization.id,
            OrganizationMember.user_id == user.id,
            OrganizationMember.member_role == "organizer",
        )
    )
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return organization


def get_authorized_event(db: Session, user: User, event_id):
    from models import Event

    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    get_authorized_organization(db, user, event.organization_id)
    return event


def require_tournament_capable(event, db: Session) -> None:
    """Raise 404 unless the event is badminton or has at least one team-format category."""
    from models import EventCategory

    if event.category.casefold() == "badminton":
        return
    loaded_cats = event.categories if hasattr(event, "categories") else []
    if any(cat.entry_type == "team" for cat in loaded_cats):
        return
    has_team = db.scalar(
        select(EventCategory.id).where(
            EventCategory.event_id == event.id,
            EventCategory.entry_type == "team",
        )
    )
    if has_team:
        return
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Tournament features are only available for badminton events or events with team categories",
    )
