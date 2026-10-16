import datetime as dt
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user
from app.api.v1.organizer import router
from db import Base, get_db
from models import CreditTopupRequest, CreditTransaction, Organization, OrganizationMember, User


class OrganizerCreditTopupsApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = User(name="Organizer", email="credits-organizer@example.com", password_hash="test", role="organizer")
        self.organization = Organization(name="My club", status="active")
        other_organization = Organization(name="Other club", status="active")
        self.db.add_all([self.user, self.organization, other_organization])
        self.db.flush()
        self.db.add(OrganizationMember(organization_id=self.organization.id, user_id=self.user.id, member_role="organizer"))
        for reference, status, requested_at, organization_id in (
            ("A", "PENDING", dt.datetime(2026, 9, 30, 18, 45), self.organization.id),
            ("B", "APPROVED", dt.datetime(2026, 10, 1, 12), self.organization.id),
            ("C", "PENDING", dt.datetime(2026, 10, 31, 18, 29), self.organization.id),
            ("D", "REJECTED", dt.datetime(2026, 10, 31, 18, 30), self.organization.id),
            ("OTHER", "PENDING", dt.datetime(2026, 10, 10, 12), other_organization.id),
        ):
            self.db.add(CreditTopupRequest(organization_id=organization_id, amount_paise=50000, credits_paise=50000, utr_reference=reference, status=status, requested_at=requested_at))
        self.db.commit()
        app = FastAPI()
        app.include_router(router, prefix="/organizer")
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.db.close()
        self.engine.dispose()

    def test_month_uses_local_boundaries_and_pages_are_filtered(self):
        params = {"month": "2026-10", "timezone_offset_minutes": -330, "page_size": 1}
        first = self.client.get("/organizer/credits/topups", params=params)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()["total"], 3)
        self.assertEqual(first.json()["pending"], 2)
        self.assertEqual(first.json()["items"][0]["utrReference"], "C")
        second = self.client.get("/organizer/credits/topups", params={**params, "page": 2})
        self.assertEqual(second.json()["items"][0]["utrReference"], "B")
        pending = self.client.get("/organizer/credits/topups", params={**params, "topup_status": "PENDING"})
        self.assertEqual(pending.json()["total"], 2)
        self.assertEqual(pending.json()["pending"], 2)

    def test_invalid_month_or_status_is_rejected(self):
        for params in ({"month": "2026-13"}, {"month": "2026-10-extra"}, {"topup_status": "PAID"}):
            response = self.client.get("/organizer/credits/topups", params=params)
            self.assertEqual(response.status_code, 422, response.text)

    def test_activity_filters_count_and_paginate_by_signed_balance_change(self):
        other = Organization(name="Unrelated club", status="active")
        self.db.add(other)
        self.db.flush()
        for description, created_at, before, after, organization_id in (
            ("Start", dt.datetime(2026, 9, 30, 18, 30), 0, 10000, self.organization.id),
            ("Debit", dt.datetime(2026, 10, 1, 12), 10000, 8000, self.organization.id),
            ("End", dt.datetime(2026, 10, 31, 18, 29), 8000, 12000, self.organization.id),
            ("Next month", dt.datetime(2026, 10, 31, 18, 30), 12000, 14000, self.organization.id),
            ("Other club", dt.datetime(2026, 10, 15), 0, 10000, other.id),
        ):
            self.db.add(CreditTransaction(
                organization_id=organization_id, type="TEST", description=description,
                amount_paise=abs(after - before), balance_before_paise=before,
                balance_after_paise=after, created_at=created_at,
            ))
        self.db.commit()
        params = {"month": "2026-10", "timezone_offset_minutes": -330, "page_size": 1, "direction": "CREDIT"}
        response = self.client.get("/organizer/credits/transactions", params=params)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["total"], 2)
        self.assertEqual(response.json()["items"][0]["description"], "End")
        second = self.client.get("/organizer/credits/transactions", params={**params, "page": 2}).json()
        self.assertEqual(second["items"][0]["description"], "Start")
        debit = self.client.get("/organizer/credits/transactions", params={**params, "direction": "DEBIT"}).json()
        self.assertEqual(debit["total"], 1)
        self.assertEqual(debit["items"][0]["amountPaise"], -2000)
        for invalid in ({"month": "2026-13"}, {"direction": "OTHER"}):
            self.assertEqual(self.client.get("/organizer/credits/transactions", params=invalid).status_code, 422)
