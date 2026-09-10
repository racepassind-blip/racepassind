from __future__ import annotations

import datetime as dt
import unittest
import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.services.auth_service import hash_opaque_token, utc_now
from app.services.registration_service import claim_registration, list_my_registrations
from db import Base
from models import Event, EventCategory, Organization, Participant, Registration, Ticket, User


class RegistrationClaimTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(cls.engine)

    def _user(self, db: Session, suffix: str, *, email_verified: bool = False, phone: str | None = None, phone_verified: bool = False) -> User:
        now = utc_now()
        user = User(
            name=f"Runner {suffix}",
            email=f"runner-{suffix}@example.test",
            normalized_email=f"runner-{suffix}@example.test",
            phone=phone,
            normalized_phone=phone,
            email_verified_at=now if email_verified else None,
            phone_verified_at=now if phone_verified else None,
            password_hash="test-hash",
            role="participant",
            is_active=True,
        )
        db.add(user)
        db.flush()
        return user

    def _registration(self, db: Session, *, participant_email: str, participant_phone: str | None = None, claim_code: str = "CLAIM123", expired: bool = False):
        organization = Organization(name=f"Org {uuid.uuid4().hex[:6]}", status="active")
        db.add(organization)
        db.flush()
        event = Event(
            organization=organization,
            name="Claimable 10K",
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
        category = EventCategory(event_id=event.id, name="10K", distance="10 km")
        db.add(category)
        db.flush()
        ticket = Ticket(
            event_id=event.id,
            category_id=category.id,
            name="Regular",
            description="Race entry",
            price=10000,
            currency="INR",
            quantity_total=10,
            quantity_reserved=0,
            quantity_sold=1,
            is_active=True,
        )
        participant = Participant(
            name="Guest Runner",
            email=participant_email,
            normalized_email=participant_email,
            phone=participant_phone,
            normalized_phone=participant_phone,
        )
        db.add_all([ticket, participant])
        db.flush()
        registration = Registration(
            event_id=event.id,
            participant_id=participant.id,
            ticket_id=ticket.id,
            category_id=category.id,
            status="confirmed",
            payment_status="approved",
            quantity=1,
            unit_price_paise=10000,
            total_amount_paise=10000,
            registration_reference=f"RP-{uuid.uuid4().hex[:8].upper()}",
            claim_code_hash=hash_opaque_token(claim_code),
            claim_code_expires_at=utc_now() - dt.timedelta(minutes=1) if expired else utc_now() + dt.timedelta(days=2),
        )
        db.add(registration)
        db.commit()
        return registration, claim_code

    def test_verified_email_auto_links_and_response_is_privacy_safe(self) -> None:
        with Session(self.engine) as db:
            user = self._user(db, "verified", email_verified=True)
            registration, _ = self._registration(db, participant_email=user.normalized_email)

            result = list_my_registrations(db, user)

            self.assertEqual(len(result), 1)
            self.assertEqual(db.get(Registration, registration.id).user_id, user.id)
            self.assertNotIn("utrReference", result[0])
            self.assertNotIn("claimCode", result[0])
            self.assertNotIn("confirmationToken", result[0])

    def test_unverified_phone_does_not_auto_link(self) -> None:
        with Session(self.engine) as db:
            user = self._user(db, "phone", phone="919876543210", phone_verified=False)
            self._registration(db, participant_email="different@example.test", participant_phone=user.normalized_phone)

            self.assertEqual(list_my_registrations(db, user), [])

    def test_claim_is_atomic_and_second_account_cannot_claim(self) -> None:
        with Session(self.engine) as db:
            first_user = self._user(db, "first")
            second_user = self._user(db, "second")
            registration, claim_code = self._registration(db, participant_email="guest@example.test", claim_code="CLAIM999")

            first_result = claim_registration(db, first_user, registration_reference=registration.registration_reference, claim_code=claim_code)
            self.assertEqual(first_result["registrationReference"], registration.registration_reference)
            claimed = db.get(Registration, registration.id)
            self.assertEqual(claimed.user_id, first_user.id)
            self.assertIsNotNone(claimed.claim_code_claimed_at)
            self.assertIsNone(claimed.claim_code_hash)

            with self.assertRaises(ValueError):
                claim_registration(db, second_user, registration_reference=registration.registration_reference, claim_code=claim_code)
            repeated = claim_registration(db, first_user, registration_reference=registration.registration_reference, claim_code="wrong-code")
            self.assertEqual(repeated["registrationReference"], registration.registration_reference)

    def test_expired_claim_is_rejected(self) -> None:
        with Session(self.engine) as db:
            user = self._user(db, "expired")
            registration, claim_code = self._registration(db, participant_email="expired@example.test", claim_code=claim_code_for_test(), expired=True)

            with self.assertRaises(ValueError):
                claim_registration(db, user, registration_reference=registration.registration_reference, claim_code=claim_code)
            self.assertIsNone(db.get(Registration, registration.id).user_id)


def claim_code_for_test() -> str:
    return "EXPIRED1"


if __name__ == "__main__":
    unittest.main()
