"""Cashfree evidence must confirm the registration and (production) ledger atomically."""
import base64
import asyncio
import hashlib
import hmac
import json
import datetime as dt
import unittest
from unittest.mock import Mock, patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.services.auth_service import hash_opaque_token
from app.services.cashfree_gateway import CashfreeGateway, ProviderUnavailable
from app.services.cashfree_registration_service import reconcile_order, start_checkout
from app.services.checkout_payments import PaymentMode, PaymentPlan, bind_provider_order, ensure_payment
from db import Base
from models import CheckoutReceipt, EmailLog, Event, ManagedRegistrationCollection, Order, OrderItem, Organization, Participant, Payment, Refund, Registration, Ticket, User
from app.services.cashfree_refunds import reconcile_cashfree_refund
from app.services.refund_service import list_refunds_for_admin, list_refunds_for_organizer, review_refund
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
        self._seed()

    def _seed(self):
        self.admin = User(name="Admin", email="admin@example.test", password_hash="test", role="admin")
        self.db.add(self.admin)
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

    def test_success_queues_one_confirmation_despite_duplicate_callback(self):
        from models import EmailLog
        self.registration.participant.email = "runner@example.test"
        self.db.commit()
        with patch("app.services.cashfree_registration_service.CashfreeGateway", return_value=FakeCashfree()), patch("app.services.email_service.check_email_capacity", return_value=(False, 480, None)):
            reconcile_order(self.db, provider_order_id=self.checkout.provider_order_id)
            reconcile_order(self.db, provider_order_id=self.checkout.provider_order_id)
        logs = self.db.scalars(select(EmailLog).where(EmailLog.reference_id == str(self.order.id))).all()
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0].status, "pending_limit")
        self.assertEqual(self.registration.email_status, "PENDING_LIMIT")

    def test_verified_payment_without_stock_alerts_customer_and_admin_once(self):
        self.registration.participant.email = "runner@example.test"
        # The provider took payment after the reservation was unexpectedly lost.
        self.ticket.quantity_reserved = 0
        self.db.commit()
        with patch("app.services.cashfree_registration_service.CashfreeGateway", return_value=FakeCashfree()):
            self.assertEqual(reconcile_order(self.db, provider_order_id=self.checkout.provider_order_id), "paid_needs_review")
            self.assertEqual(reconcile_order(self.db, provider_order_id=self.checkout.provider_order_id), "paid_needs_review")
        self.assertEqual(self.registration.status, "awaiting_payment")
        self.assertEqual(self.checkout.status, "paid_needs_review")
        self.assertIsNone(self.db.scalar(select(ManagedRegistrationCollection)))
        logs = self.db.scalars(select(EmailLog).where(EmailLog.reference_id == str(self.order.id))).all()
        self.assertEqual({(log.recipient, log.reference_type) for log in logs}, {
            ("runner@example.test", "CASHFREE_PAYMENT_REVIEW_PARTICIPANT"),
            ("admin@example.test", "CASHFREE_PAYMENT_REVIEW_ADMIN"),
        })
        self.assertTrue(all(log.status == "pending_limit" for log in logs))

    def test_provider_expiry_releases_reservation_only_once(self):
        from app.services.cashfree_registration_service import expire_cashfree_order
        gateway = Mock(account="merchant", environment="production", payment_state=Mock(return_value="expired"))
        with patch("app.services.cashfree_registration_service.CashfreeGateway", return_value=gateway):
            self.assertTrue(expire_cashfree_order(self.db, self.checkout.id))
            self.assertFalse(expire_cashfree_order(self.db, self.checkout.id))
        self.assertEqual(self.ticket.quantity_reserved, 0)
        self.assertEqual(self.ticket.quantity_sold, 0)
        self.assertEqual(self.checkout.status, "expired")

    def test_pending_payment_does_not_release_stock(self):
        from app.services.cashfree_registration_service import expire_cashfree_order
        with patch("app.services.cashfree_registration_service.CashfreeGateway", return_value=Mock(account="merchant", environment="production", payment_state=Mock(return_value="pending"))):
            self.assertFalse(expire_cashfree_order(self.db, self.checkout.id))
        self.assertEqual(self.ticket.quantity_reserved, 1)
        self.assertEqual(self.registration.status, "awaiting_payment")

    def test_abandoned_checkout_without_provider_order_expires_after_grace(self):
        import datetime as dt
        from app.services.cashfree_registration_service import expire_cashfree_order
        from app.services.auth_service import utc_now
        self.checkout.provider_order_id = None
        self.checkout.provider_account = None
        self.checkout.provider_environment = None
        self.checkout.created_at = utc_now() - dt.timedelta(minutes=31)
        self.db.commit()
        gateway = Mock(account="merchant", environment="production")
        gateway.recover_session.return_value = None
        with patch("app.services.cashfree_registration_service.CashfreeGateway", return_value=gateway):
            self.assertTrue(expire_cashfree_order(self.db, self.checkout.id))
        self.assertEqual(self.ticket.quantity_reserved, 0)

    def test_expiry_provider_outage_never_releases_stock(self):
        from app.services.cashfree_registration_service import expire_cashfree_order
        gateway = Mock(account="merchant", environment="production")
        gateway.recover_session.side_effect = ProviderUnavailable("Unavailable")
        with patch("app.services.cashfree_registration_service.CashfreeGateway", return_value=gateway):
            with self.assertRaises(ProviderUnavailable):
                expire_cashfree_order(self.db, self.checkout.id)
        self.assertEqual(self.ticket.quantity_reserved, 1)

    def test_recovery_confirms_without_browser_and_does_not_send_inline(self):
        from sqlalchemy.orm import sessionmaker
        from app.services.cashfree_recovery import recover_once
        from models import EmailLog
        self.registration.participant.email = "runner@example.test"
        self.db.commit()
        gateway = FakeCashfree()
        gateway.payment_state = Mock(return_value="successful")
        gateway.recover_session = Mock(return_value={"paymentSessionId": "session"})
        with patch("app.services.cashfree_recovery.CashfreeGateway", return_value=gateway), patch("app.services.cashfree_registration_service.CashfreeGateway", return_value=gateway), patch("app.services.cashfree_recovery._deliver_existing_log") as deliver:
            recover_once(sessionmaker(bind=self.engine))
            deliver.assert_not_called()
        self.db.expire_all()
        self.assertEqual(self.registration.status, "confirmed")
        self.assertEqual(len(self.db.scalars(select(EmailLog)).all()), 1)

    def test_booking_content_filters_other_recipients(self):
        from app.services.registration_email_content import cashfree_booking_registrations
        self.registration.participant.email = "runner@example.test"
        self.db.commit()
        self.assertEqual(cashfree_booking_registrations(self.db, self.order.id, "RUNNER@example.test"), [self.registration])
        self.assertEqual(cashfree_booking_registrations(self.db, self.order.id, "other@example.test"), [])

    def test_cashfree_queue_does_not_consume_delivery_quota(self):
        from models import EmailLog
        from app.services.email_service import get_email_limit_status
        self.db.add(EmailLog(recipient="runner@example.test", subject="Ticket", email_type="REGISTRATION_CONFIRMATION", status="pending_limit"))
        self.db.commit()
        self.assertEqual(get_email_limit_status(self.db)[1], 0)

    def test_grouped_delivery_recovers_once_after_duplicate_sweeps(self):
        from sqlalchemy.orm import sessionmaker
        from app.services.cashfree_recovery import recover_once
        from models import EmailLog
        from app.services.email_service import SendEmailResult
        self.registration.participant.email = "runner@example.test"
        self.db.commit()
        gateway = FakeCashfree()
        with patch("app.services.cashfree_registration_service.CashfreeGateway", return_value=gateway):
            reconcile_order(self.db, provider_order_id=self.checkout.provider_order_id)
        def delivered(db, log):
            log.status = "sent"
            db.commit()
            return SendEmailResult(True, "SENT", "Sent", log)
        with patch("app.services.cashfree_recovery.CashfreeGateway", return_value=gateway), patch("app.services.cashfree_recovery.check_email_capacity", return_value=(True, 0, None)), patch("app.services.cashfree_recovery._deliver_existing_log", side_effect=delivered) as send:
            recover_once(sessionmaker(bind=self.engine))
            recover_once(sessionmaker(bind=self.engine))
            self.assertEqual(send.call_count, 1)
        self.db.expire_all()
        self.assertEqual(self.registration.email_status, "SENT")
        self.assertEqual(self.db.scalar(select(EmailLog)).status, "sent")

    def test_multiple_paid_entries_queue_one_booking_email(self):
        from models import EmailLog
        self.registration.participant.email = "runner@example.test"
        second = Registration(event_id=self.event.id, participant_id=self.registration.participant_id,
            ticket_id=self.ticket.id, status="awaiting_payment", payment_status="pending",
            quantity=1, participant_count=1, total_amount_paise=10000, platform_fee_paise=1000,
            participant_total_paise=10000, platform_fee_bearer="ORGANIZER",
            confirmation_token_hash=hash_opaque_token("second-confirmation-token"))
        self.db.add(second)
        self.db.flush()
        self.db.add(OrderItem(order_id=self.order.id, registration_id=second.id, price=100))
        self.db.add(Payment(order_id=self.order.id, registration_id=second.id, amount=100,
            expected_amount_paise=10000, method="cashfree", currency="INR", payment_gateway="cashfree", status="pending"))
        self.ticket.quantity_reserved = 2
        self.order.total_amount = 200
        self.order.total_amount_paise = 20000
        self.checkout.amount_paise = 20000
        self.checkout.fee_paise = 2000
        self.db.commit()
        with patch("app.services.cashfree_registration_service.CashfreeGateway", return_value=FakeCashfree()):
            reconcile_order(self.db, provider_order_id=self.checkout.provider_order_id)
        self.assertEqual(self.ticket.quantity_sold, 2)
        self.assertEqual(second.status, "confirmed")
        logs = self.db.scalars(select(EmailLog)).all()
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0].reference_type, "CASHFREE_BOOKING")

    def test_webhook_signature_uses_raw_body(self):
        gateway = object.__new__(CashfreeGateway)
        gateway.secret = "test-secret"
        raw = b'{"type":"PAYMENT_SUCCESS_WEBHOOK"}'
        timestamp = "1760000000"
        signature = base64.b64encode(hmac.new(b"test-secret", timestamp.encode() + raw, hashlib.sha256).digest()).decode()
        gateway.verify_webhook(raw, timestamp, signature)
        with self.assertRaises(ProviderUnavailable):
            gateway.verify_webhook(raw + b" ", timestamp, signature)

    def test_payment_state_distinguishes_pending_failed_and_user_dropped(self):
        gateway = object.__new__(CashfreeGateway)
        gateway.environment = "production"
        gateway.account = "merchant"
        gateway._request = Mock()
        base = {"order_id": self.checkout.provider_order_id, "payment_currency": "INR", "payment_amount": 100}
        for provider_status, expected in (("PENDING", "pending"), ("FAILED", "failed"), ("USER_DROPPED", "user_dropped")):
            gateway._request.side_effect = lambda method, path: ([{**base, "payment_status": provider_status, "payment_time": "2026-10-08T10:00:00+05:30"}] if path.endswith("/payments") else {"order_id": self.checkout.provider_order_id, "order_currency": "INR", "order_amount": 100, "order_status": "ACTIVE"})
            self.assertEqual(gateway.payment_state(self.checkout), expected)
        gateway._request.side_effect = None
        gateway._request.return_value = [
            {**base, "payment_status": "FAILED", "payment_time": "2026-10-08T10:00:00+05:30"},
            {**base, "payment_status": "SUCCESS", "payment_time": "2026-10-08T10:01:00+05:30", "cf_payment_id": "paid"},
        ]
        self.assertEqual(gateway.payment_state(self.checkout), "successful")

    def test_order_timeout_recovery_binds_existing_cashfree_order(self):
        self.checkout.provider_account = None
        self.checkout.provider_environment = None
        self.checkout.provider_order_id = None
        self.db.commit()
        gateway = Mock(account="merchant", environment="production")
        gateway.payment_state.return_value = "not_attempted"
        gateway.recover_session.return_value = {
            "orderId": f"sp_{self.checkout.id.hex}", "paymentSessionId": "sandbox-session", "environment": "production"}
        with patch("app.services.cashfree_registration_service.CashfreeGateway", return_value=gateway):
            result = start_checkout(self.db, token="test-confirmation-token", return_url="https://example.test/return")
        self.assertEqual(result["paymentSessionId"], "sandbox-session")
        self.assertEqual(self.checkout.provider_order_id, f"sp_{self.checkout.id.hex}")
        gateway.create_session.assert_not_called()

    def test_pending_provider_attempt_cannot_reopen_session(self):
        gateway = Mock(account="merchant", environment="production")
        gateway.payment_state.return_value = "pending"
        with patch("app.services.cashfree_registration_service.CashfreeGateway", return_value=gateway):
            result = start_checkout(self.db, token="test-confirmation-token", return_url="https://example.test/return")
        self.assertEqual(result, {"status": "pending"})
        gateway.recover_session.assert_called_once_with(self.checkout, missing_ok=True)
        gateway.create_session.assert_not_called()

    def test_review_payment_cannot_reopen_session(self):
        self.checkout.status = "paid_needs_review"
        self.db.commit()
        gateway = Mock(account="merchant", environment="production")
        with patch("app.services.cashfree_registration_service.CashfreeGateway", return_value=gateway):
            result = start_checkout(self.db, token="test-confirmation-token", return_url="https://example.test/return")
        self.assertEqual(result, {"status": "paid_needs_review"})
        gateway.recover_session.assert_not_called()

    def test_unknown_provider_state_blocks_retry_and_account_mismatch_rejected(self):
        gateway = object.__new__(CashfreeGateway)
        gateway.account, gateway.environment = "merchant", "production"
        gateway._request = Mock(return_value=[{"payment_status": "NEW_UNKNOWN_STATE"}])
        self.assertEqual(gateway.payment_state(self.checkout), "verification_pending")
        gateway.account = "other-merchant"
        with self.assertRaises(ProviderUnavailable):
            gateway.payment_state(self.checkout)

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

    def test_create_timeout_preserves_provider_binding_for_recovery(self):
        self.checkout.provider_order_id = None
        self.checkout.provider_account = None
        self.checkout.provider_environment = None
        self.db.commit()
        gateway = Mock(account="merchant", environment="production")
        gateway.recover_session.return_value = None
        gateway.create_session.side_effect = ProviderUnavailable("Timeout")
        with patch("app.services.cashfree_registration_service.CashfreeGateway", return_value=gateway):
            with self.assertRaises(ProviderUnavailable):
                start_checkout(self.db, token="test-confirmation-token", return_url="https://example.test/return")
        self.db.rollback()
        self.db.refresh(self.checkout)
        self.assertEqual(self.checkout.provider_order_id, f"sp_{self.checkout.id.hex}")
        self.assertEqual(self.checkout.provider_account, "merchant")

    def test_organizer_cannot_approve_unprocessable_cashfree_refund(self):
        refund = Refund(registration_id=self.registration.id, event_id=self.event.id,
            participant_id=self.registration.participant_id, organizer_id=self.event.organization_id,
            payment_method="cashfree", payment_provider="CASHFREE",
            original_registration_amount=10000, original_platform_fee=1000, original_total_paid=10000,
            requested_refund_amount=5000, platform_fee_refund_amount=1000,
            refund_reason="Cannot attend", status="REQUESTED")
        self.db.add(refund); self.db.commit()
        for amount in (0, 999):
            with self.assertRaises(ValueError):
                review_refund(self.db, refund_id=refund.id, reviewer_user_id=self.registration.participant_id,
                    decision="approve", approved_amount_paise=amount, organizer_comments=None)
            self.db.rollback()
        self.db.refresh(refund)
        self.assertEqual(refund.status, "REQUESTED")

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
            self.assertEqual(reconcile_cashfree_refund(self.db, refund_id=refund.id, initiate=True, actor_user_id=self.admin.id), "PENDING")
            self.assertEqual(settlement_summary(self.db, event_id=self.event.id)["outstandingAmountPaise"], 9000)
            fake.refund_status = "SUCCESS"
            self.assertEqual(reconcile_cashfree_refund(self.db, refund_id=refund.id, initiate=False), "SUCCESS")
            self.assertEqual(reconcile_cashfree_refund(self.db, refund_id=refund.id, initiate=False), "SUCCESS")
        self.assertEqual(settlement_summary(self.db, event_id=self.event.id)["outstandingAmountPaise"], 4000)

    def test_cashfree_refund_rejected_never_reissues_or_deducts_ledger(self):
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
        fake.refund_status = "REJECTED"
        with patch("app.services.cashfree_refunds.CashfreeGateway", return_value=fake):
            self.assertEqual(reconcile_cashfree_refund(self.db, refund_id=refund.id, initiate=True, actor_user_id=self.admin.id), "REJECTED")
            with self.assertRaises(ValueError):
                reconcile_cashfree_refund(self.db, refund_id=refund.id, initiate=True)
            self.assertEqual(reconcile_cashfree_refund(self.db, refund_id=refund.id, initiate=False), "REJECTED")
        self.assertEqual(refund.status, "APPROVED")
        self.assertEqual(self.registration.payment_status, "approved")
        self.assertEqual(settlement_summary(self.db, event_id=self.event.id)["outstandingAmountPaise"], 9000)

    def test_cashfree_refund_emails_only_after_verified_success(self):
        fake = FakeCashfree()
        self.registration.participant.email = "runner@example.test"
        self.db.commit()
        with patch("app.services.cashfree_registration_service.CashfreeGateway", return_value=fake):
            reconcile_order(self.db, provider_order_id=self.checkout.provider_order_id)
        refund = Refund(registration_id=self.registration.id, event_id=self.event.id,
            participant_id=self.registration.participant_id, organizer_id=self.event.organization_id,
            payment_method="cashfree", payment_provider="CASHFREE",
            original_registration_amount=10000, original_platform_fee=1000, original_total_paid=10000,
            requested_refund_amount=5000, approved_refund_amount=5000, platform_fee_refund_amount=0,
            refund_reason="Cannot attend", status="APPROVED")
        self.db.add(refund); self.db.commit()
        with patch("app.services.cashfree_refunds.CashfreeGateway", return_value=fake), patch(
                "app.services.email_service.send_email") as send_email:
            self.assertEqual(reconcile_cashfree_refund(self.db, refund_id=refund.id, initiate=True, actor_user_id=self.admin.id), "PENDING")
            send_email.assert_not_called()
            fake.refund_status = "SUCCESS"
            self.assertEqual(reconcile_cashfree_refund(self.db, refund_id=refund.id, initiate=False), "SUCCESS")
            self.assertEqual(reconcile_cashfree_refund(self.db, refund_id=refund.id, initiate=False), "SUCCESS")
            self.assertEqual(send_email.call_count, 1)
            self.assertEqual(send_email.call_args.kwargs["recipient"], "runner@example.test")

    def test_cashfree_refund_missing_after_timeout_resumes_same_id(self):
        fake = FakeCashfree()
        with patch("app.services.cashfree_registration_service.CashfreeGateway", return_value=fake):
            reconcile_order(self.db, provider_order_id=self.checkout.provider_order_id)
        refund = Refund(registration_id=self.registration.id, event_id=self.event.id,
            participant_id=self.registration.participant_id, organizer_id=self.event.organization_id,
            payment_method="cashfree", payment_provider="CASHFREE",
            original_registration_amount=10000, original_platform_fee=1000, original_total_paid=10000,
            requested_refund_amount=5000, approved_refund_amount=5000, platform_fee_refund_amount=0,
            refund_reason="Cannot attend", status="APPROVED")
        self.db.add(refund); self.db.flush()
        refund.provider_refund_id = f"sp_ref_{refund.id.hex}"
        refund.provider_refund_status = "PENDING"
        self.db.commit()
        with patch("app.services.cashfree_refunds.CashfreeGateway", return_value=fake):
            self.assertEqual(reconcile_cashfree_refund(self.db, refund_id=refund.id, initiate=True), "PENDING")
        self.assertEqual(refund.provider_refund_id, f"sp_ref_{refund.id.hex}")

    def test_refund_pagination_orders_by_timestamp_then_id(self):
        refunds = []
        for day in (1, 3, 2, 5, 4):
            refund = Refund(registration_id=self.registration.id, event_id=self.event.id,
                participant_id=self.registration.participant_id, organizer_id=self.event.organization_id,
                payment_method="cashfree", payment_provider="CASHFREE",
                original_registration_amount=10000, original_platform_fee=1000, original_total_paid=10000,
                requested_refund_amount=5000, approved_refund_amount=5000, platform_fee_refund_amount=0,
                refund_reason="Cannot attend", status="REJECTED",
                created_at=dt.datetime(2026, 1, day, tzinfo=dt.timezone.utc))
            self.db.add(refund)
            refunds.append(refund)
        self.db.commit()
        expected = [refund.id for refund in reversed(refunds)]
        for listing in (
            lambda cursor: list_refunds_for_admin(self.db, limit=2, cursor=cursor),
            lambda cursor: list_refunds_for_organizer(self.db, organizer_id=self.event.organization_id,
                                                     limit=2, cursor=cursor),
        ):
            found = []
            cursor = None
            while True:
                page = listing(cursor)
                selected = page[:2]
                found.extend(refund.id for refund in selected)
                if len(page) <= 2:
                    break
                cursor = str(selected[-1].id)
            self.assertEqual(found, [expected[index] for index in (1, 0, 3, 2, 4)])

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
