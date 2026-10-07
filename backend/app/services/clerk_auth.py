"""Clerk identity adapter. Business code receives the existing local User."""
from __future__ import annotations

import secrets
from dataclasses import dataclass

from clerk_backend_api import AuthenticateRequestOptions, Clerk
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.services.auth_service import hash_password, normalize_email
from models import User


class ClerkAuthenticationError(Exception):
    pass


class ClerkIdentityConflict(ClerkAuthenticationError):
    pass


@dataclass(frozen=True)
class ClerkIdentity:
    clerk_user_id: str
    email: str | None
    name: str
    phone: str | None = None


def _client() -> Clerk:
    settings = get_settings()
    if not settings.clerk_secret_key:
        raise ClerkAuthenticationError("Clerk secret key is not configured")
    return Clerk(bearer_auth=settings.clerk_secret_key)


def verify_clerk_request(request) -> ClerkIdentity:
    settings = get_settings()
    if not settings.clerk_auth_required:
        raise ClerkAuthenticationError("Clerk authentication is disabled")
    if not settings.clerk_jwt_key and not settings.clerk_secret_key:
        raise ClerkAuthenticationError("Clerk token verification is not configured")
    try:
        state = _client().authenticate_request(
            request,
            AuthenticateRequestOptions(
                secret_key=settings.clerk_secret_key,
                jwt_key=settings.clerk_jwt_key,
                authorized_parties=list(settings.clerk_authorized_parties) or None,
            ),
        )
    except Exception as exc:
        raise ClerkAuthenticationError("Invalid Clerk authentication") from exc
    if not state.is_authenticated or not state.payload or not state.payload.get("sub"):
        raise ClerkAuthenticationError("Authentication required")

    clerk_id = str(state.payload["sub"])
    # Session claims do not reliably carry email/profile data; obtain the
    # verified profile from Clerk's backend API using the verified subject.
    try:
        profile = _client().users.get(user_id=clerk_id)
    except Exception as exc:
        raise ClerkAuthenticationError("Unable to load Clerk profile") from exc
    verified = [
        item for item in (getattr(profile, "email_addresses", None) or [])
        if getattr(item, "verification", None) is not None
        and getattr(item.verification, "status", None) == "verified"
    ]
    primary_id = getattr(profile, "primary_email_address_id", None)
    primary = next((item for item in verified if getattr(item, "id", None) == primary_id), None)
    if primary is None:
        raise ClerkAuthenticationError("A verified primary Clerk email is required")
    email = getattr(primary, "email_address", None)
    first = (getattr(profile, "first_name", None) or "").strip()
    last = (getattr(profile, "last_name", None) or "").strip()
    name = " ".join(part for part in (first, last) if part) or (email.split("@", 1)[0] if email else "SportPass user")
    return ClerkIdentity(clerk_id, normalize_email(email) if email else None, name[:120], getattr(profile, "phone_numbers", None) and None)


def resolve_local_user(db: Session, identity: ClerkIdentity) -> User:
    """Resolve/link/provision one local row; all business FKs remain untouched."""
    user = db.scalar(select(User).where(User.clerk_user_id == identity.clerk_user_id).with_for_update())
    if user is not None:
        if not user.is_active:
            raise ClerkAuthenticationError("SportPass account is deactivated")
        return user
    if not identity.email:
        raise ClerkIdentityConflict("Clerk identity has no verified email")

    matches = db.scalars(
        select(User).where(User.normalized_email == normalize_email(identity.email)).with_for_update()
    ).all()
    if len(matches) > 1:
        raise ClerkIdentityConflict("Multiple SportPass accounts match this verified email")
    if matches:
        user = matches[0]
        if user.clerk_user_id and user.clerk_user_id != identity.clerk_user_id:
            raise ClerkIdentityConflict("Verified email is already linked to another Clerk account")
        user.clerk_user_id = identity.clerk_user_id
        user.email = identity.email
        user.name = identity.name
        user.is_active = True
        db.flush()
        return user

    user = User(
        name=identity.name,
        email=identity.email,
        normalized_email=identity.email,
        password_hash=hash_password(secrets.token_urlsafe(32)),
        role="participant",
        is_active=True,
        clerk_user_id=identity.clerk_user_id,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        existing = db.scalar(select(User).where(User.clerk_user_id == identity.clerk_user_id))
        if existing is not None:
            return existing
        raise ClerkIdentityConflict("Concurrent Clerk account provisioning conflict") from exc
    return user
