from __future__ import annotations

import hashlib
import unittest
import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.services.auth_service import hash_opaque_token
from app.services.ticket_service import serialize_ticket, ticket_qr_payload, ticket_token_for_registration
from db import Base
from models import Registration


class TicketServiceTests(unittest.TestCase):
    def test_confirmed_ticket_is_stable_and_qr_payload_has_no_participant_or_payment_data(self) -> None:
        registration = Registration(
            id=uuid.uuid4(),
            confirmation_token_hash=hashlib.sha256(b"high-entropy-confirmation-hash").hexdigest(),
            status="confirmed",
            ticket_token_hash=None,
        )
        token = ticket_token_for_registration(registration)
        registration.ticket_token_hash = hash_opaque_token(token)

        first = serialize_ticket(registration)
        second = serialize_ticket(registration)

        self.assertIsNotNone(first)
        self.assertEqual(first, second)
        payload = ticket_qr_payload(token)
        self.assertNotIn("Runner Name", payload)
        self.assertNotIn("UTR123456", payload)
        self.assertNotIn("runner@example.test", payload)
        self.assertNotIn("10000", payload)
        self.assertTrue(first["qrDataUrl"].startswith("data:image/svg+xml;base64,"))

    def test_rejected_registration_has_no_ticket(self) -> None:
        registration = Registration(
            id=uuid.uuid4(),
            confirmation_token_hash=hashlib.sha256(b"another-confirmation-hash").hexdigest(),
            status="rejected",
            ticket_token_hash=hash_opaque_token("some-token"),
        )
        self.assertIsNone(serialize_ticket(registration))

    def test_ticket_tokens_differ_for_different_registrations(self) -> None:
        first = Registration(
            id=uuid.uuid4(),
            confirmation_token_hash=hashlib.sha256(b"same-confirmation-hash").hexdigest(),
            status="confirmed",
        )
        second = Registration(
            id=uuid.uuid4(),
            confirmation_token_hash=first.confirmation_token_hash,
            status="confirmed",
        )
        self.assertNotEqual(ticket_token_for_registration(first), ticket_token_for_registration(second))

    def test_ticket_service_models_can_create_rate_limit_table(self) -> None:
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            self.assertIsNotNone(db)


if __name__ == "__main__":
    unittest.main()
