import csv
import datetime as dt
import io
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user
from app.api.v1.admin import router
from app.api.v1.organizer import router as organizer_router
from db import Base, get_db
from models import CheckoutPayment, CheckoutReceipt, Payment, Refund, CashfreePaymentResolution, Organization, OrganizationMember
from tests import test_organizer_settlement_service as fixtures


class CashfreeLedgerTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.f = fixtures.OrganizerSettlementServiceTests()
        self.f.db = Session(self.engine)
        self.f._seed()
        self.reg = self.f._payment(10000, fee=500)
        self.reg.registration_reference = "SPE-TEST"
        self.checkout = self.f.db.scalar(select(CheckoutPayment))
        self.checkout.created_at = dt.datetime(2026, 10, 16, 18, 30)  # Oct 17 midnight IST
        self.f.db.commit()
        app = FastAPI()
        app.include_router(router, prefix="/admin")
        app.include_router(organizer_router, prefix="/organizer")
        app.dependency_overrides[get_db] = lambda: self.f.db
        app.dependency_overrides[get_current_user] = lambda: self.f.admin
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.f.db.close()
        self.engine.dispose()

    def get(self, **params):
        response = self.client.get("/admin/cashfree-ledger", params=params)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_event_dates_search_and_export_match(self):
        filters = dict(event_id=str(self.f.event.id), date_from="2026-10-17", date_to="2026-10-17", search="SPE-TEST", status="successful")
        result = self.get(**filters)
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["summary"]["collectedPaise"], 10000)
        self.assertEqual(self.get(date_to="2026-10-16")["total"], 0)
        self.assertEqual(self.get(date_from="2026-10-18")["total"], 0)
        output = self.client.get("/admin/cashfree-ledger/export", params=filters)
        self.assertEqual(output.status_code, 200, output.text)
        rows = list(csv.DictReader(io.StringIO(output.text)))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["registration_reference"], "SPE-TEST")
        self.assertEqual(rows[0]["amount_paise"], "10000")
        self.assertIn("+05:30", rows[0]["created_at"])
        self.assertEqual(self.client.get("/admin/cashfree-ledger/events").json()["items"][0]["id"], str(self.f.event.id))

    def test_shared_checkout_and_multiple_receipts_do_not_duplicate_registration_totals(self):
        second = self.f._payment(20000)
        second_payment = self.f.db.scalar(select(Payment).where(Payment.registration_id == second.id))
        second_payment.order_id = self.checkout.event_order_id
        self.checkout.amount_paise = 30000
        receipt = self.f.db.scalar(select(CheckoutReceipt).where(CheckoutReceipt.checkout_payment_id == self.checkout.id))
        receipt.amount_paise = 30000
        self.f.db.add(CheckoutReceipt(checkout_payment_id=self.checkout.id, provider="cashfree", account="merchant",
            environment="production", payment_id="duplicate-evidence", amount_paise=30000, disposition="confirmed"))
        self.f.db.commit()
        result = self.get(page_size=1)
        self.assertEqual(result["total"], 2)
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(result["summary"]["collectedPaise"], 30000)
        self.assertNotEqual(result["items"][0]["registration_id"], self.get(page=2, page_size=1)["items"][0]["registration_id"])

    def test_sandbox_and_event_isolation(self):
        other = self.f._event(self.f.organization, "Other event", "CASHFREE_MANAGED")
        self.f._payment(20000, event=other)
        self.checkout.provider_environment = "sandbox"
        self.f.db.commit()
        self.assertEqual(self.get()["total"], 1)
        self.assertEqual(self.get(environment="sandbox")["total"], 1)
        self.assertEqual(self.get(event_id=str(self.f.event.id))["total"], 0)
        self.assertEqual(self.get(environment="all")["total"], 2)

    def test_completed_refunds_and_resolution_refunds(self):
        refund = Refund(registration_id=self.reg.id, event_id=self.f.event.id, participant_id=self.reg.participant_id,
            organizer_id=self.f.organization.id, payment_method="cashfree", payment_provider="CASHFREE",
            original_registration_amount=10000, original_platform_fee=500, original_total_paid=10000,
            requested_refund_amount=10000, approved_refund_amount=10000, platform_fee_refund_amount=500,
            refund_reason="Test", provider_refund_id="CF-REFUND", status="REFUNDED")
        self.f.db.add(refund)
        self.f.db.commit()
        result = self.get(status="refunded", search="CF-REFUND")
        self.assertEqual(result["summary"]["refundedPaise"], 10000)
        receipt = self.f.db.scalar(select(CheckoutReceipt))
        self.f.db.add(CashfreePaymentResolution(checkout_payment_id=self.checkout.id, receipt_id=receipt.id,
            action="REFUND", status="REFUNDED", amount_paise=10000, reason="Recovered", initiated_by=self.f.admin.id))
        self.f.db.commit()
        self.assertEqual(self.get()["summary"]["refundedPaise"], 10000)

    def test_validation_permissions_and_formula_safe_export(self):
        self.assertEqual(self.client.get("/admin/cashfree-ledger?date_from=2026-10-18&date_to=2026-10-17").status_code, 422)
        self.assertEqual(self.client.get("/admin/cashfree-ledger?status=unknown").status_code, 422)
        self.f.event.name = "=HYPERLINK(1)"
        self.f.db.commit()
        text = self.client.get("/admin/cashfree-ledger/export").text
        self.assertIn("'=HYPERLINK(1)", text)
        self.f.admin.role = "organizer"
        for path in ("", "/export", "/events"):
            self.assertEqual(self.client.get("/admin/cashfree-ledger" + path).status_code, 403)

    def test_organizer_payments_exports_and_overview_are_membership_scoped(self):
        other_org = Organization(name="Other organizer", status="active")
        self.f.db.add(other_org)
        self.f.db.flush()
        other_event = self.f._event(other_org, "Private event", "CASHFREE_MANAGED")
        self.f._payment(90000, event=other_event)
        self.f.db.add(OrganizationMember(organization_id=self.f.organization.id,
            user_id=self.f.admin.id, member_role="organizer"))
        self.f.admin.role = "organizer"
        self.f.db.commit()
        result = self.client.get("/organizer/payments")
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["total"], 1)
        overview = self.client.get("/organizer/payments/overview")
        self.assertEqual(overview.status_code, 200, overview.text)
        self.assertEqual([e["id"] for e in overview.json()["events"]], [str(self.f.event.id)])
        self.assertEqual(overview.json()["summary"]["organizerPayablePaise"], 9500)
        exported = self.client.get("/organizer/payments/export")
        self.assertEqual(exported.status_code, 200, exported.text)
        self.assertNotIn("Private event", exported.text)
        self.assertEqual(len(list(csv.DictReader(io.StringIO(exported.text)))), 1)
        for path in ("", "/overview", "/export"):
            self.assertEqual(self.client.get(f"/organizer/payments{path}?event_id={other_event.id}").status_code, 404)

    def test_organizer_without_membership_has_no_financial_data(self):
        self.f.admin.role = "organizer"
        self.f.db.commit()
        self.assertEqual(self.client.get("/organizer/payments").json()["total"], 0)
        self.assertEqual(self.client.get("/organizer/payments/overview").json()["events"], [])
