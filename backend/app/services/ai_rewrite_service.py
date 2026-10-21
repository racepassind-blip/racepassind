"""Shared admission control for the private, CPU-bound Ollama service."""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.services.auth_service import utc_now
from models import AiInferenceGuard, AiInferenceLease

# This matches the intentional maximum stage in the Super Admin load test.
AI_INFERENCE_CAPACITY = 3
AI_INFERENCE_LEASE_SECONDS = 210
LOAD_TEST_MAX_DURATION_SECONDS = 40 * 60
_GUARD_KEY = "home-ai"


class AiInferenceBusy(RuntimeError):
    """The shared home AI capacity is currently fully reserved."""


def acquire_inference_lease(
    db: Session,
    *,
    purpose: str,
    organization_id: uuid.UUID | None = None,
) -> uuid.UUID:
    """Reserve one shared slot; caller owns the surrounding transaction."""
    now = utc_now()
    guard = db.scalar(select(AiInferenceGuard).where(AiInferenceGuard.key == _GUARD_KEY).with_for_update())
    if guard is None:
        # Production migrations seed this row. Creating it also keeps isolated SQLite
        # tests self-contained; PostgreSQL serializes normal callers on the seeded row.
        guard = AiInferenceGuard(key=_GUARD_KEY, updated_at=now)
        db.add(guard)
        db.flush()

    db.execute(delete(AiInferenceLease).where(AiInferenceLease.expires_at <= now))
    active = db.scalar(select(func.count(AiInferenceLease.id))) or 0
    if active >= AI_INFERENCE_CAPACITY:
        raise AiInferenceBusy("AI service is busy. Try again shortly.")

    lease = AiInferenceLease(
        purpose=purpose,
        organization_id=organization_id,
        expires_at=now + dt.timedelta(seconds=AI_INFERENCE_LEASE_SECONDS),
    )
    db.add(lease)
    db.flush()
    return lease.id


def release_inference_lease(db: Session, lease_id: uuid.UUID) -> None:
    """Release a slot early. Expiry makes capacity self-healing after a crash."""
    db.execute(delete(AiInferenceLease).where(AiInferenceLease.id == lease_id))


def start_load_test_admission(db: Session, *, job_id: str, cooldown_seconds: int) -> None:
    """Atomically allow one load test across all web workers and replicas."""
    now = utc_now()
    guard = db.scalar(select(AiInferenceGuard).where(AiInferenceGuard.key == _GUARD_KEY).with_for_update())
    if guard is None:
        guard = AiInferenceGuard(key=_GUARD_KEY, updated_at=now)
        db.add(guard)
        db.flush()
    active_until = guard.load_test_active_until
    if active_until is not None:
        if active_until.tzinfo is None:
            active_until = active_until.replace(tzinfo=dt.timezone.utc)
        if active_until > now:
            raise AiInferenceBusy("An AI load test is already running")
    last_finished = guard.last_load_test_finished_at
    if last_finished is not None:
        if last_finished.tzinfo is None:
            last_finished = last_finished.replace(tzinfo=dt.timezone.utc)
        remaining = cooldown_seconds - (now - last_finished).total_seconds()
        if remaining > 0:
            raise AiInferenceBusy(f"AI load test cooldown active; try again in {int(remaining)}s")
    guard.load_test_active_until = now + dt.timedelta(seconds=LOAD_TEST_MAX_DURATION_SECONDS)
    guard.load_test_job_id = job_id
    guard.updated_at = now


def finish_load_test_admission(db: Session, *, job_id: str) -> None:
    """Release the distributed load-test admission lock after a terminal result."""
    guard = db.scalar(select(AiInferenceGuard).where(AiInferenceGuard.key == _GUARD_KEY).with_for_update())
    if guard is not None and guard.load_test_job_id == job_id:
        now = utc_now()
        guard.load_test_active_until = None
        guard.load_test_job_id = None
        guard.last_load_test_finished_at = now
        guard.updated_at = now


def save_load_test_snapshot(db: Session, *, job_id: str, snapshot: dict) -> bool:
    """Persist visible load-test progress for polling from any web worker."""
    guard = db.scalar(select(AiInferenceGuard).where(AiInferenceGuard.key == _GUARD_KEY).with_for_update())
    if guard is None or guard.load_test_job_id not in {job_id, None}:
        return False
    guard.load_test_snapshot = snapshot
    guard.updated_at = utc_now()
    return True


def load_test_snapshot(db: Session) -> dict | None:
    guard = db.scalar(select(AiInferenceGuard).where(AiInferenceGuard.key == _GUARD_KEY))
    return dict(guard.load_test_snapshot) if guard and guard.load_test_snapshot else None
