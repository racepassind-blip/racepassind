"""Financial races: run only on a disposable local PostgreSQL port."""
import os
import uuid
import unittest
import importlib.util
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session
from sqlalchemy.exc import DBAPIError
from alembic.migration import MigrationContext
from alembic.operations import Operations

from db import Base
from models import Refund, CashfreePaymentResolution, AuditLog
from tests import test_cashfree_integration as fixtures
from tests.test_cashfree_payment_review import ReviewGateway
from app.services.cashfree_registration_service import reconcile_order
from app.services.cashfree_payment_review import resolve_payment
from app.services.cashfree_refunds import reconcile_cashfree_refund
from app.services.refund_service import request_refund, review_refund


@unittest.skipUnless(os.environ.get("SETTLEMENT_TEST_DATABASE_URL"), "Disposable PostgreSQL URL required")
class RefundPostgresTests(unittest.TestCase):
    def setUp(self):
        url = os.environ["SETTLEMENT_TEST_DATABASE_URL"]
        if "127.0.0.1:55439/" not in url:
            raise RuntimeError("Only isolated local PostgreSQL on port 55439 is supported")
        self.admin_engine = create_engine(url)
        self.schema = "refund_test_" + uuid.uuid4().hex
        with self.admin_engine.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{self.schema}"'))
        self.engine = create_engine(url, connect_args={"options": f"-csearch_path={self.schema}"})
        Base.metadata.create_all(self.engine, tables=[table for table in Base.metadata.sorted_tables if table.name not in {
            "cashfree_payment_resolutions", "managed_registration_collections", "organizer_settlements", "organizer_payable_adjustments"}])
        # Reconstruct the previous schema, then apply the real migrations and
        # production ledger triggers rather than testing metadata alone.
        with self.engine.begin() as conn:
            conn.execute(text("DROP INDEX uq_refund_registration_open_or_completed"))
            conn.execute(text("ALTER TABLE refunds DROP COLUMN initiated_by, DROP COLUMN initiated_at"))
            for filename in ("0068_organizer_settlement_ledger.py", "0076_cashfree_resolution_audit.py"):
                spec = importlib.util.spec_from_file_location("migration_under_test", Path(__file__).parents[1] / "migrations/versions" / filename)
                migration = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(migration)
                with Operations.context(MigrationContext.configure(conn)):
                    migration.upgrade()
                self.migration = migration
        self.f = fixtures.CashfreeIntegrationTests()
        self.f.engine, self.f.db = self.engine, Session(self.engine)
        self.f._seed()
        self.f.event.refund_policy_enabled = True
        self.f.event.refund_policy_type = "full_refund"
        self.f.db.commit()
        self.gateway = ReviewGateway()
        self.patchers = [patch(f"app.services.{module}.CashfreeGateway", return_value=self.gateway)
                         for module in ("cashfree_registration_service", "cashfree_payment_review", "cashfree_refunds")]
        for patcher in self.patchers:
            patcher.start()

    def tearDown(self):
        for patcher in self.patchers:
            patcher.stop()
        self.f.db.close()
        self.engine.dispose()
        with self.admin_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{self.schema}" CASCADE'))
        self.admin_engine.dispose()

    def test_two_simultaneous_requests_create_one_refund(self):
        reconcile_order(self.f.db, provider_order_id=self.f.checkout.provider_order_id)
        registration_id = self.f.registration.id
        self.f.db.commit()
        barrier = Barrier(2)
        def request(_):
            with Session(self.engine) as db:
                barrier.wait()
                try:
                    request_refund(db, registration_id=registration_id, actor_user_id=None,
                                   refund_reason="Cannot attend", participant_comments=None)
                    return "created"
                except ValueError:
                    db.rollback()
                    return "blocked"
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(request, [1, 2])), ["blocked", "created"])
        self.assertEqual(len(self.f.db.scalars(select(Refund)).all()), 1)

    def test_simultaneous_approve_reject_records_one_decision(self):
        reconcile_order(self.f.db, provider_order_id=self.f.checkout.provider_order_id)
        refund = request_refund(self.f.db, registration_id=self.f.registration.id, actor_user_id=None,
                                refund_reason="Cannot attend", participant_comments=None)
        refund_id, admin_id = refund.id, self.f.admin.id
        self.f.db.commit()
        barrier = Barrier(2)
        def review(decision):
            with Session(self.engine) as db:
                barrier.wait()
                try:
                    review_refund(db, refund_id=refund_id, reviewer_user_id=admin_id, decision=decision,
                                  approved_amount_paise=5000, organizer_comments="Reviewed request")
                    return "reviewed"
                except ValueError:
                    db.rollback()
                    return "blocked"
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(review, ["approve", "reject"])), ["blocked", "reviewed"])
        decisions = self.f.db.scalars(select(AuditLog).where(AuditLog.action.in_(("refund_approved", "refund_rejected")))).all()
        self.assertEqual(len(decisions), 1)

    def test_competing_refund_and_fulfillment_cannot_both_win(self):
        self.f.event.status = "draft"
        self.f.db.commit()
        reconcile_order(self.f.db, provider_order_id=self.f.checkout.provider_order_id)
        self.f.event.status = "published"
        payment_id, admin_id = self.f.checkout.id, self.f.admin.id
        self.f.db.commit()
        barrier = Barrier(2)
        def resolve(action):
            with Session(self.engine) as db:
                barrier.wait()
                try:
                    resolve_payment(db, payment_id=payment_id, action=action,
                                    reason="Investigated failed booking", actor_user_id=admin_id)
                    return "resolved"
                except ValueError:
                    db.rollback()
                    return "blocked"
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(resolve, ["FULFILL", "REFUND"])), ["blocked", "resolved"])
        self.assertEqual(len(self.f.db.scalars(select(CashfreePaymentResolution)).all()), 1)

    def test_resolution_decision_cannot_be_edited_or_deleted(self):
        self.f.event.status = "draft"
        self.f.db.commit()
        reconcile_order(self.f.db, provider_order_id=self.f.checkout.provider_order_id)
        resolve_payment(self.f.db, payment_id=self.f.checkout.id, action="REFUND",
                        reason="Booking cannot be fulfilled", actor_user_id=self.f.admin.id)
        self.f.db.commit()
        for sql in ("DELETE FROM cashfree_payment_resolutions", "UPDATE cashfree_payment_resolutions SET amount_paise=1",
                    "UPDATE cashfree_payment_resolutions SET action='FULFILL'"):
            with self.assertRaises(DBAPIError):
                with self.engine.begin() as conn:
                    conn.execute(text(sql))
        with self.assertRaises(RuntimeError):
            with self.engine.begin() as conn:
                with Operations.context(MigrationContext.configure(conn)):
                    self.migration.downgrade()

    def test_concurrent_same_refund_resolution_uses_one_provider_request(self):
        self.f.event.status = "draft"
        self.f.db.commit()
        reconcile_order(self.f.db, provider_order_id=self.f.checkout.provider_order_id)
        payment_id, admin_id = self.f.checkout.id, self.f.admin.id
        self.f.db.commit()
        barrier = Barrier(2)
        def resolve(_):
            with Session(self.engine) as db:
                barrier.wait()
                return resolve_payment(db, payment_id=payment_id, action="REFUND",
                                       reason="Booking cannot be fulfilled", actor_user_id=admin_id)
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(list(pool.map(resolve, [1, 2])), ["PENDING", "PENDING"])
        self.assertEqual(self.gateway.calls, 1)

    def test_initiated_refund_amount_and_actor_cannot_be_rewritten(self):
        reconcile_order(self.f.db, provider_order_id=self.f.checkout.provider_order_id)
        refund = request_refund(self.f.db, registration_id=self.f.registration.id, actor_user_id=None,
                                refund_reason="Cannot attend", participant_comments=None)
        review_refund(self.f.db, refund_id=refund.id, reviewer_user_id=self.f.admin.id,
                      decision="approve", approved_amount_paise=5000, organizer_comments="Approved")
        reconcile_cashfree_refund(self.f.db, refund_id=refund.id, initiate=True, actor_user_id=self.f.admin.id)
        self.f.db.commit()
        for sql in ("UPDATE refunds SET initiated_by=NULL", "UPDATE refunds SET approved_refund_amount=1"):
            with self.assertRaises(DBAPIError):
                with self.engine.begin() as conn:
                    conn.execute(text(sql))
        self.gateway.refund_status = "SUCCESS"
        self.assertEqual(reconcile_cashfree_refund(self.f.db, refund_id=refund.id, initiate=False), "SUCCESS")

    def test_migration_refuses_existing_duplicates_without_deleting_history(self):
        reconcile_order(self.f.db, provider_order_id=self.f.checkout.provider_order_id)
        refund = request_refund(self.f.db, registration_id=self.f.registration.id, actor_user_id=None,
                                refund_reason="Cannot attend", participant_comments=None)
        refund_id = refund.id
        self.f.db.commit()
        with self.engine.begin() as conn:
            conn.execute(text("DROP INDEX uq_refund_registration_open_or_completed"))
            conn.execute(text("""INSERT INTO refunds (id, registration_id, event_id, organizer_id, payment_method,
                payment_provider, original_registration_amount, original_platform_fee, original_total_paid,
                requested_refund_amount, refund_reason, status)
                SELECT :new_id, registration_id, event_id, organizer_id, payment_method, payment_provider,
                    original_registration_amount, original_platform_fee, original_total_paid,
                    requested_refund_amount, refund_reason, status FROM refunds WHERE id=:old_id"""),
                {"new_id": uuid.uuid4(), "old_id": refund_id})
        with self.assertRaisesRegex(RuntimeError, "duplicate"):
            with self.engine.begin() as conn:
                with Operations.context(MigrationContext.configure(conn)):
                    self.migration.upgrade()
        self.assertEqual(len(self.f.db.scalars(select(Refund)).all()), 2)
