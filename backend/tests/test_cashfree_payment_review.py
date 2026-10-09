import unittest
from unittest.mock import patch

from sqlalchemy import select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import IntegrityError

from tests import test_cashfree_integration as fixtures
from app.services.cashfree_payment_review import resolve_payment, reconcile_review_refund
from app.services.cashfree_registration_service import reconcile_order
from app.services.cashfree_gateway import ProviderUnavailable
from app.services.cashfree_refunds import reconcile_cashfree_refund
from app.services.refund_service import request_refund
from models import AuditLog, CashfreePaymentResolution, CheckoutReceipt, CommunicationConfig, EmailLog, ManagedRegistrationCollection, Refund


class ReviewGateway(fixtures.FakeCashfree):
    def __init__(self):
        self.refunds = {}
        self.calls = 0
        self.timeout_after_create = False
        self.refund_status = "PENDING"

    def get_refund(self, order_id, refund_id, *, missing_ok=False):
        result = self.refunds.get(refund_id)
        return {**result, "refund_status": self.refund_status} if result else None

    def create_refund(self, order_id, refund_id, amount, *, idempotency_key):
        self.calls += 1
        self.refunds[refund_id] = dict(order_id=order_id, refund_id=refund_id,
            refund_amount=amount / 100, refund_currency="INR")
        if self.timeout_after_create:
            raise ProviderUnavailable("Simulated timeout after acceptance")
        return self.get_refund(order_id, refund_id)


class CashfreeReviewTests(unittest.TestCase):
    def setUp(self):
        self.f = fixtures.CashfreeIntegrationTests()
        self.f.setUp()
        self.db = self.f.db
        self.gateway = ReviewGateway()
        self.patches = [patch(f"app.services.{module}.CashfreeGateway", return_value=self.gateway)
                        for module in ("cashfree_payment_review", "cashfree_registration_service", "cashfree_refunds", "cashfree_recovery")]
        for patcher in self.patches:
            patcher.start()
        self.f.registration.participant.email = "runner@example.test"
        self.f.event.status = "draft"
        self.db.commit()
        self.assertEqual(reconcile_order(self.db, provider_order_id=self.f.checkout.provider_order_id), "paid_needs_review")

    def tearDown(self):
        for patcher in self.patches:
            patcher.stop()
        self.f.tearDown()

    def resolve(self, action="REFUND"):
        return resolve_payment(self.db, payment_id=self.f.checkout.id, action=action,
                               reason="Customer booking could not complete", actor_user_id=self.f.admin.id)

    def test_fulfillment_is_atomic_keeps_receipt_and_posts_ledger_once(self):
        self.f.event.status = "published"
        self.db.commit()
        self.assertEqual(self.resolve("FULFILL"), "FULFILLED")
        self.assertEqual(self.resolve("FULFILL"), "FULFILLED")
        self.assertEqual(self.f.checkout.status, "successful")
        self.assertEqual(self.f.registration.status, "confirmed")
        self.assertEqual(self.f.ticket.quantity_sold, 1)
        self.assertEqual(len(self.db.scalars(select(ManagedRegistrationCollection)).all()), 1)
        self.assertEqual(self.db.scalar(select(CheckoutReceipt)).disposition, "paid_needs_review")
        self.assertEqual(len(self.db.scalars(select(EmailLog).where(EmailLog.reference_type == "CASHFREE_BOOKING")).all()), 1)
        with self.assertRaisesRegex(ValueError, "different resolution"):
            self.resolve("REFUND")

    def test_invalid_event_or_lost_reservation_cannot_force_tickets(self):
        with self.assertRaisesRegex(ValueError, "reserved tickets"):
            self.resolve("FULFILL")
        self.db.rollback()
        self.f.event.status = "published"
        self.f.ticket.quantity_reserved = 0
        self.db.commit()
        with self.assertRaises(ValueError):
            self.resolve("FULFILL")
        self.db.rollback()
        self.assertIsNone(self.db.scalar(select(CashfreePaymentResolution)))
        self.assertIsNone(self.f.registration.ticket_token_hash)
        self.assertIsNone(self.db.scalar(select(ManagedRegistrationCollection)))

    def test_refund_success_without_tickets_or_payable_and_no_duplicate(self):
        self.assertEqual(self.resolve(), "PENDING")
        self.assertEqual(self.f.checkout.status, "paid_needs_review")
        self.assertEqual(self.f.registration.payment_status, "refund_pending")
        self.assertEqual(self.f.ticket.quantity_reserved, 0)
        self.gateway.refund_status = "SUCCESS"
        self.assertEqual(reconcile_review_refund(self.db, payment_id=self.f.checkout.id), "REFUNDED")
        self.assertEqual(self.resolve(), "REFUNDED")
        reconcile_order(self.db, provider_order_id=self.f.checkout.provider_order_id)
        self.assertEqual(self.f.checkout.status, "refunded")
        self.assertEqual(self.f.registration.payment_status, "refunded")
        self.assertEqual(self.gateway.calls, 1)
        self.assertEqual(self.f.ticket.quantity_sold, 0)
        self.assertIsNone(self.db.scalar(select(ManagedRegistrationCollection)))
        self.assertIsNone(self.db.scalar(select(EmailLog).where(EmailLog.reference_type == "CASHFREE_BOOKING")))
        audit = self.db.scalars(select(AuditLog).where(AuditLog.action == "cashfree_payment_resolution_status_changed")).all()
        self.assertEqual([entry.metadata_json["toStatus"] for entry in audit], ["PENDING", "SUCCESS"])
        self.assertEqual(audit[-1].metadata_json["initiatedBy"], str(self.f.admin.id))
        self.assertIsNone(audit[-1].actor_user_id)
        self.assertEqual(len(self.db.scalars(select(EmailLog).where(EmailLog.reference_type == "CASHFREE_REVIEW_REFUND_SUCCESS")).all()), 2)

    def test_timeout_after_acceptance_recovers_without_second_create(self):
        self.gateway.timeout_after_create = True
        with self.assertRaises(ProviderUnavailable):
            self.resolve()
        self.db.rollback()
        resolution = self.db.scalar(select(CashfreePaymentResolution))
        self.assertEqual(resolution.initiated_by, self.f.admin.id)
        self.assertEqual(resolution.status, "PENDING")
        self.gateway.refund_status = "SUCCESS"
        from app.services.cashfree_recovery import recover_once
        recover_once(sessionmaker(bind=self.f.engine))
        self.db.expire_all()
        self.assertEqual(self.f.checkout.status, "refunded")
        self.assertEqual(self.gateway.calls, 1)

    def test_provider_rejection_requires_review_and_cannot_change_decision(self):
        self.gateway.refund_status = "REJECTED"
        self.assertEqual(self.resolve(), "NEEDS_REVIEW")
        self.assertEqual(self.resolve(), "NEEDS_REVIEW")
        with self.assertRaisesRegex(ValueError, "different resolution"):
            self.resolve("FULFILL")
        self.assertEqual(self.gateway.calls, 1)
        self.assertNotEqual(self.f.checkout.status, "refunded")

    def test_mismatched_refund_amount_never_marks_refunded(self):
        self.resolve()
        self.gateway.refund_status = "SUCCESS"
        for result in self.gateway.refunds.values():
            result["refund_amount"] = 1
        with self.assertRaises(ProviderUnavailable):
            reconcile_review_refund(self.db, payment_id=self.f.checkout.id)
        self.assertNotEqual(self.f.checkout.status, "refunded")

    def test_unverified_or_other_merchant_cannot_resolve(self):
        self.gateway.account = "another-merchant"
        with self.assertRaises(ValueError):
            self.resolve()
        self.assertEqual(self.gateway.calls, 0)

    def test_new_refund_requires_explicit_admin_and_preserves_initiator(self):
        self.f.event.status = "published"
        self.db.commit()
        self.resolve("FULFILL")
        refund = Refund(registration_id=self.f.registration.id, event_id=self.f.event.id,
            participant_id=self.f.registration.participant_id, organizer_id=self.f.event.organization_id,
            payment_method="cashfree", payment_provider="CASHFREE", original_registration_amount=10000,
            original_platform_fee=1000, original_total_paid=10000, requested_refund_amount=5000,
            approved_refund_amount=5000, platform_fee_refund_amount=0, refund_reason="Cannot attend", status="APPROVED")
        self.db.add(refund); self.db.commit()
        with self.assertRaisesRegex(ValueError, "admin"):
            reconcile_cashfree_refund(self.db, refund_id=refund.id, initiate=True)
        self.db.rollback()
        reconcile_cashfree_refund(self.db, refund_id=refund.id, initiate=True, actor_user_id=self.f.admin.id)
        self.gateway.refund_status = "ONHOLD"
        reconcile_cashfree_refund(self.db, refund_id=refund.id, initiate=False)
        self.gateway.refund_status = "SUCCESS"
        reconcile_cashfree_refund(self.db, refund_id=refund.id, initiate=False)
        self.assertEqual(refund.initiated_by, self.f.admin.id)
        history = self.db.scalars(select(AuditLog).where(AuditLog.resource_id == str(refund.id))).all()
        self.assertEqual([row.action for row in history], ["cashfree_refund_initiated", "cashfree_refund_status_changed", "cashfree_refund_status_changed", "cashfree_refund_confirmed"])
        self.assertEqual(history[-1].metadata_json["initiatedBy"], str(self.f.admin.id))

    def test_database_blocks_duplicate_active_refund_but_keeps_rejected_history(self):
        self.f.event.status = "published"
        self.f.event.refund_policy_enabled = True
        self.f.event.refund_policy_type = "full_refund"
        self.db.commit()
        self.resolve("FULFILL")
        refund = request_refund(self.db, registration_id=self.f.registration.id, actor_user_id=None,
                                refund_reason="Cannot attend", participant_comments=None)
        duplicate = Refund(registration_id=refund.registration_id, event_id=refund.event_id,
            organizer_id=refund.organizer_id, payment_method=refund.payment_method, payment_provider=refund.payment_provider,
            original_registration_amount=10000, original_platform_fee=1000, original_total_paid=10000,
            requested_refund_amount=5000, refund_reason="Duplicate", status="APPROVED")
        self.db.add(duplicate)
        with self.assertRaises(IntegrityError):
            self.db.commit()
        self.db.rollback()
        refund.status = "REJECTED"
        self.db.commit()
        replacement = request_refund(self.db, registration_id=self.f.registration.id, actor_user_id=None,
                                      refund_reason="New request", participant_comments=None)
        self.assertNotEqual(refund.id, replacement.id)

    def test_refund_email_body_and_stale_review_email_suppression(self):
        from app.services.email_service import _deliver_existing_log
        self.db.add(CommunicationConfig(channel="EMAIL", enabled=True,
                    configuration={"sender_name": "SportPass", "gmail_address": "support@example.test"}))
        self.db.commit()
        self.resolve()
        self.gateway.refund_status = "SUCCESS"
        reconcile_review_refund(self.db, payment_id=self.f.checkout.id)
        with patch("app.services.email_service.gmail_api_configured", return_value=True), patch("app.services.email_service.send_gmail_message") as send:
            stale = self.db.scalar(select(EmailLog).where(EmailLog.reference_type == "CASHFREE_PAYMENT_REVIEW_PARTICIPANT"))
            self.assertEqual(_deliver_existing_log(self.db, stale).status, "SKIPPED")
            send.assert_not_called()
            success = self.db.scalar(select(EmailLog).where(EmailLog.reference_type == "CASHFREE_REVIEW_REFUND_SUCCESS",
                                                           EmailLog.recipient == "runner@example.test"))
            self.assertEqual(_deliver_existing_log(self.db, success).status, "SENT")
            msg = send.call_args.args[0]
            body = msg.get_payload()[0].get_payload(decode=True).decode("utf-8")
            self.assertIn("confirmed the full refund", body)
            self.assertIn("100.00", body)
            self.assertIn("No ticket has been issued", body)
            self.assertEqual(len(msg.get_payload()), 1)
            self.assertEqual(_deliver_existing_log(self.db, success).status, "SKIPPED")
            self.assertEqual(send.call_count, 1)
