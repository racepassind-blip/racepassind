from __future__ import annotations

import datetime as dt
import hashlib

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.services.auth_service import hash_opaque_token, utc_now
from models import RateLimitBucket

_WINDOW = dt.timedelta(minutes=10)
_RETRY_AFTER_SECONDS = int(_WINDOW.total_seconds())


class RateLimitExceeded(ValueError):
    def __init__(self, message: str, *, retry_after_seconds: int = _RETRY_AFTER_SECONDS) -> None:
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


def _rate_limit_key(prefix: str, token: str, client_ip: str) -> str:
    value = f"{prefix}:{hash_opaque_token(token)}:{client_ip}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _enforce_limit(
    db: Session,
    *,
    key_hash: str,
    max_attempts: int,
    message: str,
) -> None:
    now = utc_now()
    bucket = db.scalar(select(RateLimitBucket).where(RateLimitBucket.key_hash == key_hash).with_for_update())
    if bucket is None:
        try:
            db.add(RateLimitBucket(key_hash=key_hash, window_started_at=now, attempt_count=1, updated_at=now))
            db.flush()
            return
        except IntegrityError:
            # Another worker created the same first bucket. The transaction has to be
            # rolled back before the row can be selected and locked again.
            db.rollback()
            bucket = db.scalar(select(RateLimitBucket).where(RateLimitBucket.key_hash == key_hash).with_for_update())
            if bucket is None:
                raise

    window_started = bucket.window_started_at
    if window_started.tzinfo is None:
        window_started = window_started.replace(tzinfo=dt.timezone.utc)
    if now - window_started >= _WINDOW:
        bucket.window_started_at = now
        bucket.attempt_count = 1
        bucket.updated_at = now
        return
    if bucket.attempt_count >= max_attempts:
        raise RateLimitExceeded(message)
    bucket.attempt_count += 1
    bucket.updated_at = now


def _ip_key(prefix: str, client_ip: str) -> str:
    return _rate_limit_key(f"{prefix}-ip", "all", client_ip)


def _enforce_ip_limit(db: Session, *, prefix: str, client_ip: str, max_attempts: int, message: str) -> None:
    _enforce_limit(
        db,
        key_hash=_ip_key(prefix, client_ip),
        max_attempts=max_attempts,
        message=message,
    )


def enforce_login_limit(db: Session, *, email: str, client_ip: str) -> None:
    _enforce_ip_limit(
        db,
        prefix="login",
        client_ip=client_ip,
        max_attempts=30,
        message="Too many login attempts from this network. Try again later.",
    )
    _enforce_limit(
        db,
        key_hash=_rate_limit_key("login", email, client_ip),
        max_attempts=10,
        message="Too many login attempts. Try again later.",
    )


def enforce_account_registration_limit(db: Session, *, email: str, client_ip: str) -> None:
    _enforce_ip_limit(
        db,
        prefix="account-registration",
        client_ip=client_ip,
        max_attempts=20,
        message="Too many account-registration attempts from this network. Try again later.",
    )
    _enforce_limit(
        db,
        key_hash=_rate_limit_key("account-registration", email, client_ip),
        max_attempts=5,
        message="Too many account-registration attempts. Try again later.",
    )


def enforce_race_registration_limit(db: Session, *, event_id: str, ticket_id: str, client_ip: str) -> None:
    _enforce_ip_limit(
        db,
        prefix="race-registration",
        client_ip=client_ip,
        max_attempts=40,
        message="Too many race-registration attempts from this network. Try again later.",
    )
    _enforce_limit(
        db,
        key_hash=_rate_limit_key("race-registration", f"{event_id}:{ticket_id}", client_ip),
        max_attempts=20,
        message="Too many race-registration attempts. Try again later.",
    )


def enforce_payment_decision_limit(db: Session, *, registration_id: str, user_id: str, client_ip: str) -> None:
    _enforce_ip_limit(
        db,
        prefix="payment-decision",
        client_ip=client_ip,
        max_attempts=60,
        message="Too many payment-decision attempts from this network. Try again later.",
    )
    _enforce_limit(
        db,
        key_hash=_rate_limit_key("payment-decision", f"{registration_id}:{user_id}", client_ip),
        max_attempts=20,
        message="Too many payment-decision attempts. Try again later.",
    )


def payment_reference_key(confirmation_token: str, client_ip: str) -> str:
    return _rate_limit_key("payment-reference", confirmation_token, client_ip)


def enforce_payment_reference_limit(db: Session, *, confirmation_token: str, client_ip: str) -> None:
    _enforce_ip_limit(
        db,
        prefix="payment-reference",
        client_ip=client_ip,
        max_attempts=30,
        message="Too many payment-reference attempts from this network. Try again later.",
    )
    _enforce_limit(
        db,
        key_hash=payment_reference_key(confirmation_token, client_ip),
        max_attempts=5,
        message="Too many payment-reference attempts. Try again later.",
    )


def confirmation_lookup_key(confirmation_token: str, client_ip: str) -> str:
    return _rate_limit_key("confirmation-lookup", confirmation_token, client_ip)


def enforce_confirmation_lookup_limit(db: Session, *, confirmation_token: str, client_ip: str) -> None:
    _enforce_ip_limit(
        db,
        prefix="confirmation-lookup",
        client_ip=client_ip,
        max_attempts=60,
        message="Too many confirmation attempts from this network. Try again later.",
    )
    _enforce_limit(
        db,
        key_hash=confirmation_lookup_key(confirmation_token, client_ip),
        max_attempts=20,
        message="Too many confirmation attempts. Try again later.",
    )


def claim_attempt_key(registration_reference: str, claim_code: str, user_id: str, client_ip: str) -> str:
    value = f"claim:{user_id}:{registration_reference}:{hash_opaque_token(claim_code)}:{client_ip}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def enforce_claim_attempt_limit(
    db: Session,
    *,
    registration_reference: str,
    claim_code: str,
    user_id: str,
    client_ip: str,
) -> None:
    _enforce_ip_limit(
        db,
        prefix="claim",
        client_ip=client_ip,
        max_attempts=20,
        message="Too many claim attempts from this network. Try again later.",
    )
    _enforce_limit(
        db,
        key_hash=claim_attempt_key(registration_reference, claim_code, user_id, client_ip),
        max_attempts=5,
        message="Too many claim attempts. Try again later.",
    )


def checkin_attempt_key(material: str, user_id: str, client_ip: str) -> str:
    value = f"check-in:{user_id}:{hash_opaque_token(material)}:{client_ip}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def enforce_checkin_attempt_limit(db: Session, *, material: str, user_id: str, client_ip: str) -> None:
    _enforce_ip_limit(
        db,
        prefix="check-in",
        client_ip=client_ip,
        max_attempts=60,
        message="Too many check-in attempts from this network. Try again later.",
    )
    _enforce_limit(
        db,
        key_hash=checkin_attempt_key(material, user_id, client_ip),
        max_attempts=30,
        message="Too many check-in attempts. Try again later.",
    )
