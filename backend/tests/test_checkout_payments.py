import unittest
from dataclasses import replace
from unittest.mock import Mock
from uuid import uuid4

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from db import Base
from models import Order, CheckoutPayment, CheckoutReceipt
from app.services.checkout_payments import (
    PaymentMode, PaymentPlan, VerifiedReceipt, ProviderUnavailable,
    ensure_payment, gateway_provider, reconcile_gateway_success, rupees, fingerprint, bind_provider_order,
)


class CheckoutPaymentTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.order = Order(total_amount=100, total_amount_paise=10000, currency="INR", status="pending")
        self.db.add(self.order)
        self.db.flush()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def payment(self, mode=PaymentMode.CASHFREE_PLATFORM):
        payment = ensure_payment(self.db, plan=PaymentPlan(mode, 10000, 500,
            vendor_id="vendor_1" if mode == PaymentMode.CASHFREE_SPLIT else None,
            vendor_ready=mode == PaymentMode.CASHFREE_SPLIT), event_order_id=self.order.id)
        if mode in {PaymentMode.CASHFREE_PLATFORM, PaymentMode.CASHFREE_SPLIT}:
            bind_provider_order(payment, account="merchant", environment="sandbox", provider_order_id="cf_order_1")
            self.db.flush()
        return payment

    def receipt(self, payment):
        return VerifiedReceipt("cashfree", "merchant", "sandbox", "payment_1", payment.id, 10000, "INR", "cf_order_1")

    def reconcile(self, payment, receipt=None, finalize=None):
        provider = Mock()
        provider.verify_payment.return_value = receipt or self.receipt(payment)
        return reconcile_gateway_success(self.db, payment, provider=provider, account="merchant",
            environment="sandbox", lock_owner=Mock(), finalize=finalize or Mock(return_value=True))

    def test_cashfree_modes_are_disabled_without_credentials(self):
        for mode in [PaymentMode.CASHFREE_PLATFORM, PaymentMode.CASHFREE_SPLIT]:
            with self.assertRaises(ProviderUnavailable):
                gateway_provider(mode).create_session(None)
            with self.assertRaises(ProviderUnavailable):
                gateway_provider(mode).verify_payment(None)

    def test_money_and_fee_policy(self):
        self.assertEqual(rupees(101), "1.01")
        for amount in [-1, 1.5, True]:
            with self.assertRaises(ValueError):
                rupees(amount)
        with self.assertRaises(ValueError):
            PaymentPlan(PaymentMode.DIRECT_UPI, 100, 101)
        self.assertEqual(PaymentPlan(PaymentMode.DIRECT_UPI, 100, 5).fee_funding, "CREDITS")
        self.assertEqual(PaymentPlan(PaymentMode.CASHFREE_PLATFORM, 100, 5).fee_funding, "WITHHOLD")
        self.assertEqual(PaymentPlan(PaymentMode.DIRECT_UPI, 0, 0).fee_funding, "WAIVED")

    def test_split_requires_verified_mapping(self):
        with self.assertRaises(ValueError):
            PaymentPlan(PaymentMode.CASHFREE_SPLIT, 100, 5, vendor_id="v")
        plan = PaymentPlan(PaymentMode.CASHFREE_SPLIT, 100, 5, "v", True)
        self.assertEqual(plan.organizer_share_paise, 95)

    def test_immutable_plan_and_idempotency(self):
        payment = self.payment()
        self.assertEqual(self.payment().id, payment.id)
        with self.assertRaises(ValueError):
            ensure_payment(self.db, plan=PaymentPlan(PaymentMode.DIRECT_UPI, 10000, 500), event_order_id=self.order.id)
        payment.request_fingerprint = fingerprint({"quantity": 1})
        with self.assertRaises(ValueError):
            ensure_payment(self.db, plan=PaymentPlan(PaymentMode.CASHFREE_PLATFORM, 10000, 500),
                event_order_id=self.order.id, request_fingerprint=fingerprint({"quantity": 2}))

    def test_duplicate_delivery_and_second_payment_finalize_once(self):
        payment = self.payment()
        finalize = Mock(return_value=True)
        self.assertEqual(self.reconcile(payment, finalize=finalize), "confirmed")
        self.assertEqual(self.reconcile(payment, finalize=finalize), "confirmed")
        self.assertEqual(self.reconcile(payment, replace(self.receipt(payment), payment_id="payment_2"), finalize), "duplicate_payment")
        self.assertEqual(finalize.call_count, 1)
        self.assertEqual(len(self.db.scalars(select(CheckoutReceipt)).all()), 2)

    def test_invalid_evidence_cannot_confirm(self):
        payment = self.payment()
        finalize = Mock(return_value=True)
        for change in [{"amount_paise": 9999}, {"currency": "USD"}, {"account": "other"},
                       {"environment": "production"}, {"provider_order_id": "wrong"}, {"checkout_payment_id": uuid4()}, {"provider": "fake"}]:
            with self.assertRaises(ValueError):
                self.reconcile(payment, replace(self.receipt(payment), **change), finalize)
        finalize.assert_not_called()
        self.assertEqual(payment.status, "awaiting")

    def test_late_payment_rolls_back_fulfillment_but_records_money(self):
        payment = self.payment()
        def late():
            self.order.status = "paid"
            self.db.flush()
            return False
        self.assertEqual(self.reconcile(payment, finalize=late), "paid_needs_review")
        self.assertEqual(self.order.status, "pending")
        self.assertEqual(payment.status, "paid_needs_review")
        self.assertEqual(payment.settlement_status, "pending")

    def test_fulfillment_error_is_retryable_without_partial_effects(self):
        payment = self.payment()
        def broken():
            self.order.status = "paid"
            self.db.flush()
            raise RuntimeError("stock failure")
        with self.assertRaises(RuntimeError):
            self.reconcile(payment, finalize=broken)
        self.assertEqual(self.order.status, "pending")
        self.assertIsNone(self.db.scalar(select(CheckoutReceipt)))
        self.assertEqual(self.reconcile(payment), "confirmed")

    def test_split_success_does_not_claim_settlement(self):
        payment = self.payment(PaymentMode.CASHFREE_SPLIT)
        self.reconcile(payment)
        self.assertEqual(payment.status, "successful")
        self.assertEqual(payment.settlement_status, "pending")
        self.assertEqual(payment.fee_funding, "WITHHOLD")

    def test_manual_mode_rejects_gateway_receipts(self):
        with self.assertRaises(ValueError):
            self.reconcile(self.payment(PaymentMode.DIRECT_UPI))
