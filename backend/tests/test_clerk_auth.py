from __future__ import annotations

import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.services.auth_service import hash_password
from app.services.clerk_auth import ClerkIdentity, ClerkIdentityConflict, ClerkAuthenticationError, resolve_local_user
from db import Base
from models import User


class ClerkIdentityResolutionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(cls.engine)

    def identity(self, clerk_id="user_test", email="runner@example.test"):
        return ClerkIdentity(clerk_id, email, "Runner Test")

    def test_existing_user_is_linked_without_changing_local_id(self):
        with Session(self.engine) as db:
            user = User(name="Legacy", email="runner@example.test", normalized_email="runner@example.test", password_hash=hash_password("legacy password"), role="participant", is_active=True)
            db.add(user); db.flush(); local_id = user.id
            resolved = resolve_local_user(db, self.identity()); db.commit()
            self.assertEqual(resolved.id, local_id)
            self.assertEqual(resolved.clerk_user_id, "user_test")
            self.assertEqual(db.scalar(select(func.count()).select_from(User).where(User.email == "runner@example.test")), 1)

    def test_repeat_and_new_provisioning_are_idempotent(self):
        with Session(self.engine) as db:
            first = resolve_local_user(db, self.identity("user_repeat", "repeat@example.test")); db.commit()
            second = resolve_local_user(db, self.identity("user_repeat", "repeat@example.test")); db.commit()
            self.assertEqual(first.id, second.id)
            self.assertEqual(db.scalar(select(func.count()).select_from(User).where(User.clerk_user_id == "user_repeat")), 1)

    def test_already_linked_email_does_not_merge(self):
        with Session(self.engine) as db:
            db.add(User(name="One", email="ambiguous@example.test", normalized_email="ambiguous@example.test", clerk_user_id="user_other", password_hash=hash_password("legacy password"), role="participant", is_active=True))
            db.commit()
            with self.assertRaises(ClerkIdentityConflict):
                resolve_local_user(db, self.identity("user_ambiguous", "ambiguous@example.test"))

    def test_deactivated_user_is_not_resolved(self):
        with Session(self.engine) as db:
            db.add(User(name="Inactive", email="inactive@example.test", normalized_email="inactive@example.test", password_hash=hash_password("legacy password"), role="participant", is_active=False, clerk_user_id="user_inactive")); db.commit()
            with self.assertRaises(ClerkAuthenticationError):
                resolve_local_user(db, self.identity("user_inactive", "inactive@example.test"))


if __name__ == "__main__":
    unittest.main()
