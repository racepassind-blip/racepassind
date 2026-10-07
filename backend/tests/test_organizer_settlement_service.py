from __future__ import annotations

import datetime as dt
import unittest
import uuid

from sqlalchemy import create_engine, select, event as sa_event
from sqlalchemy.orm import Session

from app.services.organizer_settlement_service import (
    SettlementValidationError,
    create_adjustment,
    create_settlement,
    list_settlements,
    settlement_summary,
    update_pending_settlement,
    post_verified_collection,
)
from db import Base
from models import CheckoutPayment, CheckoutReceipt, Event, Order, Organization, OrganizerSettlement, Participant, Payment, Refund, Registration, Ticket, User


class OrganizerSettlementServiceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        @sa_event.listens_for(self.engine, "connect")
        def foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self._seed()

    def _seed(self):
        self.admin = User(name="Admin", email=f"{uuid.uuid4()}@test.local", password_hash="x", role="admin")
        self.organization = Organization(name="Organizer", status="active")
        self.db.add_all([self.admin, self.organization]); self.db.flush()
        self.event = self._event(self.organization, "Managed event", "CASHFREE_MANAGED")
        self.ticket = Ticket(event_id=self.event.id, name="Entry", description="Entry", price=40000, currency="INR", quantity_total=1000)
        self.db.add(self.ticket); self.db.flush()

    def tearDown(self):
        self.db.close(); self.engine.dispose()

    def _event(self, organization, name, mode):
        row = Event(organization_id=organization.id, name=name, description="Test", category="running",
                    max_participants=1000, status="published", distance="5k", rules=[], payment_collection_method=mode)
        self.db.add(row); self.db.flush(); return row

    def _payment(self, amount, *, fee=0, event=None, gateway="cashfree", bearer="ORGANIZER"):
        event = event or self.event
        participant = Participant(name=f"P-{uuid.uuid4().hex[:6]}")
        self.db.add(participant); self.db.flush()
        ticket = self.ticket if event.id == self.event.id else Ticket(event_id=event.id, name="Entry", description="Entry", price=amount, currency="INR", quantity_total=100)
        if ticket is not self.ticket: self.db.add(ticket); self.db.flush()
        registration = Registration(event_id=event.id, participant_id=participant.id, ticket_id=ticket.id,
            status="confirmed", payment_status="approved", total_amount_paise=amount,
            platform_fee_paise=fee, platform_fee_bearer=bearer,
            participant_total_paise=amount + (fee if bearer == "PARTICIPANT" else 0))
        order = Order(total_amount=amount / 100, total_amount_paise=registration.participant_total_paise, currency="INR", status="paid")
        self.db.add_all([registration, order]); self.db.flush()
        payment = Payment(order_id=order.id, registration_id=registration.id, amount=amount / 100,
                          expected_amount_paise=registration.participant_total_paise, method=gateway,
                          currency="INR", payment_gateway=gateway, status="approved", paid_at=dt.datetime.now(dt.timezone.utc))
        self.db.add(payment); self.db.flush()
        if gateway == "cashfree":
            checkout = CheckoutPayment(event_order_id=order.id, mode="CASHFREE_PLATFORM", amount_paise=registration.participant_total_paise,
                fee_paise=fee, currency="INR", fee_funding="WITHHOLD", status="successful", provider_account="merchant",
                provider_environment="production", provider_order_id=str(order.id))
            self.db.add(checkout); self.db.flush()
            receipt = CheckoutReceipt(checkout_payment_id=checkout.id, provider="cashfree", account="merchant",
                environment="production", payment_id=str(payment.id), amount_paise=checkout.amount_paise, disposition="confirmed")
            self.db.add(receipt)
            self.db.flush()
            post_verified_collection(self.db, receipt_id=receipt.id)
        return registration

    def _settle(self, amount, key=None, status="PAID"):
        return create_settlement(self.db, event_id=self.event.id, actor_user_id=self.admin.id,
            amount_paise=amount, method="BANK_TRANSFER", reference_number=f"UTR-{key or amount}",
            settlement_date=dt.date(2026, 10, 7), status=status, notes=None,
            idempotency_key=key or str(uuid.uuid4()))

    def test_partial_settlements_and_new_registrations(self):
        self._payment(4_000_000)
        self.assertEqual(settlement_summary(self.db, event_id=self.event.id)["outstandingAmountPaise"], 4_000_000)
        self._settle(2_500_000)
        self.assertEqual(settlement_summary(self.db, event_id=self.event.id)["outstandingAmountPaise"], 1_500_000)
        self._payment(2_000_000)
        self.assertEqual(settlement_summary(self.db, event_id=self.event.id)["outstandingAmountPaise"], 3_500_000)
        self._settle(3_000_000)
        self.assertEqual(settlement_summary(self.db, event_id=self.event.id)["outstandingAmountPaise"], 500_000)
        self.assertEqual(len(list_settlements(self.db, event_id=self.event.id)), 2)

    def test_over_settlement_is_rejected(self):
        self._payment(4_000_000); self._settle(2_500_000); self._payment(2_000_000); self._settle(3_000_000)
        with self.assertRaises(SettlementValidationError): self._settle(600_000)

    def test_completed_cashfree_refund_reduces_payable(self):
        registration = self._payment(1_000_000, fee=40_000, bearer="ORGANIZER")
        self.db.add(Refund(registration_id=registration.id, event_id=self.event.id, participant_id=registration.participant_id,
            organizer_id=self.organization.id, payment_method="cashfree", payment_provider="CASHFREE",
            original_registration_amount=1_000_000, original_platform_fee=40_000, original_total_paid=1_000_000,
            requested_refund_amount=500_000, approved_refund_amount=500_000, platform_fee_refund_amount=0,
            refund_reason="Test", status="REFUNDED")); self.db.flush()
        summary = settlement_summary(self.db, event_id=self.event.id)
        self.assertEqual(summary["grossOrganizerPayablePaise"], 960_000)
        self.assertEqual(summary["refundsPaise"], 500_000)
        self.assertEqual(summary["outstandingAmountPaise"], 460_000)

    def test_duplicate_submission_is_idempotent_and_conflicts_are_rejected(self):
        self._payment(100_000)
        first = self._settle(50_000, "same-key")
        second = self._settle(50_000, "same-key")
        self.assertEqual(first.id, second.id)
        with self.assertRaises(SettlementValidationError): self._settle(40_000, "same-key")
        self.assertEqual(len(self.db.scalars(select(OrganizerSettlement)).all()), 1)

    def test_direct_upi_does_not_create_settlement_balance(self):
        event = self._event(self.organization, "Direct", "DIRECT_UPI")
        self._payment(100_000, event=event, gateway="manual_upi")
        self.assertEqual(settlement_summary(self.db, event_id=event.id)["outstandingAmountPaise"], 0)

    def test_events_and_organizers_are_isolated(self):
        other_org = Organization(name="Other", status="active"); self.db.add(other_org); self.db.flush()
        other_event = self._event(other_org, "Other event", "CASHFREE_MANAGED")
        self._payment(200_000, event=other_event)
        self._payment(100_000)
        self.assertEqual(settlement_summary(self.db, event_id=self.event.id)["grossOrganizerPayablePaise"], 100_000)
        self.assertEqual(settlement_summary(self.db, event_id=other_event.id)["grossOrganizerPayablePaise"], 200_000)

    def test_historical_fee_snapshot_is_used(self):
        self._payment(100_000, fee=4_000, bearer="ORGANIZER")
        self.organization.fee_value_paise = 99_999
        self.assertEqual(settlement_summary(self.db, event_id=self.event.id)["grossOrganizerPayablePaise"], 96_000)

    def test_participant_borne_fee_is_collected_but_not_deducted_from_organizer(self):
        self._payment(100_000, fee=4_000, bearer="PARTICIPANT")
        summary = settlement_summary(self.db, event_id=self.event.id)
        self.assertEqual(summary["grossCollectionsPaise"], 104_000)
        self.assertEqual(summary["grossOrganizerPayablePaise"], 100_000)

    def test_only_successful_managed_payments_are_counted(self):
        registration = self._payment(100_000, gateway="cashfree_managed")
        self._payment(200_000, gateway="manual_upi")
        summary = settlement_summary(self.db, event_id=self.event.id)
        self.assertEqual(summary["paidRegistrationCount"], 0)
        self.assertEqual(summary["grossCollectionsPaise"], 0)

    def test_adjustments_are_append_only_and_cannot_undercut_reserved_money(self):
        self._payment(100_000)
        self._settle(60_000, status="PENDING")
        create_adjustment(self.db, event_id=self.event.id, actor_user_id=self.admin.id, amount_paise=10_000, reason="Approved bonus", idempotency_key="bonus-key")
        self.assertEqual(settlement_summary(self.db, event_id=self.event.id)["organizerPayablePaise"], 110_000)
        create_adjustment(self.db, event_id=self.event.id, actor_user_id=self.admin.id, amount_paise=-60_000, reason="Agreed reduction", idempotency_key="reduce-key")
        self.assertEqual(settlement_summary(self.db, event_id=self.event.id)["reservationShortfallPaise"], 10_000)

    def test_pending_reserves_balance_and_can_be_edited_before_paid(self):
        self._payment(100_000)
        row = self._settle(70_000, "pending-key", status="PENDING")
        summary = settlement_summary(self.db, event_id=self.event.id)
        self.assertEqual(summary["outstandingAmountPaise"], 100_000)
        self.assertEqual(summary["availableToSettlePaise"], 30_000)
        update_pending_settlement(self.db, settlement_id=row.id, actor_user_id=self.admin.id,
            event_id=self.event.id, expected_version=1,
            amount_paise=60_000, method="UPI", reference_number="NEW-UTR",
            settlement_date=dt.date(2026, 10, 7), status="PAID", notes="Confirmed")
        self.assertEqual(settlement_summary(self.db, event_id=self.event.id)["outstandingAmountPaise"], 40_000)
        with self.assertRaises(SettlementValidationError):
            update_pending_settlement(self.db, settlement_id=row.id, actor_user_id=self.admin.id,
                event_id=self.event.id, expected_version=2,
                amount_paise=50_000, method="UPI", reference_number="X",
                settlement_date=dt.date(2026, 10, 8), status="PAID", notes=None)

    def _refund(self, registration, amount):
        self.db.add(Refund(registration_id=registration.id, event_id=self.event.id,
            participant_id=registration.participant_id, organizer_id=self.organization.id,
            payment_method="cashfree", payment_provider="CASHFREE", original_registration_amount=registration.total_amount_paise,
            original_platform_fee=registration.platform_fee_paise, original_total_paid=registration.participant_total_paise,
            requested_refund_amount=amount, approved_refund_amount=amount, platform_fee_refund_amount=0,
            refund_reason="Regression", status="REFUNDED"))
        self.db.flush()

    def _update(self, row, status, amount=None, event_id=None, version=None):
        return update_pending_settlement(self.db, settlement_id=row.id, actor_user_id=self.admin.id,
            event_id=event_id or self.event.id, expected_version=version or row.version,
            amount_paise=amount if amount is not None else row.amount_paise, method=row.method,
            reference_number=row.reference_number, settlement_date=row.settlement_date, status=status, notes=row.notes)

    def test_refund_blocks_reserved_overpayment_but_allows_cancellation(self):
        reg = self._payment(100_000)
        row = self._settle(80_000, status="PENDING")
        self._refund(reg, 90_000)
        with self.assertRaises(SettlementValidationError): self._update(row, "PAID")
        self._update(row, "CANCELLED")
        self.assertEqual(settlement_summary(self.db, event_id=self.event.id)["availableToSettlePaise"], 10_000)

    def test_refund_after_paid_exposes_recoverable_negative_balance(self):
        reg = self._payment(100_000); self._settle(80_000); self._refund(reg, 90_000)
        summary = settlement_summary(self.db, event_id=self.event.id)
        self.assertEqual(summary["outstandingAmountPaise"], -70_000)
        self.assertEqual(summary["recoverablePaise"], 70_000)
        with self.assertRaises(SettlementValidationError): self._settle(100)

    def test_adjustment_retry_is_idempotent(self):
        self._payment(100_000)
        kwargs = dict(event_id=self.event.id, actor_user_id=self.admin.id, amount_paise=10_000, reason="Approved correction", idempotency_key="retry-key")
        first = create_adjustment(self.db, **kwargs)
        self.assertEqual(first.id, create_adjustment(self.db, **kwargs).id)
        with self.assertRaises(SettlementValidationError): create_adjustment(self.db, **{**kwargs, "amount_paise": 20_000})
        self.assertEqual(settlement_summary(self.db, event_id=self.event.id)["adjustmentsPaise"], 10_000)

    def test_linked_reversal_changes_settled_not_payable_and_cannot_over_reverse(self):
        self._payment(100_000); row = self._settle(80_000)
        create_adjustment(self.db, event_id=self.event.id, actor_user_id=self.admin.id, amount_paise=20_000,
            reason="Bank returned transfer portion", idempotency_key="reverse-key", settlement_id=row.id)
        summary = settlement_summary(self.db, event_id=self.event.id)
        self.assertEqual(summary["settledAmountPaise"], 60_000)
        self.assertEqual(summary["organizerPayablePaise"], 100_000)
        self.assertEqual(row.amount_paise, 80_000)
        with self.assertRaises(SettlementValidationError):
            create_adjustment(self.db, event_id=self.event.id, actor_user_id=self.admin.id, amount_paise=70_000,
                reason="Too large", idempotency_key="reverse-again", settlement_id=row.id)

    def test_mode_change_keeps_history_and_balance(self):
        self._payment(100_000); self._settle(50_000)
        self.event.payment_collection_method = "DIRECT_UPI"; self.db.flush()
        self.assertEqual(settlement_summary(self.db, event_id=self.event.id)["outstandingAmountPaise"], 50_000)
        self.assertEqual(len(list_settlements(self.db, event_id=self.event.id)), 1)

    def test_registration_edits_do_not_change_collection_snapshots(self):
        reg = self._payment(100_000, fee=4_000)
        reg.total_amount_paise = 200_000; reg.participant_total_paise = 200_000; reg.platform_fee_paise = 8_000
        self.db.flush()
        self.assertEqual(settlement_summary(self.db, event_id=self.event.id)["grossOrganizerPayablePaise"], 96_000)

    def test_stale_or_wrong_event_edit_rejected(self):
        self._payment(100_000); row = self._settle(50_000, status="PENDING")
        self._update(row, "PENDING", amount=40_000)
        with self.assertRaises(SettlementValidationError): self._update(row, "PAID", version=1)
        other = self._event(self.organization, "Other", "CASHFREE_MANAGED")
        with self.assertRaises(SettlementValidationError): self._update(row, "PAID", event_id=other.id)

    def test_duplicate_bank_reference_rejected_with_new_key(self):
        self._payment(100_000); self._settle(20_000)
        with self.assertRaises(SettlementValidationError): self._settle(20_000)

    def test_creation_retry_survives_later_pending_edit(self):
        self._payment(100_000); row = self._settle(20_000, "original-key", status="PENDING")
        self._update(row, "PAID")
        self.assertEqual(self._settle(20_000, "original-key", status="PENDING").id, row.id)

    def test_managed_payment_deletion_is_blocked(self):
        from fastapi import HTTPException
        from app.services.event_archive_service import delete_archived_event
        self._payment(100_000)
        with self.assertRaises(HTTPException): delete_archived_event(self.db, self.event, self.admin.id)
        self.assertEqual(settlement_summary(self.db, event_id=self.event.id)["grossCollectionsPaise"], 100_000)

    def test_unverified_gateway_status_does_not_create_payable(self):
        self._payment(100_000, gateway="cashfree_managed")
        self.assertEqual(settlement_summary(self.db, event_id=self.event.id)["outstandingAmountPaise"], 0)
        with self.assertRaises(SettlementValidationError): self._settle(100)

    def test_receipt_posting_excludes_sandbox_and_rejects_amount_mismatch(self):
        registration=self._payment(100_000,gateway="cashfree_managed")
        payment=self.db.scalar(select(Payment).where(Payment.registration_id==registration.id))
        checkout=CheckoutPayment(event_order_id=payment.order_id,mode="CASHFREE_PLATFORM",amount_paise=100_000,
            fee_paise=0,currency="INR",fee_funding="WITHHOLD",status="successful",provider_account="merchant",
            provider_environment="sandbox",provider_order_id="sandbox-order")
        self.db.add(checkout);self.db.flush()
        receipt=CheckoutReceipt(checkout_payment_id=checkout.id,provider="cashfree",account="merchant",
            environment="sandbox",payment_id="sandbox-payment",amount_paise=100_000,disposition="confirmed")
        self.db.add(receipt);self.db.flush()
        post_verified_collection(self.db,receipt_id=receipt.id)
        self.assertEqual(settlement_summary(self.db,event_id=self.event.id)["grossCollectionsPaise"],0)
        receipt.environment="production";checkout.provider_environment="production";receipt.amount_paise=200_000;self.db.flush()
        with self.assertRaises(SettlementValidationError):post_verified_collection(self.db,receipt_id=receipt.id)

    def test_split_receipts_do_not_enter_manual_settlement_balance(self):
        registration=self._payment(100_000,gateway="cashfree_managed")
        payment=self.db.scalar(select(Payment).where(Payment.registration_id==registration.id))
        checkout=CheckoutPayment(event_order_id=payment.order_id,mode="CASHFREE_SPLIT",amount_paise=100_000,
            fee_paise=0,currency="INR",fee_funding="WITHHOLD",status="successful",provider_account="merchant",
            provider_environment="production",provider_order_id="split-order")
        self.db.add(checkout);self.db.flush()
        receipt=CheckoutReceipt(checkout_payment_id=checkout.id,provider="cashfree",account="merchant",
            environment="production",payment_id="split-payment",amount_paise=100_000,disposition="confirmed")
        self.db.add(receipt);self.db.flush();post_verified_collection(self.db,receipt_id=receipt.id)
        self.assertEqual(settlement_summary(self.db,event_id=self.event.id)["grossCollectionsPaise"],0)


if __name__ == "__main__":
    unittest.main()
