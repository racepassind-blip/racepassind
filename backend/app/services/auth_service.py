from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from models import AuthSession, User

_PASSWORD_SCHEME = "scrypt"
_PASSWORD_N = 2**14
_PASSWORD_R = 8
_PASSWORD_P = 1
_SESSION_DAYS = 7


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def normalize_email(value: str) -> str:
    return value.strip().lower()


def normalize_phone(value: str | None) -> str | None:
    if value is None:
        return None
    digits = "".join(character for character in value if character.isdigit())
    return digits or None


def hash_password(password: str) -> str:
    if len(password) < 12:
        raise ValueError("Password must be at least 12 characters")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_PASSWORD_N,
        r=_PASSWORD_R,
        p=_PASSWORD_P,
    )
    encode = lambda value: base64.urlsafe_b64encode(value).decode("ascii")
    return f"{_PASSWORD_SCHEME}${_PASSWORD_N}${_PASSWORD_R}${_PASSWORD_P}${encode(salt)}${encode(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, n, r, p, encoded_salt, encoded_digest = encoded.split("$", 5)
        if scheme != _PASSWORD_SCHEME:
            return False
        salt = base64.urlsafe_b64decode(encoded_salt.encode("ascii"))
        expected = base64.urlsafe_b64decode(encoded_digest.encode("ascii"))
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=int(n),
            r=int(r),
            p=int(p),
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def hash_opaque_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_ip(ip_address: str | None) -> str | None:
    if not ip_address:
        return None
    secret = (get_settings().session_secret or "development-session-secret").encode("utf-8")
    return hmac.new(secret, ip_address.encode("utf-8"), hashlib.sha256).hexdigest()


def create_session(db: Session, user: User, *, user_agent: str | None, ip_address: str | None) -> tuple[str, str]:
    raw_session = secrets.token_urlsafe(48)
    csrf_token = secrets.token_urlsafe(32)
    now = utc_now()
    db.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_opaque_token(raw_session),
            created_at=now,
            expires_at=now + dt.timedelta(days=_SESSION_DAYS),
            user_agent=(user_agent or "")[:512] or None,
            ip_hash=hash_ip(ip_address),
        )
    )
    return raw_session, csrf_token


def revoke_session(db: Session, raw_session: str | None) -> None:
    if not raw_session:
        return
    session = db.scalar(select(AuthSession).where(AuthSession.token_hash == hash_opaque_token(raw_session)))
    if session is not None and session.revoked_at is None:
        session.revoked_at = utc_now()


def public_user(user: User) -> dict[str, str | None]:
    return {"id": str(user.id), "name": user.name, "email": user.email, "phone": user.phone, "role": user.role}
