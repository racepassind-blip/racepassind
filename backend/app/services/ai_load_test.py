"""Small, explicitly started, in-memory AI load-test job for Super Admins."""

from __future__ import annotations

import statistics
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any
from uuid import uuid4

from app.services.ai_rewrite_service import (
    AiInferenceBusy,
    acquire_inference_lease,
    finish_load_test_admission,
    load_test_snapshot,
    release_inference_lease,
    save_load_test_snapshot,
    start_load_test_admission,
)
from db import SessionLocal
from scripts.test_ai_connection import DiagnosticError, generate_prompt, load_config

STAGES = ((1, 5), (2, 6), (3, 6))
COOLDOWN_SECONDS = 30
GLOBAL_COOLDOWN_SECONDS = 300
_lock = threading.Lock()
_job: dict[str, Any] | None = None


def _p95(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, int(len(ordered) * 0.95) - 1))]


def recommendation(stage_results: list[dict[str, Any]]) -> str:
    viable = [stage["concurrency"] for stage in stage_results if stage["failures"] == 0 and stage["p95"] is not None]
    if not viable:
        return "No safe concurrency measured"
    maximum = max(viable)
    if maximum <= 1:
        return "1 request"
    return f"1–{maximum} concurrent requests"


def snapshot() -> dict[str, Any]:
    with _lock:
        local_snapshot = dict(_job) if _job is not None else None
    if local_snapshot is not None:
        return local_snapshot
    try:
        with SessionLocal() as db:
            return load_test_snapshot(db) or {"status": "idle"}
    except Exception:
        return {"status": "idle"}


def start() -> dict[str, Any]:
    global _job
    with _lock:
        if _job and _job["status"] in {"queued", "running", "cooldown"}:
            raise RuntimeError("An AI load test is already running")
        job_id = str(uuid4())
        job = {"id": job_id, "status": "queued", "stage": 0, "stageTotal": len(STAGES),
               "completed": 0, "total": sum(total for _, total in STAGES), "successes": 0, "failures": 0,
               "stages": [], "startedAt": time.time(), "totalDuration": None,
               "recommendation": None, "error": None}
        with SessionLocal() as db:
            try:
                start_load_test_admission(
                    db, job_id=job_id, cooldown_seconds=GLOBAL_COOLDOWN_SECONDS
                )
                save_load_test_snapshot(db, job_id=job_id, snapshot=job)
                db.commit()
            except AiInferenceBusy as exc:
                db.rollback()
                raise RuntimeError(str(exc)) from exc
            except Exception:
                db.rollback()
                raise
        _job = job
    threading.Thread(target=_run, args=(job_id,), daemon=True, name="sportpass-ai-load-test").start()
    return snapshot()


def _update(**values: Any) -> None:
    with _lock:
        if _job:
            _job.update(values)
            current = dict(_job)
        else:
            return
    try:
        with SessionLocal() as db:
            if save_load_test_snapshot(db, job_id=current["id"], snapshot=current):
                db.commit()
            else:
                db.rollback()
    except Exception:
        # The running job must continue even if progress persistence is temporarily unavailable.
        pass


def _generate_with_capacity(config: Any, prompt: str) -> dict[str, Any]:
    """Use the same global home-AI capacity limit as organizer rewrites."""
    with SessionLocal() as db:
        try:
            lease_id = acquire_inference_lease(db, purpose="admin-load-test")
            db.commit()
        except Exception:
            db.rollback()
            raise

    try:
        return generate_prompt(config, prompt)
    finally:
        with SessionLocal() as db:
            try:
                release_inference_lease(db, lease_id)
                db.commit()
            except Exception:
                db.rollback()


def _run(job_id: str) -> None:
    started = time.perf_counter()
    try:
        config = load_config()
        stage_results: list[dict[str, Any]] = []
        for index, (concurrency, total) in enumerate(STAGES, 1):
            _update(status="running", stage=index)
            durations: list[float] = []
            tokens = 0
            failures = 0
            prompts = [f"Synthetic SportPass load check {n}: state one safe operational fact." for n in range(total)]
            with ThreadPoolExecutor(max_workers=concurrency) as pool:
                futures = [pool.submit(_generate_with_capacity, config, prompt) for prompt in prompts]
                for future in as_completed(futures):
                    try:
                        result = future.result()
                        durations.append(result["duration"])
                        tokens += result["tokens"]
                        _update(completed=_job["completed"] + 1, successes=_job["successes"] + 1)
                    except (DiagnosticError, AiInferenceBusy) as exc:
                        failures += 1
                        _update(completed=_job["completed"] + 1, failures=_job["failures"] + 1, error=str(exc))
            stage = {"stage": index, "concurrency": concurrency, "requests": total, "successes": len(durations),
                     "failures": failures, "average": statistics.mean(durations) if durations else None,
                     "maximum": max(durations) if durations else None, "p95": _p95(durations), "tokens": tokens,
                     "tokensPerSecond": tokens / sum(durations) if durations and sum(durations) > 0 else None}
            stage_results.append(stage)
            _update(stages=stage_results)
            if failures and any(
                marker in str(_job.get("error", "")).lower()
                for marker in ("timeout", "connection", "network", "origin", "busy")
            ):
                _update(status="failed", error=_job.get("error"), totalDuration=time.perf_counter() - started)
                return
            if index < len(STAGES):
                _update(status="cooldown")
                time.sleep(COOLDOWN_SECONDS)
        _update(status="completed", totalDuration=time.perf_counter() - started,
                recommendation=recommendation(stage_results))
    except Exception as exc:
        _update(status="failed", error=str(exc), totalDuration=time.perf_counter() - started)
    finally:
        try:
            with SessionLocal() as db:
                finish_load_test_admission(db, job_id=job_id)
                db.commit()
        except Exception:
            # The expiry set during admission makes the distributed lock self-healing.
            pass
