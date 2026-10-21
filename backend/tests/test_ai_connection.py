from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
import requests
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.services.ai_load_test import recommendation
from app.services.ai_rewrite_service import (
    AiInferenceBusy,
    acquire_inference_lease,
    finish_load_test_admission,
    load_test_snapshot,
    release_inference_lease,
    save_load_test_snapshot,
    start_load_test_admission,
)
from db import Base


SCRIPT = Path(__file__).parents[1] / "scripts" / "test_ai_connection.py"
spec = importlib.util.spec_from_file_location("test_ai_connection_script", SCRIPT)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class FakeSession:
    def __init__(self, tags, generate):
        self.tags = tags
        self.generate = generate
        self.calls = []

    def get(self, *args, **kwargs):
        self.calls.append(("get", args, kwargs))
        return self.tags

    def post(self, *args, **kwargs):
        self.calls.append(("post", args, kwargs))
        return self.generate


def response(status, body):
    item = requests.Response()
    item.status_code = status
    item._content = __import__("json").dumps(body).encode()
    return item


def config():
    return module.Config("https://ai.example/", "qwen2.5:1.5b", {"CF-Access-Client-Id": "id", "CF-Access-Client-Secret": "secret"})


def test_success_sends_authenticated_requests_and_parses_timings():
    session = FakeSession(response(200, {"models": [{"name": "qwen2.5:1.5b"}]}), response(200, {"response": "Facts only.", "load_duration": 2_000_000_000, "eval_duration": 3_000_000_000}))
    result = module.run_diagnostic(config(), session)
    assert result["model_available"] is True
    assert result["model_load_duration"] == 2.0
    assert session.calls[0][2]["headers"]["CF-Access-Client-Secret"] == "secret"
    payload = session.calls[1][2]["json"]
    assert payload["stream"] is False
    assert payload["options"] == {"temperature": 0.2, "num_ctx": 2048, "num_predict": 100}


def test_missing_environment_is_reported_without_values():
    with pytest.raises(module.DiagnosticError, match="SPORTPASS_AI_URL"):
        module.load_config({"CF_ACCESS_CLIENT_SECRET": "do-not-print"})


@pytest.mark.parametrize("status,expected", [(401, "authentication"), (403, "authentication"), (502, "origin"), (503, "origin")])
def test_http_failures_are_distinguished(status, expected):
    session = FakeSession(response(status, {}), response(200, {}))
    with pytest.raises(module.DiagnosticError, match=expected):
        module.run_diagnostic(config(), session)


def test_model_unavailable_is_failure():
    session = FakeSession(response(200, {"models": [{"name": "other:model"}]}), response(200, {}))
    with pytest.raises(module.DiagnosticError, match="model unavailable"):
        module.run_diagnostic(config(), session)


def test_timeout_is_reported():
    class TimeoutSession:
        def get(self, *args, **kwargs):
            raise requests.exceptions.Timeout()

    with pytest.raises(module.DiagnosticError, match="timeout"):
        module.run_diagnostic(config(), TimeoutSession())


def test_load_test_recommendation_uses_only_fully_successful_stages():
    assert recommendation([{"concurrency": 1, "failures": 0, "p95": 1.0}, {"concurrency": 2, "failures": 1, "p95": 2.0}]) == "1 request"
    assert recommendation([{"concurrency": 1, "failures": 0, "p95": 1.0}, {"concurrency": 2, "failures": 0, "p95": 2.0}]) == "1–2 concurrent requests"
    assert recommendation([{"concurrency": 1, "failures": 1, "p95": None}]) == "No safe concurrency measured"


def test_rewrite_description_uses_system_prompt_and_returns_only_model_text():
    session = FakeSession(response(200, {}), response(200, {"response": "Join us for a friendly community ride."}))
    rewritten = module.rewrite_description(config(), "Community ride for local cyclists.", session)
    assert rewritten == "Join us for a friendly community ride."
    payload = session.calls[0][2]["json"]
    assert payload["stream"] is False
    assert "Use only facts present" in payload["system"]
    assert "Do not invent" in payload["system"]
    assert "untrusted source material" in payload["system"]
    assert "not a creative writer" in payload["system"]
    assert payload["options"]["temperature"] == 0.1


def test_rewrite_description_falls_back_when_model_changes_source_terms():
    session = FakeSession(response(200, {}), response(200, {"response": "Mysuru Dasra is organizing a special event for HAM."}))
    source = "Mysuru's Dasara celebrates with HAMS."
    assert module.rewrite_description(config(), source, session) == source


def test_ai_inference_lease_enforces_shared_capacity():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        leases = [acquire_inference_lease(db, purpose="test") for _ in range(3)]
        db.commit()
        with pytest.raises(AiInferenceBusy):
            acquire_inference_lease(db, purpose="test")
        db.rollback()
        release_inference_lease(db, leases[0])
        db.commit()
        assert acquire_inference_lease(db, purpose="test")


def test_load_test_admission_is_globally_exclusive_and_applies_cooldown():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        start_load_test_admission(db, job_id="job-1", cooldown_seconds=300)
        db.commit()
        with pytest.raises(AiInferenceBusy, match="already running"):
            start_load_test_admission(db, job_id="job-2", cooldown_seconds=300)
        db.rollback()
        finish_load_test_admission(db, job_id="job-1")
        db.commit()
        with pytest.raises(AiInferenceBusy, match="cooldown"):
            start_load_test_admission(db, job_id="job-2", cooldown_seconds=300)


def test_old_load_test_cannot_release_a_newer_job_lock():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        start_load_test_admission(db, job_id="current-job", cooldown_seconds=0)
        db.commit()
        finish_load_test_admission(db, job_id="stale-job")
        db.commit()
        with pytest.raises(AiInferenceBusy, match="already running"):
            start_load_test_admission(db, job_id="next-job", cooldown_seconds=0)


def test_load_test_progress_snapshot_is_shared_through_database():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        start_load_test_admission(db, job_id="job-1", cooldown_seconds=0)
        assert save_load_test_snapshot(db, job_id="job-1", snapshot={"id": "job-1", "status": "running"})
        db.commit()
        assert load_test_snapshot(db) == {"id": "job-1", "status": "running"}
