from __future__ import annotations

import unittest
import uuid

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.services.refund_service import create_manual_refund
from db import Base
from models import Event, Organization, Participant, Registration, Refund, Ticket


class ManualRefundAuthorizationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(cls.engine)

    def _event_with_registration(self, db: Session, organization: Organization, name: str):
        event = Event(
            organization=organization,
            name=name,
            description="Test event",
            category="running",
            max_participants=100,
            status="published",
            distance="5 km",
            rules=[],
        )
        participant = Participant(name=f"{name} participant", email=f"{uuid.uuid4()}@example.test")
        db.add_all([event, participant])
        db.flush()
        ticket = Ticket(
            event_id=event.id,
            name="General",
            description="Test ticket",
            price=10000,
            currency="INR",
            quantity_total=100,
        )
        db.add(ticket)
        db.flush()
        registration = Registration(
            event_id=event.id,
            participant_id=participant.id,
            ticket_id=ticket.id,
            status="confirmed",
            payment_status="approved",
            total_amount_paise=10000,
        )
        db.add(registration)
        db.flush()
        return event, registration

    def _create_refund(self, db: Session, *, organization_id, event_id, registration_id):
        return create_manual_refund(
            db,
            organizer_id=organization_id,
            event_id=event_id,
            registration_id=registration_id,
            participant_name="Entered manually",
            participant_contact=None,
            amount_paise=1000,
            refund_reason="Customer request",
            notes=None,
            refund_utr=None,
            actor_user_id=uuid.uuid4(),
        )

    def test_registration_must_belong_to_selected_event(self) -> None:
        with Session(self.engine) as db:
            organization = Organization(name="Organizer", status="active")
            db.add(organization)
            db.flush()
            event, registration = self._event_with_registration(db, organization, "Owned event")
            other_event, _ = self._event_with_registration(db, organization, "Other event")
            db.commit()

            with self.assertRaisesRegex(ValueError, "Registration not found"):
                self._create_refund(
                    db,
                    organization_id=organization.id,
                    event_id=other_event.id,
                    registration_id=registration.id,
                )
            self.assertEqual(db.scalars(select(Refund)).all(), [])

    def test_registration_must_belong_to_organizers_organization(self) -> None:
        with Session(self.engine) as db:
            owner = Organization(name="Owner", status="active")
            other = Organization(name="Other", status="active")
            db.add_all([owner, other])
            db.flush()
            event, _ = self._event_with_registration(db, owner, "Owner event")
            _, registration = self._event_with_registration(db, other, "Other event")
            db.commit()

            with self.assertRaisesRegex(ValueError, "Registration not found"):
                self._create_refund(
                    db,
                    organization_id=owner.id,
                    event_id=event.id,
                    registration_id=registration.id,
                )
            self.assertEqual(db.scalars(select(Refund)).all(), [])

    def test_valid_registration_link_is_preserved(self) -> None:
        with Session(self.engine) as db:
            organization = Organization(name="Organizer", status="active")
            db.add(organization)
            db.flush()
            event, registration = self._event_with_registration(db, organization, "Owned event")
            db.commit()

            refund = self._create_refund(
                db,
                organization_id=organization.id,
                event_id=event.id,
                registration_id=registration.id,
            )
            self.assertEqual(refund.registration_id, registration.id)
            self.assertEqual(refund.participant_id, registration.participant_id)


if __name__ == "__main__":
    unittest.main()
