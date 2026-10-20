from sqlalchemy import select
from models import CheckoutReceipt, ProductListing, ProductOrder
from tests.test_cashfree_ledger import CashfreeLedgerTests


class AdminTransactionsTests(CashfreeLedgerTests):
    def report(self, **params):
        response = self.client.get("/admin/transactions", params=params)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_gateway_is_not_duplicated_and_filters_match(self):
        data = self.report()
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["amount"], 10000)
        self.assertEqual(data["items"][0]["confirmation"], "Verified by Cashfree")
        self.assertEqual(self.report(method="direct_upi")["total"], 0)
        self.assertEqual(self.report(event_id=str(self.f.event.id))["total"], 1)
        self.assertEqual(self.report(date_to="2026-10-16")["total"], 0)
        receipt = self.f.db.scalar(select(CheckoutReceipt))
        self.assertEqual(self.report(search=receipt.payment_id)["total"], 1)

    def test_unverified_success_not_labelled_verified(self):
        for receipt in self.f.db.scalars(select(CheckoutReceipt)).all():
            self.f.db.delete(receipt)
        self.f.db.commit()
        row = self.report()["items"][0]
        self.assertEqual(row["status"], "needs_review")
        self.assertNotEqual(row["confirmation"], "Verified by Cashfree")

    def test_merchandise_and_counts_and_search(self):
        listing = ProductListing(organization_id=self.f.event.organization_id, name="Club shirts", catalog={}, upi_id="club@upi", payee_name="Club")
        self.f.db.add(listing)
        self.f.db.flush()
        order = ProductOrder(listing_id=listing.id, request_key="test-order", access_hash="hash",
            buyer_name="Merch buyer", buyer_email="buyer@example.com", buyer_phone="9876543210",
            snapshot={"total_paise": 15000, "platform_fee_paise": 300}, status="under_review",
            payment_reference="123456789012")
        self.f.db.add(order)
        self.f.db.commit()
        data = self.report()
        self.assertEqual(data["total"], 2)
        self.assertEqual(data["counts"]["needs_review"], 1)
        found = self.report(search="123456789012", kind="merchandise")
        self.assertEqual(found["total"], 1)
        self.assertEqual(found["items"][0]["amount"], 15000)
        self.assertEqual(self.report(status="successful")["total"], 1)

    def test_sandbox_excluded_and_admin_required(self):
        self.checkout.provider_environment = "sandbox"
        self.f.db.commit()
        self.assertEqual(self.report()["total"], 0)
        self.f.admin.role = "organizer"
        self.f.db.commit()
        self.assertEqual(self.client.get("/admin/transactions").status_code, 403)

    def test_direct_upi_uses_organizer_confirmation_and_utr(self):
        from models import Payment
        self.checkout.mode = "DIRECT_UPI"
        self.f.event.payment_collection_method = "DIRECT_UPI"
        self.reg.payment_status = "approved"
        payment = self.f.db.scalar(select(Payment).where(Payment.registration_id == self.reg.id))
        payment.utr_reference = "UPI123456789"
        self.f.db.commit()
        row = self.report(search="UPI123456789")["items"][0]
        self.assertEqual(row["method"], "direct_upi")
        self.assertEqual(row["confirmation"], "Confirmed by organizer")
        self.assertEqual(self.report()["total"], 1)
        self.assertEqual(self.client.get(f"/admin/transactions/registration/{self.reg.id}").status_code, 200)
