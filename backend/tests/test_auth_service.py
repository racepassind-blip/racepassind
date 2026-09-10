from __future__ import annotations

import unittest

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.services.auth_service import (
    create_session,
    hash_password,
    normalize_email,
    normalize_phone,
    verify_password,
)
from db import Base
from models import User


class AuthServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(cls.engine)

    def test_password_hash_is_verifiable_and_not_plaintext(self) -> None:
        encoded = hash_password("correct horse battery staple")
        self.assertNotIn("correct horse battery staple", encoded)
        self.assertTrue(verify_password("correct horse battery staple", encoded))
        self.assertFalse(verify_password("wrong password", encoded))

    def test_contact_normalization(self) -> None:
        self.assertEqual(normalize_email("  RUNNER@Example.COM "), "runner@example.com")
        self.assertEqual(normalize_phone("+91 98765 43210"), "919876543210")
        self.assertIsNone(normalize_phone("---"))

    def test_session_token_is_stored_only_as_a_hash(self) -> None:
        with Session(self.engine) as db:
            user = User(
                name="Test Runner",
                email="runner@example.test",
                normalized_email="runner@example.test",
                password_hash=hash_password("correct horse battery staple"),
                role="participant",
                is_active=True,
            )
            db.add(user)
            db.flush()
            raw_session, csrf_token = create_session(db, user, user_agent="unit-test", ip_address="127.0.0.1")
            db.commit()

            stored = db.scalar(select(User).where(User.email == "runner@example.test"))
            self.assertIsNotNone(stored)
            self.assertTrue(raw_session)
            self.assertTrue(csrf_token)
            self.assertNotEqual(raw_session, stored.sessions[0].token_hash)


if __name__ == "__main__":
    unittest.main()
