import importlib.util
from pathlib import Path
import unittest
import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user
from app.api.v1.admin_bills import router
from db import Base, get_db
from models import AdminBill, AuditLog, CreditTransaction, Event, Organization, User


class BillTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.admin = User(name="Admin", email="admin@example.test", password_hash="test", role="admin", mfa_enabled=True)
        self.org = Organization(name="Test organizer", status="active", billing_name="Test legal name", billing_address="Test address")
        self.db.add_all([self.admin, self.org]); self.db.commit()
        app = FastAPI(); app.include_router(router, prefix="/admin")
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user] = lambda: self.admin
        self.client = TestClient(app)
        self.client.cookies.set("racepass_csrf", "test")
        self.headers = {"X-CSRF-Token": "test"}
        self.payload = dict(organization_id=str(self.org.id), kind="CREDITS", idempotency_key=str(uuid.uuid4()),
            issuer_email="billing@example.test", issuer_phone="+91 9000000000", issuer_address="Business address",
            customer_name="Test legal name", customer_address="Client address", issue_date="2026-01-01",
            lines=[dict(description="Credits supplied", quantity=100, unit_paise=100)], discount_paise=1000,
            status="PENDING")

    def tearDown(self):
        self.client.close(); self.db.close(); self.engine.dispose()

    def create(self, **changes):
        return self.client.post("/admin/bills", json={**self.payload, **changes}, headers=self.headers)

    def test_issue_snapshot_retry_and_no_credit_mutations(self):
        first = self.create()
        self.assertEqual(first.status_code, 201, first.text)
        bill = first.json()
        self.assertEqual(bill["totalPaise"], 9000)
        self.assertEqual(bill["number"], "SPI-2026-000001")
        self.assertEqual(self.create().json()["id"], bill["id"])
        self.assertEqual(self.create(discount_paise=0).status_code, 409)
        self.org.billing_name = "Changed later"; self.db.commit()
        listed = self.client.get("/admin/bills").json()
        self.assertEqual(listed["total"], 1)
        self.assertEqual(listed["items"][0]["details"]["customer_name"], "Test legal name")
        self.assertEqual(self.db.scalars(select(CreditTransaction)).all(), [])
        self.assertEqual(len(self.db.scalars(select(AuditLog)).all()), 1)

    def test_paid_bill_has_no_amount_collection_side_effect(self):
        response = self.create(status="PAID", paid_on="2025-12-31", payment_reference="Purchased Credits reference")
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["status"], "PAID")
        self.assertEqual(self.db.scalars(select(CreditTransaction)).all(), [])

    def test_status_transitions_and_audit(self):
        bill = self.create().json()
        url = f"/admin/bills/{bill['id']}"
        payload = dict(status="PAID", paid_on="2026-01-02", payment_reference="BANK-001")
        self.assertEqual(self.client.patch(url, json={"status": "PAID"}, headers=self.headers).status_code, 422)
        self.assertEqual(self.client.patch(url, json=payload, headers=self.headers).status_code, 200)
        self.assertEqual(self.client.patch(url, json=payload, headers=self.headers).status_code, 200)
        self.assertEqual(self.client.patch(url, json={"status": "CANCELLED", "reason": "Duplicate"}, headers=self.headers).status_code, 409)
        self.assertEqual(len(self.db.scalars(select(AuditLog)).all()), 2)
        self.assertEqual(self.db.scalars(select(CreditTransaction)).all(), [])

    def test_cancel_requires_reason_and_is_retry_safe(self):
        bill = self.create().json(); url = f"/admin/bills/{bill['id']}"
        self.assertEqual(self.client.patch(url, json={"status": "CANCELLED"}, headers=self.headers).status_code, 422)
        payload = {"status": "CANCELLED", "reason": "Issued twice"}
        for _ in range(2):
            self.assertEqual(self.client.patch(url, json=payload, headers=self.headers).status_code, 200)
        self.assertEqual(len(self.db.scalars(select(AuditLog)).all()), 2)

    def test_validation(self):
        for changes in [dict(discount_paise=10001), dict(discount_paise=True), dict(discount_paise=1.5),
                        dict(issuer_phone=""), dict(issuer_email="invalid"), dict(customer_name="  "),
                        dict(lines=[]), dict(lines=[dict(description="Fee", quantity=-1, unit_paise=10)]),
                        dict(lines=[dict(description="Fee", quantity=1000000, unit_paise=100000000)]),
                        dict(status="PAID"), dict(payment_reference="Payment but pending"),
                        dict(kind="EVENT"), dict(issue_date="2099-01-01"), dict(due_date="2025-01-01")]:
            with self.subTest(changes=changes):
                self.assertEqual(self.create(**changes).status_code, 422)
        self.assertEqual(self.db.scalars(select(AdminBill)).all(), [])

    def test_event_belongs_to_client(self):
        other = Organization(name="Other", status="active"); self.db.add(other); self.db.flush()
        event = Event(organization_id=other.id, name="Other event", description="Test", category="running", distance="5k", status="draft", max_participants=100, rules=[])
        self.db.add(event); self.db.commit()
        self.assertEqual(self.create(kind="EVENT", event_id=str(event.id)).status_code, 422)
        event.organization_id = self.org.id; self.db.commit()
        response = self.create(kind="EVENT", event_id=str(event.id))
        self.assertEqual(response.status_code, 201, response.text)
        event.name = "Renamed"; self.db.commit()
        self.assertEqual(self.client.get("/admin/bills").json()["items"][0]["details"]["event_name"], "Other event")

    def test_admin_and_csrf_enforced(self):
        self.assertEqual(self.client.post("/admin/bills", json=self.payload).status_code, 403)
        bill = self.create().json()
        self.assertEqual(self.client.patch(f"/admin/bills/{bill['id']}", json={"status": "CANCELLED", "reason": "Test"}).status_code, 403)
        self.admin.role = "organizer"; self.db.commit()
        self.assertEqual(self.create().status_code, 403)
        self.assertEqual(self.client.get("/admin/bills").status_code, 403)
        self.assertEqual(self.client.get(f"/admin/bills/customer/{self.org.id}").status_code, 403)
        self.assertEqual(self.client.patch(f"/admin/bills/{bill['id']}", json={"status": "CANCELLED", "reason": "Test"}, headers=self.headers).status_code, 403)

    def test_pagination_and_defaults(self):
        self.create()
        data = self.client.get(f"/admin/bills/customer/{self.org.id}").json()
        self.assertEqual(data["issuer"]["issuer_phone"], self.payload["issuer_phone"])
        self.assertEqual(data["name"], "Test legal name")
        self.assertEqual(self.client.get("/admin/bills?page=2").json()["items"], [])
        self.assertEqual(self.client.get(f"/admin/bills?organization_id={uuid.uuid4()}").json()["total"], 0)

    def test_migration_creates_usable_table_and_downgrades(self):
        from alembic.migration import MigrationContext
        from alembic.operations import Operations
        from sqlalchemy import inspect
        path = Path(__file__).parents[1] / "migrations/versions/0089_admin_bills.py"
        spec = importlib.util.spec_from_file_location("bill_migration", path)
        migration = importlib.util.module_from_spec(spec); spec.loader.exec_module(migration)
        AdminBill.__table__.drop(self.engine)
        with self.engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
        self.assertEqual(self.create().status_code, 201)
        with self.engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
            self.assertNotIn("admin_bills", inspect(connection).get_table_names())
