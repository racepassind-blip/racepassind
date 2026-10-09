import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from db import Base, get_db
from app.api.deps import get_current_user
from app.api.v1.cashfree import router
from app.services.cashfree_registration_service import reconcile_order
from tests import test_cashfree_integration as fixtures
from tests.test_cashfree_payment_review import ReviewGateway


class CashfreeReviewApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.f = fixtures.CashfreeIntegrationTests()
        self.f.engine, self.f.db = self.engine, Session(self.engine)
        self.f._seed()
        self.f.event.status = "draft"
        self.f.db.commit()
        self.gateway = ReviewGateway()
        self.patchers = [patch(f"app.services.{module}.CashfreeGateway", return_value=self.gateway)
                         for module in ("cashfree_registration_service", "cashfree_payment_review")]
        for patcher in self.patchers:
            patcher.start()
        reconcile_order(self.f.db, provider_order_id=self.f.checkout.provider_order_id)
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = lambda: self.f.db
        app.dependency_overrides[get_current_user] = lambda: self.f.admin
        self.client = TestClient(app)
        self.client.cookies.set("racepass_csrf", "csrf")
        self.headers = {"X-CSRF-Token": "csrf"}
        self.url = f"/admin/cashfree/payment-reviews/{self.f.checkout.id}"

    def tearDown(self):
        self.client.close()
        for patcher in self.patchers:
            patcher.stop()
        self.f.db.close()
        self.engine.dispose()

    def test_reviews_require_admin_and_resolutions_require_csrf(self):
        payload = {"action": "REFUND", "reason": "Booking cannot complete"}
        self.assertEqual(self.client.post(self.url + "/resolve", json=payload).status_code, 403)
        self.f.admin.role = "organizer"
        self.assertEqual(self.client.get("/admin/cashfree/payment-reviews").status_code, 403)
        self.assertEqual(self.client.post(self.url + "/resolve", json=payload, headers=self.headers).status_code, 403)
        self.assertEqual(self.gateway.calls, 0)

    def test_refund_history_and_customer_status(self):
        listing = self.client.get("/admin/cashfree/payment-reviews?search=Race").json()
        self.assertEqual(listing["total"], 1)
        self.assertEqual(listing["items"][0]["status"], "NEEDS_DECISION")
        response = self.client.post(self.url + "/resolve", json={"action": "REFUND", "reason": "Booking cannot complete"}, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        token = {"confirmation_token": "test-confirmation-token"}
        self.assertEqual(self.client.post("/registrations/cashfree/status", json=token, headers=self.headers).json()["status"], "refund_pending")
        self.gateway.refund_status = "SUCCESS"
        self.assertEqual(self.client.post(self.url + "/reconcile", headers=self.headers).json()["status"], "REFUNDED")
        self.assertEqual(self.client.post("/registrations/cashfree/status", json=token, headers=self.headers).json()["status"], "refunded")
        self.assertEqual(self.client.get("/admin/cashfree/payment-reviews").json()["total"], 0)
        resolved = self.client.get("/admin/cashfree/payment-reviews?include_resolved=true").json()["items"][0]
        self.assertEqual(resolved["resolution"]["initiatedBy"], "Admin")
        self.assertEqual(resolved["status"], "REFUNDED")
        self.assertTrue(any(entry["action"] == "cashfree_payment_resolution_created" for entry in resolved["history"]))

    def test_whitespace_reason_and_unknown_action_blocked(self):
        for payload in ({"action": "REFUND", "reason": "     "}, {"action": "OTHER", "reason": "Reviewed booking"}):
            self.assertEqual(self.client.post(self.url + "/resolve", json=payload, headers=self.headers).status_code, 422)
        self.assertEqual(self.gateway.calls, 0)
