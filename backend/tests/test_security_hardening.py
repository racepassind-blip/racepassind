from __future__ import annotations

import unittest
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.services.audit_service import safe_audit_metadata
from app.services.rate_limit_service import RateLimitExceeded, enforce_login_limit
from db import Base, get_db
from main import app


class SecurityHardeningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})

    def test_liveness_readiness_headers_and_request_id(self) -> None:
        with TestClient(app) as client:
            response = client.get("/health", headers={"X-Request-ID": "not-a-uuid"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {"status": "ok"})
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
            self.assertEqual(response.headers["X-Frame-Options"], "DENY")
            self.assertIn("frame-ancestors 'none'", response.headers["Content-Security-Policy"])
            self.assertTrue(uuid.UUID(response.headers["X-Request-ID"]))
            self.assertIn("racepass_csrf", response.cookies)

            ready = client.get("/ready")
            self.assertEqual(ready.status_code, 200)
            self.assertEqual(ready.json(), {"status": "ready"})

    def test_cors_allows_configured_origin_and_idempotency_preflight(self) -> None:
        with TestClient(app) as client:
            allowed = client.options(
                "/health",
                headers={
                    "Origin": "http://localhost:8080",
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "Idempotency-Key, X-CSRF-Token",
                },
            )
            self.assertEqual(allowed.status_code, 200)
            self.assertEqual(allowed.headers.get("access-control-allow-origin"), "http://localhost:8080")
            self.assertIn("Idempotency-Key", allowed.headers.get("access-control-allow-headers", ""))

            denied = client.options(
                "/health",
                headers={
                    "Origin": "https://untrusted.example",
                    "Access-Control-Request-Method": "POST",
                },
            )
            self.assertNotEqual(denied.headers.get("access-control-allow-origin"), "https://untrusted.example")

    def test_csrf_and_authentication_boundaries_are_enforced(self) -> None:
        with TestClient(app) as client:
            client.get("/health")
            login = client.post(
                "/api/v1/auth/login",
                json={"email": "person@example.test", "password": "not-a-real-password"},
            )
            self.assertEqual(login.status_code, 403)
            self.assertEqual(login.json()["detail"], "CSRF validation failed")

            organizer_event = client.post("/api/v1/organizer/events", json={})
            self.assertEqual(organizer_event.status_code, 401)
            self.assertEqual(organizer_event.json()["detail"], "Authentication required")
            self.assertEqual(client.post("/organizer/events", json={}).status_code, 404)

    def test_login_rate_limit_and_retry_after_policy(self) -> None:
        engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            for _ in range(10):
                enforce_login_limit(db, email="person@example.test", client_ip="198.51.100.10")
                db.commit()
            with self.assertRaises(RateLimitExceeded) as context:
                enforce_login_limit(db, email="person@example.test", client_ip="198.51.100.10")
            self.assertEqual(context.exception.retry_after_seconds, 600)

    def test_audit_metadata_redacts_sensitive_values(self) -> None:
        safe = safe_audit_metadata(
            {
                "password": "password-value",
                "confirmation_token": "confirmation-value",
                "utr_reference": "UTR-SECRET",
                "participant": {"name": "Runner Name", "email": "runner@example.test"},
                "hasUtr": True,
                "status": "confirmed",
            }
        )
        self.assertEqual(safe["password"], "[redacted]")
        self.assertEqual(safe["confirmation_token"], "[redacted]")
        self.assertEqual(safe["utr_reference"], "[redacted]")
        self.assertEqual(safe["participant"], "[redacted]")
        self.assertTrue(safe["hasUtr"])
        self.assertEqual(safe["status"], "confirmed")

    def test_dependency_overrides_are_restored(self) -> None:
        self.assertEqual(app.dependency_overrides.get(get_db), None)


if __name__ == "__main__":
    unittest.main()
