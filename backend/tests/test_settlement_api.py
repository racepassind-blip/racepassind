import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app.api.v1.admin import router
from app.api.deps import get_current_user
from db import Base, get_db
from tests import test_organizer_settlement_service as fixtures


class SettlementApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.f = fixtures.OrganizerSettlementServiceTests()
        self.f.engine = self.engine; self.f.db = Session(self.engine); self.f._seed()
        self.f._payment(100_000); self.f.db.commit()
        self.app = FastAPI(); self.app.include_router(router, prefix="/admin")
        self.app.dependency_overrides[get_db] = lambda: self.f.db
        self.app.dependency_overrides[get_current_user] = lambda: self.f.admin
        self.client = TestClient(self.app)
        self.client.cookies.set("racepass_csrf", "test-csrf")
        self.url = f"/admin/events/{self.f.event.id}/settlements"
        self.payload = dict(amount_paise=20_000, method="UPI", reference_number="API-UTR",
            settlement_date="2026-10-07", status="PAID", idempotency_key="api-request-key")

    def tearDown(self):
        self.client.close(); self.f.db.close(); self.engine.dispose()

    def test_admin_create_retry_and_history(self):
        first = self.client.post(self.url, json=self.payload, headers={"X-CSRF-Token": "test-csrf"})
        self.assertEqual(first.status_code, 201, first.text)
        retry = self.client.post(self.url, json=self.payload, headers={"X-CSRF-Token": "test-csrf"})
        self.assertEqual(retry.json()["id"], first.json()["id"])
        self.assertEqual(len(self.client.get(self.url).json()["items"]), 1)

    def test_missing_csrf_and_nonadmin_cannot_mutate(self):
        self.assertEqual(self.client.post(self.url, json=self.payload).status_code, 403)
        self.f.admin.role = "organizer"
        self.assertEqual(self.client.post(self.url, json=self.payload, headers={"X-CSRF-Token": "test-csrf"}).status_code, 403)
        self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_amount_and_reference_validation(self):
        for changes in ({"amount_paise": 0}, {"amount_paise": 1}, {"amount_paise": 1.5}, {"amount_paise": True},
                        {"reference_number": " "}, {"amount_paise": 100_001}):
            response = self.client.post(self.url, json={**self.payload, **changes}, headers={"X-CSRF-Token": "test-csrf"})
            self.assertEqual(response.status_code, 422, response.text)

    def test_event_search_and_collection_details(self):
        result = self.client.get("/admin/settlement-events?search=Managed").json()
        self.assertEqual(result["items"][0]["eventId"], str(self.f.event.id))
        entries = self.client.get(f"/admin/events/{self.f.event.id}/settlement-collections").json()
        self.assertEqual(entries["items"][0]["totalPaidPaise"], 100_000)
