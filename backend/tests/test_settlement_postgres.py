"""Run against an explicitly configured disposable local PostgreSQL instance."""
import datetime as dt
import importlib.util
import os
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import unittest
import uuid

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text, select
from sqlalchemy.orm import Session
from sqlalchemy.exc import DBAPIError

from db import Base
from models import ManagedRegistrationCollection, OrganizerSettlement
from app.services.organizer_settlement_service import create_settlement, settlement_summary, SettlementValidationError
from tests import test_organizer_settlement_service as settlement_fixtures

@unittest.skipUnless(os.environ.get("SETTLEMENT_TEST_DATABASE_URL"), "Explicit disposable PostgreSQL URL required")
class SettlementPostgresTests(unittest.TestCase):
    def setUp(self):
        url = os.environ["SETTLEMENT_TEST_DATABASE_URL"]
        if "127.0.0.1:55439/" not in url:
            raise RuntimeError("These tests require the isolated local port 55439")
        self.admin_engine = create_engine(url)
        self.schema = "settlement_test_" + uuid.uuid4().hex
        with self.admin_engine.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{self.schema}"'))
        self.engine = create_engine(url, connect_args={"options": f"-csearch_path={self.schema}"})
        tables = [t for t in Base.metadata.sorted_tables if t.name not in {
            "managed_registration_collections", "organizer_settlements", "organizer_payable_adjustments"}]
        Base.metadata.create_all(self.engine, tables=tables)
        spec = importlib.util.spec_from_file_location("settlement_migration", Path(__file__).parents[1] / "migrations/versions/0068_organizer_settlement_ledger.py")
        migration = importlib.util.module_from_spec(spec); spec.loader.exec_module(migration)
        self.migration = migration
        with self.engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                migration.upgrade()
        self.fixture = settlement_fixtures.OrganizerSettlementServiceTests()
        self.fixture.engine = self.engine
        self.fixture.db = Session(self.engine)
        self.fixture._seed()

    def tearDown(self):
        self.fixture.db.close(); self.engine.dispose()
        with self.admin_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{self.schema}" CASCADE'))
        self.admin_engine.dispose()

    def test_concurrent_transfers_cannot_overpay(self):
        f = self.fixture; f._payment(100_000)
        event_id, admin_id = f.event.id, f.admin.id
        f.db.commit()
        barrier = Barrier(2)
        def transfer(index):
            with Session(self.engine) as db:
                barrier.wait()
                try:
                    create_settlement(db, event_id=event_id, actor_user_id=admin_id, amount_paise=80_000,
                        method="BANK_TRANSFER", reference_number=f"BANK-{index}", settlement_date=dt.date(2026,10,7),
                        status="PAID", notes=None, idempotency_key=f"request-{index}")
                    db.commit(); return "paid"
                except SettlementValidationError:
                    db.rollback(); return "rejected"
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(transfer, [1,2])), ["paid", "rejected"])
        self.assertEqual(settlement_summary(f.db, event_id=event_id)["outstandingAmountPaise"], 20_000)

    def test_concurrent_same_request_posts_once(self):
        f=self.fixture; f._payment(100_000); event_id,admin_id=f.event.id,f.admin.id;f.db.commit()
        barrier=Barrier(2)
        def transfer(_):
            with Session(self.engine) as db:
                barrier.wait()
                row=create_settlement(db,event_id=event_id,actor_user_id=admin_id,amount_paise=20_000,
                    method="UPI",reference_number="SAME-UTR",settlement_date=dt.date(2026,10,7),status="PAID",notes=None,idempotency_key="same-request")
                row_id=row.id;db.commit();return row_id
        with ThreadPoolExecutor(max_workers=2) as pool:
            ids=list(pool.map(transfer,[1,2]))
        self.assertEqual(ids[0],ids[1])

    def test_database_blocks_paid_edits_and_collection_deletion(self):
        f=self.fixture;f._payment(100_000);row=f._settle(20_000); row_id=row.id;f.db.commit()
        with self.assertRaises(DBAPIError):
            with self.engine.begin() as conn:
                conn.execute(text("UPDATE organizer_settlements SET amount_paise=100 WHERE id=:id"), {"id":row_id})
        with self.assertRaises(DBAPIError):
            with self.engine.begin() as conn: conn.execute(text("DELETE FROM managed_registration_collections"))
        with self.assertRaises(RuntimeError):
            with self.engine.begin() as conn:
                with Operations.context(MigrationContext.configure(conn)): self.migration.downgrade()

    def test_pending_edit_trigger_allows_valid_transition(self):
        f=self.fixture;f._payment(100_000);row=f._settle(20_000,status="PENDING");f.db.commit()
        f._update(row,"PAID");f.db.commit()
        self.assertEqual(row.status,"PAID")

    def test_refund_commit_is_seen_before_pending_is_paid(self):
        f=self.fixture; registration=f._payment(100_000);row=f._settle(80_000,status="PENDING")
        event_id, admin_id, row_id = f.event.id, f.admin.id, row.id
        f.db.commit()
        # Hold the same event lock a provider refund callback uses.
        f._refund(registration,90_000)
        def pay():
            from app.services.organizer_settlement_service import update_pending_settlement
            with Session(self.engine) as db:
                try:
                    update_pending_settlement(db,settlement_id=row_id,actor_user_id=admin_id,event_id=event_id,
                        expected_version=1,amount_paise=80_000,method="BANK_TRANSFER",reference_number="REFUND-RACE",
                        settlement_date=dt.date(2026,10,7),status="PAID",notes=None)
                    db.commit();return "paid"
                except SettlementValidationError:
                    db.rollback();return "rejected"
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending=pool.submit(pay)
            f.db.commit()
            self.assertEqual(pending.result(timeout=10),"rejected")

    def test_completed_refund_cannot_be_edited_away(self):
        f=self.fixture;registration=f._payment(100_000);f._refund(registration,10_000);f.db.commit()
        with self.assertRaises(DBAPIError):
            with self.engine.begin() as conn: conn.execute(text("UPDATE refunds SET status='CANCELLED'"))

    def test_empty_migration_can_be_downgraded(self):
        self.fixture.db.rollback()
        with self.engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)): self.migration.downgrade()
