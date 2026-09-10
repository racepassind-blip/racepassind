from __future__ import annotations

import datetime as dt
import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.services.auth_service import hash_opaque_token
from app.services.checkin_service import check_in_registration
from app.services.registration_service import create_guest_registration, decide_registration_payment
from app.services.ticket_service import ticket_token_for_registration
from app.config import get_settings
from db import Base
from models import (
    AuditLog,
    Checkin,
    Event,
    EventPaymentSettings,
    Organization,
    OrganizationMember,
    Order,
    OrderItem,
    Participant,
    Payment,
    Registration,
    Ticket,
    User,
)


BACKEND_ROOT = Path(__file__).resolve().parents[1]
DATABASE_URL = os.getenv("RACEPASS_TEST_DATABASE_URL")


@unittest.skipUnless(DATABASE_URL, "Set RACEPASS_TEST_DATABASE_URL to run PostgreSQL integration tests")
class PostgreSQLIntegrationTests(unittest.TestCase):
    """Integration tests that must run against a disposable PostgreSQL database.

    SQLite tests intentionally remain the fast local/unit suite. These tests use
    independent PostgreSQL sessions and real row locks to verify concurrency.
    """

    @classmethod
    def setUpClass(cls) -> None:
        assert DATABASE_URL is not None
        if not DATABASE_URL.startswith(("postgresql://", "postgresql+")):
            raise RuntimeError("RACEPASS_TEST_DATABASE_URL must be a PostgreSQL SQLAlchemy URL")
        if os.getenv("RACEPASS_TEST_DATABASE_RESET") != "1":
            raise RuntimeError(
                "Set RACEPASS_TEST_DATABASE_RESET=1; the PostgreSQL integration suite resets a disposable database"
            )

        cls.engine = create_engine(
            DATABASE_URL,
            pool_pre_ping=True,
            pool_size=8,
            max_overflow=0,
        )
        with cls.engine.begin() as connection:
            connection.exec_driver_sql("DROP SCHEMA public CASCADE")
            connection.exec_driver_sql("CREATE SCHEMA public")
        cls._upgrade_head()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.engine.dispose()

    @classmethod
    def _upgrade_head(cls) -> None:
        config = Config(str(BACKEND_ROOT / "alembic.ini"))
        config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
        previous_url = os.environ.get("DATABASE_URL")
        os.environ["DATABASE_URL"] = DATABASE_URL or ""
        get_settings.cache_clear()
        try:
            command.upgrade(config, "head")
        finally:
            if previous_url is None:
                os.environ.pop("DATABASE_URL", None)
            else:
                os.environ["DATABASE_URL"] = previous_url
            get_settings.cache_clear()

    def _actor_and_event(self, db: Session, *, ticket_total: int = 1, suffix: str | None = None):
        suffix = suffix or uuid4().hex
        organizer = User(
            name=f"PostgreSQL Organizer {suffix}",
            email=f"pg-organizer-{suffix}@example.test",
            normalized_email=f"pg-organizer-{suffix}@example.test",
            password_hash="test-hash",
            role="organizer",
            is_active=True,
        )
        organization = Organization(name=f"PostgreSQL Events {suffix}", status="active")
        db.add_all([organizer, organization])
        db.flush()
        db.add(OrganizationMember(organization_id=organization.id, user_id=organizer.id, member_role="organizer"))
        event = Event(
            organization_id=organization.id,
            name=f"PostgreSQL 10K {suffix}",
            description="Concurrency integration event",
            category="running",
            location_name="Bengaluru",
            country="India",
            max_participants=max(ticket_total, 1),
            status="published",
            start_date=dt.datetime(2026, 10, 10, tzinfo=dt.timezone.utc),
            distance="10 km",
            participants=0,
            rules=[],
        )
        db.add(event)
        db.flush()
        db.add(
            EventPaymentSettings(
                event_id=event.id,
                method="manual_upi",
                upi_id="racepass@example",
                payee_name="RacePass India",
                instructions="Use the UPI details shown below.",
                is_active=True,
            )
        )
        ticket = Ticket(
            event_id=event.id,
            name="Regular",
            description="Race entry",
            price=10000,
            currency="INR",
            quantity_total=ticket_total,
            quantity_sold=0,
            quantity_reserved=0,
            is_active=True,
        )
        db.add(ticket)
        db.commit()
        return SimpleNamespace(id=organizer.id, role="organizer"), event.id, ticket.id

    @staticmethod
    def _registration_payload(event_id, ticket_id, index: int):
        return SimpleNamespace(
            event_id=event_id,
            ticket_id=ticket_id,
            full_name=f"Concurrent Runner {index}",
            email=f"concurrent-runner-{index}-{uuid4().hex}@example.test",
            phone=None,
            date_of_birth=None,
            gender=None,
            jersey_size=None,
            emergency_contact=None,
            team_name=None,
        )

    def _approval_fixture(self, db: Session):
        actor, event_id, ticket_id = self._actor_and_event(db, ticket_total=1)
        participant = Participant(
            name="Approval Runner",
            email=f"approval-{uuid4().hex}@example.test",
            normalized_email=f"approval-{uuid4().hex}@example.test",
        )
        registration = Registration(
            event_id=event_id,
            participant=participant,
            ticket_id=ticket_id,
            status="pending_verification",
            payment_status="pending_verification",
            quantity=1,
            unit_price_paise=10000,
            total_amount_paise=10000,
            registration_reference=f"RP-APPROVAL-{uuid4().hex[:10].upper()}",
            reserved_until=dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=20),
        )
        db.add(registration)
        db.flush()
        order = Order(total_amount=100, total_amount_paise=10000, currency="INR", status="pending")
        db.add(order)
        db.flush()
        db.add(OrderItem(order_id=order.id, registration_id=registration.id, price=100))
        db.add(
            Payment(
                order_id=order.id,
                registration_id=registration.id,
                amount=100,
                expected_amount_paise=10000,
                method="manual_upi",
                currency="INR",
                payment_gateway="manual_upi",
                status="reference_submitted",
                utr_reference="UTR-POSTGRES-123",
            )
        )
        db.get(Ticket, ticket_id).quantity_reserved = 1
        db.commit()
        return actor, registration.id, ticket_id

    def _checkin_fixture(self, db: Session):
        actor, event_id, ticket_id = self._actor_and_event(db, ticket_total=1)
        participant = Participant(
            name="Check-in Runner",
            email=f"checkin-{uuid4().hex}@example.test",
            normalized_email=f"checkin-{uuid4().hex}@example.test",
        )
        registration = Registration(
            event_id=event_id,
            participant=participant,
            ticket_id=ticket_id,
            status="confirmed",
            payment_status="approved",
            quantity=1,
            unit_price_paise=10000,
            total_amount_paise=10000,
            registration_reference=f"RP-CHECKIN-{uuid4().hex[:10].upper()}",
            confirmation_token_hash=f"confirmation-{uuid4().hex}",
        )
        db.add(registration)
        db.flush()
        token = ticket_token_for_registration(registration)
        registration.ticket_token_hash = hash_opaque_token(token)
        db.get(Ticket, ticket_id).quantity_sold = 1
        db.commit()
        return actor, registration.id, token

    def test_migrations_create_one_unique_checkin_index_and_head(self) -> None:
        with self.engine.connect() as connection:
            version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        self.assertEqual(version, "0009_unique_checkin_registration")
        unique_indexes = [
            index
            for index in inspect(self.engine).get_indexes("checkins")
            if index.get("unique") and index.get("column_names") == ["registration_id"]
        ]
        self.assertEqual(len(unique_indexes), 1)

    def test_concurrent_registrations_never_oversell_capacity(self) -> None:
        with Session(self.engine) as db:
            _, event_id, ticket_id = self._actor_and_event(db, ticket_total=1)

        workers = 4
        barrier = Barrier(workers)

        def register(index: int):
            with Session(self.engine) as db:
                barrier.wait(timeout=30)
                try:
                    registration, _, _ = create_guest_registration(
                        db,
                        self._registration_payload(event_id, ticket_id, index),
                        idempotency_key=f"capacity-{uuid4().hex}",
                    )
                    return ("ok", registration.id)
                except Exception as error:
                    db.rollback()
                    return (type(error).__name__, str(error))

        with ThreadPoolExecutor(max_workers=workers) as executor:
            results = list(executor.map(register, range(workers)))

        successes = [result for result in results if result[0] == "ok"]
        failures = [result for result in results if result[0] != "ok"]
        self.assertEqual(len(successes), 1, results)
        self.assertEqual(len(failures), workers - 1, results)
        self.assertTrue(all(result[0] == "ValueError" and "sold out" in result[1] for result in failures), results)
        with Session(self.engine) as db:
            ticket = db.get(Ticket, ticket_id)
            self.assertEqual((ticket.quantity_reserved, ticket.quantity_sold), (1, 0))
            self.assertEqual(db.scalar(select(func.count()).select_from(Registration).where(Registration.ticket_id == ticket_id)), 1)

    def test_concurrent_same_idempotency_key_replays_one_registration(self) -> None:
        with Session(self.engine) as db:
            _, event_id, ticket_id = self._actor_and_event(db, ticket_total=2)

        workers = 2
        barrier = Barrier(workers)
        key = f"same-request-{uuid4().hex}"

        def register(index: int):
            with Session(self.engine) as db:
                barrier.wait(timeout=30)
                try:
                    registration, confirmation, claim = create_guest_registration(
                        db,
                        self._registration_payload(event_id, ticket_id, index),
                        idempotency_key=key,
                    )
                    return ("ok", registration.id, bool(confirmation), bool(claim))
                except Exception as error:
                    db.rollback()
                    return (type(error).__name__, str(error))

        with ThreadPoolExecutor(max_workers=workers) as executor:
            results = list(executor.map(register, range(workers)))

        self.assertTrue(all(result[0] == "ok" for result in results), results)
        self.assertEqual({result[1] for result in results}, {results[0][1]})
        self.assertEqual(sum(result[2] for result in results), 1)
        self.assertEqual(sum(result[3] for result in results), 1)
        with Session(self.engine) as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(Order).where(Order.idempotency_key == key)), 1)

    def test_concurrent_approval_is_idempotent_and_sells_once(self) -> None:
        with Session(self.engine) as db:
            actor, registration_id, ticket_id = self._approval_fixture(db)

        workers = 2
        barrier = Barrier(workers)

        def approve(_index: int):
            with Session(self.engine) as db:
                barrier.wait(timeout=30)
                try:
                    registration, _ = decide_registration_payment(db, actor, registration_id, decision="approve")
                    return ("ok", registration.status)
                except Exception as error:
                    db.rollback()
                    return (type(error).__name__, str(error))

        with ThreadPoolExecutor(max_workers=workers) as executor:
            results = list(executor.map(approve, range(workers)))

        self.assertTrue(all(result == ("ok", "confirmed") for result in results), results)
        with Session(self.engine) as db:
            ticket = db.get(Ticket, ticket_id)
            registration = db.get(Registration, registration_id)
            self.assertEqual((ticket.quantity_reserved, ticket.quantity_sold), (0, 1))
            self.assertEqual(registration.status, "confirmed")
            self.assertIsNotNone(registration.ticket_token_hash)
            actions = db.scalars(select(AuditLog.action).where(AuditLog.resource_id == str(registration_id))).all()
            self.assertIn("payment_approved", actions)
            self.assertIn("payment_approval_idempotent", actions)

    def test_concurrent_checkin_is_idempotent_and_unique(self) -> None:
        with Session(self.engine) as db:
            actor, registration_id, token = self._checkin_fixture(db)

        workers = 2
        barrier = Barrier(workers)

        def check_in(_index: int):
            with Session(self.engine) as db:
                barrier.wait(timeout=30)
                try:
                    result = check_in_registration(db, actor, credential=token, device_info="PostgreSQL test")
                    return ("ok", result["alreadyCheckedIn"], result["checkedInAt"])
                except Exception as error:
                    db.rollback()
                    return (type(error).__name__, str(error))

        with ThreadPoolExecutor(max_workers=workers) as executor:
            results = list(executor.map(check_in, range(workers)))

        self.assertTrue(all(result[0] == "ok" for result in results), results)
        self.assertEqual(sum(not result[1] for result in results), 1)
        self.assertEqual({result[2] for result in results}, {results[0][2]})
        with Session(self.engine) as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(Checkin).where(Checkin.registration_id == registration_id)), 1)
            self.assertEqual(db.get(Registration, registration_id).status, "checked_in")

    def test_unique_constraints_rollback_and_sold_out_registration_are_safe(self) -> None:
        with Session(self.engine) as db:
            actor, event_id, ticket_id = self._actor_and_event(db, ticket_total=0)
            before_participants = db.scalar(select(func.count()).select_from(Participant))
            with self.assertRaises(ValueError):
                create_guest_registration(
                    db,
                    self._registration_payload(event_id, ticket_id, 0),
                    idempotency_key=f"sold-out-{uuid4().hex}",
                )
            db.rollback()
            self.assertEqual(db.scalar(select(func.count()).select_from(Participant)), before_participants)

            order = Order(
                total_amount=100,
                total_amount_paise=10000,
                currency="INR",
                status="pending",
                idempotency_key=f"unique-{uuid4().hex}",
            )
            db.add(order)
            db.commit()
            db.add(
                Order(
                    total_amount=100,
                    total_amount_paise=10000,
                    currency="INR",
                    status="pending",
                    idempotency_key=order.idempotency_key,
                )
            )
            with self.assertRaises(IntegrityError):
                db.flush()
            db.rollback()
            self.assertEqual(db.scalar(select(func.count()).select_from(Order).where(Order.id == order.id)), 1)

        with Session(self.engine) as db:
            actor, registration_id, _ = self._checkin_fixture(db)
            db.add(Checkin(registration_id=registration_id, checked_in_by=actor.id, device_info="first"))
            db.commit()
            db.add(Checkin(registration_id=registration_id, checked_in_by=actor.id, device_info="duplicate"))
            with self.assertRaises(IntegrityError):
                db.flush()
            db.rollback()
            self.assertEqual(db.scalar(select(func.count()).select_from(Checkin).where(Checkin.registration_id == registration_id)), 1)


if __name__ == "__main__":
    unittest.main()
