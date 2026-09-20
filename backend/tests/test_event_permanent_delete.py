from __future__ import annotations

import datetime as dt
import unittest
import uuid

from sqlalchemy import create_engine, event as sa_event, select
from sqlalchemy.orm import Session

from app.services.event_archive_service import delete_archived_event
from db import Base
from models import (
    AllocationHistory,
    AuditLog,
    Checkin,
    Court,
    EmailLog,
    Event,
    EventCategory,
    Match,
    Order,
    OrderItem,
    Organization,
    Participant,
    Payment,
    RaceResult,
    Registration,
    RegistrationParticipant,
    Ticket,
    TournamentRound,
    User,
)


def _enable_sqlite_fks(engine) -> None:
    @sa_event.listens_for(engine, "connect")
    def _fk_pragma(dbapi_connection, _record):  # noqa: ANN001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


class EventPermanentDeleteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite:///:memory:", connect_args={"check_same_thread": False}
        )
        # Enforce FK constraints so deletion order is genuinely validated.
        _enable_sqlite_fks(self.engine)
        Base.metadata.create_all(self.engine)

    def _seed_full_event(self, db: Session) -> tuple[Event, User]:
        admin = User(
            name="Admin",
            email=f"admin-{uuid.uuid4().hex}@example.test",
            normalized_email=f"admin-{uuid.uuid4().hex}@example.test",
            password_hash="hash",
            role="admin",
            is_active=True,
        )
        org = Organization(name="Org", status="active")
        db.add_all([admin, org])
        db.flush()

        event = Event(
            organization_id=org.id,
            name="Race",
            description="desc",
            category="running",
            max_participants=100,
            status="published",
            distance="5k",
            rules=[],
            archived_at=dt.datetime.now(dt.timezone.utc),
        )
        db.add(event)
        db.flush()

        category = EventCategory(event_id=event.id, name="Open")
        db.add(category)
        db.flush()

        ticket = Ticket(
            event_id=event.id,
            category_id=category.id,
            name="GA",
            description="d",
            price=100,
            currency="INR",
            quantity_total=10,
        )
        participant = Participant(name="Runner")
        db.add_all([ticket, participant])
        db.flush()

        registration = Registration(
            event_id=event.id,
            participant_id=participant.id,
            ticket_id=ticket.id,
            category_id=category.id,
            status="confirmed",
        )
        db.add(registration)
        db.flush()

        reg_participant = RegistrationParticipant(
            registration_id=registration.id,
            participant_id=participant.id,
            participant_index=0,
        )
        db.add(reg_participant)

        order = Order(total_amount=100, currency="INR", status="paid")
        db.add(order)
        db.flush()
        db.add(OrderItem(order_id=order.id, registration_id=registration.id, price=100))
        db.add(
            Payment(
                order_id=order.id,
                registration_id=registration.id,
                amount=100,
                currency="INR",
                payment_gateway="manual",
                status="approved",
            )
        )
        db.add(Checkin(registration_id=registration.id))
        db.add(
            AllocationHistory(
                event_id=event.id,
                registration_id=registration.id,
                new_number=1,
                changed_by=admin.id,
            )
        )
        db.add(
            RaceResult(
                event_id=event.id,
                participant_id=participant.id,
                category_id=category.id,
                rank=1,
            )
        )

        court = Court(event_id=event.id, name="Court 1")
        db.add(court)
        db.flush()
        tround = TournamentRound(
            event_id=event.id, category_id=category.id, name="R1", position=0
        )
        db.add(tround)
        db.flush()
        db.add(
            Match(
                event_id=event.id,
                category_id=category.id,
                entry_a_registration_id=registration.id,
                entry_b_registration_id=registration.id,
                court_id=court.id,
                round_id=tround.id,
                round_label="R1",
            )
        )
        db.add(
            EmailLog(
                recipient="runner@example.test",
                subject="Welcome",
                email_type="REGISTRATION_CONFIRMATION",
                event_id=event.id,
            )
        )
        db.commit()
        db.refresh(event)
        db.refresh(admin)
        return event, admin

    def _seed_minimal_event(self, db: Session, org: Organization, participant: Participant, admin: User) -> Event:
        event = Event(
            organization_id=org.id,
            name="Other Race",
            description="desc",
            category="running",
            max_participants=100,
            status="published",
            distance="10k",
            rules=[],
            archived_at=None,
        )
        db.add(event)
        db.flush()
        category = EventCategory(event_id=event.id, name="Open")
        db.add(category)
        db.flush()
        ticket = Ticket(
            event_id=event.id, category_id=category.id, name="GA",
            description="d", price=100, currency="INR", quantity_total=10,
        )
        db.add(ticket)
        db.flush()
        reg = Registration(
            event_id=event.id, participant_id=participant.id, ticket_id=ticket.id,
            category_id=category.id, status="confirmed",
        )
        db.add(reg)
        db.flush()
        order = Order(total_amount=100, currency="INR", status="paid")
        db.add(order)
        db.flush()
        db.add(Payment(order_id=order.id, registration_id=reg.id, amount=100,
                        currency="INR", payment_gateway="manual", status="approved"))
        db.add(EmailLog(recipient="x@example.test", subject="s",
                        email_type="REGISTRATION_CONFIRMATION", event_id=event.id))
        db.commit()
        db.refresh(event)
        return event

    def test_delete_does_not_touch_other_events_or_org_data(self) -> None:
        with Session(self.engine) as db:
            event_a, admin = self._seed_full_event(db)
            org = db.get(Organization, event_a.organization_id)
            # A participant shared across both events.
            shared_participant = db.scalars(select(Participant)).first()
            event_b = self._seed_minimal_event(db, org, shared_participant, admin)
            event_b_id = event_b.id
            org_id = org.id
            participant_id = shared_participant.id
            admin_id = admin.id

            delete_archived_event(db, event_a, admin.id)
            db.commit()

            # Event B and its data survive untouched.
            self.assertIsNotNone(db.get(Event, event_b_id))
            b_regs = db.scalars(select(Registration).where(Registration.event_id == event_b_id)).all()
            self.assertEqual(len(b_regs), 1)
            b_payments = db.scalars(select(Payment)).all()
            self.assertEqual(len(b_payments), 1)  # only event B's payment remains
            b_emails = [e for e in db.scalars(select(EmailLog)).all() if e.event_id == event_b_id]
            self.assertEqual(len(b_emails), 1)

            # Organizer/organization, shared participant, and admin user are intact.
            self.assertIsNotNone(db.get(Organization, org_id))
            self.assertIsNotNone(db.get(Participant, participant_id))
            self.assertIsNotNone(db.get(User, admin_id))

            # Orders are preserved (financial history), even if their items were removed.
            self.assertEqual(len(db.scalars(select(Order)).all()), 2)

    def test_delete_removes_all_related_records(self) -> None:
        with Session(self.engine) as db:
            event, admin = self._seed_full_event(db)
            event_id = event.id

            delete_archived_event(db, event, admin.id)
            db.commit()

            # Event and all event-scoped children are gone.
            self.assertIsNone(db.get(Event, event_id))
            for model in (
                Registration,
                Match,
                Court,
                TournamentRound,
                EventCategory,
                Ticket,
                RaceResult,
                AllocationHistory,
            ):
                remaining = db.scalars(
                    select(model).where(model.event_id == event_id)
                ).all()
                self.assertEqual(remaining, [], f"{model.__name__} not fully deleted")

            # Registration children gone.
            self.assertEqual(db.scalars(select(Payment)).all(), [])
            self.assertEqual(db.scalars(select(OrderItem)).all(), [])
            self.assertEqual(db.scalars(select(Checkin)).all(), [])
            self.assertEqual(db.scalars(select(RegistrationParticipant)).all(), [])

            # Email log preserved but detached.
            emails = db.scalars(select(EmailLog)).all()
            self.assertEqual(len(emails), 1)
            self.assertIsNone(emails[0].event_id)

            # Audit record written.
            audit = db.scalars(
                select(AuditLog).where(AuditLog.action == "event_permanently_deleted")
            ).all()
            self.assertEqual(len(audit), 1)


if __name__ == "__main__":
    unittest.main()
