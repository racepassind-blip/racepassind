from __future__ import annotations

from app.sports import get_adapter

import datetime as dt
from collections.abc import Callable

from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.services.auth_service import hash_opaque_token, utc_now
from app.config import get_settings
from db import get_db
from models import AuthSession, Organization, OrganizationMember, User
from app.services.clerk_auth import ClerkAuthenticationError, ClerkIdentityConflict, resolve_local_user, verify_clerk_request

SESSION_COOKIE = "racepass_session"
CSRF_COOKIE = "racepass_csrf"


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> User:
    if get_settings().clerk_auth_required:
        try:
            identity = verify_clerk_request(request)
            return resolve_local_user(db, identity)
        except (ClerkAuthenticationError, ClerkIdentityConflict) as exc:
            db.rollback()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
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
    request: Request,
    db: Session = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> User | None:
    if get_settings().clerk_auth_required:
        try:
            return resolve_local_user(db, verify_clerk_request(request))
        except (ClerkAuthenticationError, ClerkIdentityConflict):
            db.rollback()
            return None
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
    # Emit distinct messages so the frontend can detect a CSRF failure via the
    # keyword "csrf" (case-insensitive) in the detail string and trigger an
    # automatic token-refresh + retry, rather than surfacing the error to the
    # user as a permanent failure.
    if not csrf_cookie:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="csrf_missing: no CSRF cookie present. Please refresh the page and try again.",
        )
    if not csrf_header:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="csrf_missing: CSRF token header not sent. Please refresh the page and try again.",
        )
    if csrf_cookie != csrf_header:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="csrf_mismatch: CSRF token does not match. Please refresh the page and try again.",
        )


def require_roles(*roles: str) -> Callable:
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        if user.role == "admin" and get_settings().admin_mfa_enabled and not user.mfa_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin_mfa_required")
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
    """Resolve tournament access through the sport policy and category format."""
    from models import EventCategory

    if get_adapter(event.category).tournament_capable():
        return
    loaded_cats = event.categories if hasattr(event, "categories") else []
    if get_adapter(event.category).tournament_capable(any(cat.entry_type == "team" for cat in loaded_cats)):
        return
    has_team = db.scalar(
        select(EventCategory.id).where(
            EventCategory.event_id == event.id,
            EventCategory.entry_type == "team",
        )
    )
    if get_adapter(event.category).tournament_capable(bool(has_team)):
        return
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Tournament features are not available for this sport and category format",
    )
