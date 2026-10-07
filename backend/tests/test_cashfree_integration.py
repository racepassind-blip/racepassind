"""Cashfree evidence must confirm the registration and (production) ledger atomically."""
import base64
import asyncio
import hashlib
import hmac
import json
import unittest
from unittest.mock import Mock, patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.services.auth_service import hash_opaque_token
from app.services.cashfree_gateway import CashfreeGateway, ProviderUnavailable
from app.services.cashfree_registration_service import reconcile_order, start_checkout
from app.services.checkout_payments import PaymentMode, PaymentPlan, bind_provider_order, ensure_payment
from db import Base
from models import CheckoutReceipt, Event, ManagedRegistrationCollection, Order, OrderItem, Organization, Participant, Payment, Refund, Registration, Ticket
from app.services.cashfree_refunds import reconcile_cashfree_refund
from app.services.organizer_settlement_service import settlement_summary


class FakeCashfree:
    account = "merchant"
    secret = "test-secret"
    environment = "production"
    refund_status = "PENDING"
    refund_created = False

    def verify_webhook(self, raw_body, timestamp, signature):
        return CashfreeGateway.verify_webhook(self, raw_body, timestamp, signature)

    def verify_payment(self, payment, *, expected_payment_id=None):
        from app.services.checkout_payments import VerifiedReceipt
        if expected_payment_id and expected_payment_id != "cf-payment-1":
            raise ProviderUnavailable("No verified successful Cashfree payment found")
        return VerifiedReceipt("cashfree", self.account, self.environment, "cf-payment-1",
                               payment.id, payment.amount_paise, "INR", payment.provider_order_id)

    def get_refund(self, order_id, refund_id, *, missing_ok=False):
        if not self.refund_created:
            return None
        return dict(order_id=order_id, refund_id=refund_id, refund_amount=50,
                    refund_currency="INR", refund_status=self.refund_status)

    def create_refund(self, order_id, refund_id, amount, *, idempotency_key):
        self.refund_created = True
        return self.get_refund(order_id, refund_id)


class CashfreeIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        organization = Organization(name="Organizer", status="active")
        self.db.add(organization); self.db.flush()
        event = Event(organization_id=organization.id, name="Race", description="Test", category="running",
                      max_participants=100, status="published", distance="5k", rules=[], payment_collection_method="CASHFREE_MANAGED")
        self.db.add(event); self.db.flush()
        ticket = Ticket(event_id=event.id, name="Entry", description="Entry", price=10000,
                        currency="INR", quantity_total=10, quantity_reserved=1)
        participant = Participant(name="Runner", phone="9876543210", normalized_phone="9876543210")
        self.db.add_all([ticket, participant]); self.db.flush()
        registration = Registration(event_id=event.id, participant_id=participant.id, ticket_id=ticket.id,
            status="awaiting_payment", payment_status="pending", quantity=1, participant_count=1,
            total_amount_paise=10000, platform_fee_paise=1000, participant_total_paise=10000,
            platform_fee_bearer="ORGANIZER", confirmation_token_hash=hash_opaque_token("test-confirmation-token"))
        order = Order(total_amount=100, total_amount_paise=10000, currency="INR", status="pending")
        self.db.add_all([registration, order]); self.db.flush()
        self.db.add(OrderItem(order_id=order.id, registration_id=registration.id, price=100))
        self.db.add(Payment(order_id=order.id, registration_id=registration.id, amount=100,
                            expected_amount_paise=10000, method="cashfree", currency="INR",
                            payment_gateway="cashfree", status="pending"))
        checkout = ensure_payment(self.db, plan=PaymentPlan(PaymentMode.CASHFREE_PLATFORM, 10000, 1000), event_order_id=order.id)
        bind_provider_order(checkout, account="merchant", environment="production", provider_order_id=f"sp_{checkout.id.hex}")
        self.db.commit()
        self.event, self.ticket, self.registration, self.order, self.checkout = event, ticket, registration, order, checkout

    def tearDown(self):
        self.db.close(); self.engine.dispose()

    def test_production_success_confirms_once_and_posts_ledger(self):
        with patch("app.services.cashfree_registration_service.CashfreeGateway", return_value=FakeCashfree()):
            self.assertEqual(reconcile_order(self.db, provider_order_id=self.checkout.provider_order_id), "confirmed")
            self.assertEqual(reconcile_order(self.db, provider_order_id=self.checkout.provider_order_id), "confirmed")
        self.assertEqual(self.registration.status, "confirmed")
        self.assertEqual(self.registration.payment_status, "approved")
        self.assertEqual(self.order.status, "paid")
        self.assertEqual(self.ticket.quantity_sold, 1)
        self.assertEqual(self.ticket.quantity_reserved, 0)
        self.assertEqual(self.db.scalar(select(ManagedRegistrationCollection)).organizer_payable_paise, 9000)
        self.assertEqual(len(self.db.scalars(select(CheckoutReceipt)).all()), 1)

    def test_unknown_payment_does_not_finalize(self):
        with patch("app.services.cashfree_registration_service.CashfreeGateway", return_value=FakeCashfree()):
            with self.assertRaises(ProviderUnavailable):
                reconcile_order(self.db, provider_order_id=self.checkout.provider_order_id, expected_payment_id="other")
        self.assertEqual(self.registration.status, "awaiting_payment")
        self.assertIsNone(self.db.scalar(select(ManagedRegistrationCollection)))

    def test_webhook_signature_uses_raw_body(self):
        gateway = object.__new__(CashfreeGateway)
        gateway.secret = "test-secret"
        raw = b'{"type":"PAYMENT_SUCCESS_WEBHOOK"}'
        timestamp = "1760000000"
        signature = base64.b64encode(hmac.new(b"test-secret", timestamp.encode() + raw, hashlib.sha256).digest()).decode()
        gateway.verify_webhook(raw, timestamp, signature)
        with self.assertRaises(ProviderUnavailable):
            gateway.verify_webhook(raw + b" ", timestamp, signature)

    def test_order_timeout_recovery_binds_existing_cashfree_order(self):
        self.checkout.provider_account = None
        self.checkout.provider_environment = None
        self.checkout.provider_order_id = None
        self.db.commit()
        gateway = Mock(account="merchant", environment="production")
        gateway.recover_session.return_value = {
            "orderId": f"sp_{self.checkout.id.hex}", "paymentSessionId": "sandbox-session", "environment": "production"}
        with patch("app.services.cashfree_registration_service.CashfreeGateway", return_value=gateway):
            result = start_checkout(self.db, token="test-confirmation-token", return_url="https://example.test/return")
        self.assertEqual(result["paymentSessionId"], "sandbox-session")
        self.assertEqual(self.checkout.provider_order_id, f"sp_{self.checkout.id.hex}")
        gateway.create_session.assert_not_called()

    def test_checkout_converts_stored_country_code_to_cashfree_phone(self):
        self.checkout.provider_account = None
        self.checkout.provider_environment = None
        self.checkout.provider_order_id = None
        self.registration.participant.phone = "+91 98765 43210"
        self.registration.participant.normalized_phone = "919876543210"
        self.db.commit()
        gateway = Mock(account="merchant", environment="sandbox")
        gateway.recover_session.return_value = None
        gateway.create_session.return_value = {
            "orderId": f"sp_{self.checkout.id.hex}", "paymentSessionId": "sandbox-session", "environment": "sandbox"}
        with patch("app.services.cashfree_registration_service.CashfreeGateway", return_value=gateway):
            start_checkout(self.db, token="test-confirmation-token", return_url="https://example.test/return")
        self.assertEqual(gateway.create_session.call_args.kwargs["phone"], "9876543210")

    def test_refund_only_reduces_ledger_after_provider_success(self):
        fake = FakeCashfree()
        with patch("app.services.cashfree_registration_service.CashfreeGateway", return_value=fake):
            reconcile_order(self.db, provider_order_id=self.checkout.provider_order_id)
        refund = Refund(registration_id=self.registration.id, event_id=self.event.id,
            participant_id=self.registration.participant_id, organizer_id=self.event.organization_id,
            payment_method="cashfree", payment_provider="CASHFREE",
            original_registration_amount=10000, original_platform_fee=1000, original_total_paid=10000,
            requested_refund_amount=5000, approved_refund_amount=5000, platform_fee_refund_amount=0,
            refund_reason="Cannot attend", status="APPROVED")
        self.db.add(refund); self.db.commit()
        with patch("app.services.cashfree_refunds.CashfreeGateway", return_value=fake):
            self.assertEqual(reconcile_cashfree_refund(self.db, refund_id=refund.id, initiate=True), "PENDING")
            self.assertEqual(settlement_summary(self.db, event_id=self.event.id)["outstandingAmountPaise"], 9000)
            fake.refund_status = "SUCCESS"
            self.assertEqual(reconcile_cashfree_refund(self.db, refund_id=refund.id, initiate=False), "SUCCESS")
            self.assertEqual(reconcile_cashfree_refund(self.db, refund_id=refund.id, initiate=False), "SUCCESS")
        self.assertEqual(settlement_summary(self.db, event_id=self.event.id)["outstandingAmountPaise"], 4000)

    def test_signed_webhook_reconciles_and_replay_is_idempotent(self):
        from app.api.v1.cashfree import cashfree_webhook
        from fastapi import HTTPException
        raw = json.dumps({"type": "PAYMENT_SUCCESS_WEBHOOK", "data": {
            "order": {"order_id": self.checkout.provider_order_id},
            "payment": {"cf_payment_id": "cf-payment-1", "payment_status": "SUCCESS"},
        }}, separators=(",", ":")).encode()
        timestamp = "1760000000"
        signature = base64.b64encode(hmac.new(b"test-secret", timestamp.encode() + raw, hashlib.sha256).digest()).decode()

        class Request:
            headers = {"x-webhook-timestamp": timestamp, "x-webhook-signature": signature}
            async def body(self):
                return raw

        fake = FakeCashfree()
        with patch("app.api.v1.cashfree.CashfreeGateway", return_value=fake), patch(
                "app.services.cashfree_registration_service.CashfreeGateway", return_value=fake):
            self.assertEqual(asyncio.run(cashfree_webhook(Request(), self.db))["disposition"], "confirmed")
            self.assertEqual(asyncio.run(cashfree_webhook(Request(), self.db))["disposition"], "confirmed")
            request = Request()
            request.headers = {**request.headers, "x-webhook-signature": "invalid"}
            with self.assertRaises(HTTPException):
                asyncio.run(cashfree_webhook(request, self.db))
        self.assertEqual(len(self.db.scalars(select(ManagedRegistrationCollection)).all()), 1)
