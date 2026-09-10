from __future__ import annotations

import datetime as dt
import unittest
import uuid

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.services.registration_service import (
    RegistrationExpiredError,
    decide_registration_payment,
    list_pending_registrations,
)
from db import Base
from models import (
    Event,
    Order,
    OrderItem,
    Organization,
    OrganizationMember,
    Participant,
    Payment,
    Registration,
    Ticket,
    User,
)


class RegistrationDecisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(cls.engine)

    def _create_registration(self, db: Session, *, user: User, organization: Organization, expired: bool = False):
        event = Event(
            organization=organization,
            name="Test 10K",
            description="Test event",
            category="running",
            location_name="Bengaluru",
            country="India",
            max_participants=100,
            status="published",
            distance="10 km",
            participants=0,
            rules=[],
        )
        db.add(event)
        db.flush()
        ticket = Ticket(
            event_id=event.id,
            name="Regular",
            description="Race entry",
            price=10000,
            currency="INR",
            quantity_total=10,
            quantity_sold=0,
            quantity_reserved=1,
            is_active=True,
        )
        participant = Participant(name="Runner", email="runner@example.test", normalized_email="runner@example.test")
        db.add_all([ticket, participant])
        db.flush()
        registration = Registration(
            event_id=event.id,
            participant_id=participant.id,
            ticket_id=ticket.id,
            status="pending_verification",
            payment_status="pending_verification",
            quantity=1,
            unit_price_paise=10000,
            total_amount_paise=10000,
            registration_reference=f"RP-{uuid.uuid4().hex[:8].upper()}",
            reserved_until=dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1) if expired else dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=20),
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
                utr_reference="UTR123456",
            )
        )
        db.commit()
        return registration.id, ticket.id

    def _create_user_and_org(self, db: Session, name: str):
        user = User(
            name=name,
            email=f"{name.lower()}@example.test",
            normalized_email=f"{name.lower()}@example.test",
            password_hash="test-hash",
            role="organizer",
            is_active=True,
        )
        organization = Organization(name=f"{name} Events", status="active")
        db.add_all([user, organization])
        db.flush()
        db.add(OrganizationMember(organization_id=organization.id, user_id=user.id, member_role="organizer"))
        db.commit()
        return user, organization

    def test_organizer_can_list_and_approve_once_without_double_selling(self) -> None:
        with Session(self.engine) as db:
            user, organization = self._create_user_and_org(db, "OrganizerA")
            registration_id, ticket_id = self._create_registration(db, user=user, organization=organization)

            pending = list_pending_registrations(db, user)
            self.assertEqual(len(pending), 1)
            self.assertEqual(pending[0]["paymentStatus"], "pending_verification")

            decide_registration_payment(db, user, registration_id, decision="approve")
            ticket = db.get(Ticket, ticket_id)
            self.assertEqual(ticket.quantity_reserved, 0)
            self.assertEqual(ticket.quantity_sold, 1)

            decide_registration_payment(db, user, registration_id, decision="approve")
            ticket = db.get(Ticket, ticket_id)
            self.assertEqual(ticket.quantity_reserved, 0)
            self.assertEqual(ticket.quantity_sold, 1)
            registration = db.get(Registration, registration_id)
            self.assertEqual(registration.status, "confirmed")

    def test_organizer_cannot_access_another_organizations_registration(self) -> None:
        with Session(self.engine) as db:
            owner, organization = self._create_user_and_org(db, "OwnerA")
            other_user, other_organization = self._create_user_and_org(db, "OwnerB")
            registration_id, ticket_id = self._create_registration(db, user=owner, organization=organization)

            self.assertEqual(list_pending_registrations(db, other_user), [])
            with self.assertRaises(ValueError):
                decide_registration_payment(db, other_user, registration_id, decision="approve")
            ticket = db.get(Ticket, ticket_id)
            self.assertEqual(ticket.quantity_reserved, 1)
            self.assertEqual(ticket.quantity_sold, 0)
            self.assertIsNotNone(other_organization)

    def test_rejection_releases_reservation_and_requires_reason(self) -> None:
        with Session(self.engine) as db:
            user, organization = self._create_user_and_org(db, "OrganizerC")
            registration_id, ticket_id = self._create_registration(db, user=user, organization=organization)

            with self.assertRaises(ValueError):
                decide_registration_payment(db, user, registration_id, decision="reject")
            decide_registration_payment(db, user, registration_id, decision="reject", reason="UTR could not be verified")
            ticket = db.get(Ticket, ticket_id)
            registration = db.get(Registration, registration_id)
            self.assertEqual(ticket.quantity_reserved, 0)
            self.assertEqual(ticket.quantity_sold, 0)
            self.assertEqual(registration.status, "rejected")

    def test_expired_registration_is_released_and_cannot_be_approved(self) -> None:
        with Session(self.engine) as db:
            user, organization = self._create_user_and_org(db, "OrganizerD")
            registration_id, ticket_id = self._create_registration(db, user=user, organization=organization, expired=True)

            with self.assertRaises(RegistrationExpiredError):
                decide_registration_payment(db, user, registration_id, decision="approve")
            ticket = db.get(Ticket, ticket_id)
            registration = db.get(Registration, registration_id)
            self.assertEqual(ticket.quantity_reserved, 0)
            self.assertEqual(registration.status, "expired")


if __name__ == "__main__":
    unittest.main()
