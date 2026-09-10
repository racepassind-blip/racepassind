from __future__ import annotations

import datetime as dt
import unittest

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.services.auth_service import hash_opaque_token
from app.services.checkin_service import (
    CheckinCredentialError,
    CheckinNotAllowedError,
    check_in_registration,
    parse_ticket_credential,
)
from app.services.ticket_service import ticket_qr_payload, ticket_token_for_registration
from db import Base
from models import AuditLog, Checkin, Event, Organization, OrganizationMember, Participant, Registration, Ticket, User


class CheckinServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)

    def tearDown(self) -> None:
        self.engine.dispose()

    def _fixture(self, db: Session, *, status: str = "confirmed", suffix: str = "") -> tuple[User, User, Registration]:
        unique = suffix or "default"
        organizer = User(
            name=f"Checkin Organizer {unique}",
            email=f"checkin-owner-{unique}@example.test",
            normalized_email=f"checkin-owner-{unique}@example.test",
            password_hash="test-hash",
            role="organizer",
            is_active=True,
        )
        other = User(
            name=f"Other Organizer {unique}",
            email=f"checkin-other-{unique}@example.test",
            normalized_email=f"checkin-other-{unique}@example.test",
            password_hash="test-hash",
            role="organizer",
            is_active=True,
        )
        organization = Organization(name="Checkin Events", status="active")
        other_organization = Organization(name="Other Events", status="active")
        db.add_all([organizer, other, organization, other_organization])
        db.flush()
        db.add_all([
            OrganizationMember(organization_id=organization.id, user_id=organizer.id, member_role="organizer"),
            OrganizationMember(organization_id=other_organization.id, user_id=other.id, member_role="organizer"),
        ])
        event = Event(
            organization_id=organization.id,
            name="Checkin 10K",
            description="Checkin event",
            category="running",
            location_name="Bengaluru",
            country="India",
            max_participants=100,
            status="published",
            start_date=dt.datetime(2026, 10, 10, tzinfo=dt.timezone.utc),
            distance="10 km",
            participants=1,
            rules=[],
        )
        db.add(event)
        db.flush()
        ticket = Ticket(
            event_id=event.id,
            name="Regular",
            description="Race ticket",
            price=10000,
            currency="INR",
            quantity_total=100,
            quantity_sold=1,
            quantity_reserved=0,
            is_active=True,
        )
        participant = Participant(name="Runner", email="runner@example.test", normalized_email="runner@example.test")
        db.add_all([ticket, participant])
        db.flush()
        registration = Registration(
            event_id=event.id,
            participant_id=participant.id,
            ticket_id=ticket.id,
            status=status,
            payment_status="approved" if status == "confirmed" else "rejected",
            quantity=1,
            unit_price_paise=10000,
            total_amount_paise=10000,
            registration_reference=f"RP-CHECKIN-{unique.upper()}-001",
            confirmation_token_hash=f"confirmation-hash-checkin-{unique}",
        )
        db.add(registration)
        db.flush()
        registration.ticket_token_hash = hash_opaque_token(ticket_token_for_registration(registration))
        db.commit()
        return organizer, other, registration

    def test_qr_and_reference_checkin_are_idempotent(self) -> None:
        with Session(self.engine) as db:
            organizer, _, registration = self._fixture(db)
            token = ticket_token_for_registration(registration)
            self.assertEqual(parse_ticket_credential(ticket_qr_payload(token)), token)

            first = check_in_registration(db, organizer, credential=ticket_qr_payload(token), device_info="Browser\nInjected")
            self.assertFalse(first["alreadyCheckedIn"])
            self.assertEqual(first["status"], "checked_in")
            self.assertEqual(first["registrationReference"], registration.registration_reference)

            second = check_in_registration(db, organizer, registration_reference=registration.registration_reference)
            self.assertTrue(second["alreadyCheckedIn"])
            self.assertEqual(second["checkedInAt"], first["checkedInAt"])
            self.assertEqual(db.scalar(select(Checkin).where(Checkin.registration_id == registration.id)).device_info, "Browser Injected")
            self.assertEqual(db.scalar(select(Registration).where(Registration.id == registration.id)).status, "checked_in")
            actions = db.scalars(select(AuditLog.action).where(AuditLog.resource_id == str(registration.id))).all()
            self.assertIn("participant_checked_in", actions)
            self.assertIn("participant_check_in_duplicate", actions)

    def test_invalid_and_wrong_organizer_credentials_do_not_mutate(self) -> None:
        with Session(self.engine) as db:
            organizer, other, registration = self._fixture(db)
            token = ticket_token_for_registration(registration)
            with self.assertRaises(CheckinCredentialError):
                check_in_registration(db, other, credential=token)
            with self.assertRaises(CheckinCredentialError):
                check_in_registration(db, organizer, credential="racepass://ticket?v=1&t=not-a-valid-token")
            current = db.get(Registration, registration.id)
            self.assertEqual(current.status, "confirmed")
            self.assertFalse(current.checked_in)
            self.assertEqual(db.scalars(select(Checkin)).all(), [])

    def test_unconfirmed_and_rejected_registrations_are_denied(self) -> None:
        with Session(self.engine) as db:
            organizer, _, registration = self._fixture(db, status="pending_verification")
            with self.assertRaises(CheckinNotAllowedError):
                check_in_registration(db, organizer, registration_reference=registration.registration_reference)
            self.assertFalse(db.get(Registration, registration.id).checked_in)

        with Session(self.engine) as db:
            organizer, _, registration = self._fixture(db, status="rejected", suffix="rejected")
            with self.assertRaises(CheckinNotAllowedError):
                check_in_registration(db, organizer, registration_reference=registration.registration_reference)

    def test_parser_rejects_wrong_version_duplicate_or_malformed_qr(self) -> None:
        invalid_values = [
            "racepass://ticket?v=2&t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "racepass://ticket?v=1&t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&t=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            "racepass://other?v=1&t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "not-a-token",
        ]
        for value in invalid_values:
            with self.subTest(value=value), self.assertRaises(CheckinCredentialError):
                parse_ticket_credential(value)


if __name__ == "__main__":
    unittest.main()
