from __future__ import annotations

import unittest
import uuid

from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from db import Base
from models import Event, Participant, Registration, Ticket


class AllocationUniquenessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(cls.engine)

    def test_allocation_number_is_unique_within_event(self) -> None:
        with Session(self.engine) as db:
            event = Event(
                organization_id=uuid.uuid4(),
                name="Race",
                description="Test event",
                category="running",
                max_participants=10,
                status="published",
                distance="5 km",
                rules=[],
            )
            db.add(event)
            db.flush()
            ticket = Ticket(event_id=event.id, name="General", description="Entry", price=1000, currency="INR", quantity_total=10)
            participants = [Participant(name=f"Runner {index}", email=f"runner-{uuid.uuid4()}@example.test") for index in range(2)]
            db.add_all([ticket, *participants])
            db.flush()
            db.add_all(
                [
                    Registration(event_id=event.id, participant_id=participant.id, ticket_id=ticket.id, status="confirmed", allocation_number=42, allocation_status="draft")
                    for participant in participants
                ]
            )
            with self.assertRaises(IntegrityError):
                db.commit()

    def test_same_number_is_allowed_in_different_events(self) -> None:
        with Session(self.engine) as db:
            events = [
                Event(
                    organization_id=uuid.uuid4(),
                    name=f"Race {index}",
                    description="Test event",
                    category="running",
                    max_participants=10,
                    status="published",
                    distance="5 km",
                    rules=[],
                )
                for index in range(2)
            ]
            db.add_all(events)
            db.flush()
            tickets = [Ticket(event_id=event.id, name="General", description="Entry", price=1000, currency="INR", quantity_total=10) for event in events]
            participants = [Participant(name=f"Runner {index}", email=f"runner-{uuid.uuid4()}@example.test") for index in range(2)]
            db.add_all([*tickets, *participants])
            db.flush()
            db.add_all(
                [
                    Registration(event_id=event.id, participant_id=participant.id, ticket_id=ticket.id, status="confirmed", allocation_number=7, allocation_status="draft")
                    for event, ticket, participant in zip(events, tickets, participants)
                ]
            )
            db.commit()


if __name__ == "__main__":
    unittest.main()
