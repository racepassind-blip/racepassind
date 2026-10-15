from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from starlette.requests import Request
from starlette.responses import Response

from app.api.v1.auth import DeleteAccountIn, OrganizerApplicationIn, RegisterIn, delete_my_account, organizer_signup
from app.services.auth_service import hash_password
from db import Base
from models import OrganizerApplication, Organization, User


def test_organizer_signup_waits_for_admin_approval():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    request = Request({"type": "http", "headers": [], "client": ("127.0.0.1", 1234)})
    payload = OrganizerApplicationIn(
        organization_name="Cycling Club",
        name="A Rider",
        email="rider@example.test",
        phone="9876543210",
        password="strong-password",
        privacy_policy_accepted=True,
    )
    with Session(engine) as db, patch("app.api.v1.auth.enforce_account_registration_limit"):
        result = organizer_signup(payload, request, None, db)
        assert result["status"] == "pending"
        assert db.scalar(select(func.count(User.id))) == 0
        assert db.scalar(select(func.count(Organization.id))) == 0
        application = db.scalar(select(OrganizerApplication))
        assert application is not None
        assert application.normalized_email == "rider@example.test"
        assert application.password_hash != payload.password
        assert application.privacy_policy_accepted_at is not None

        with pytest.raises(HTTPException) as error:
            organizer_signup(payload, request, None, db)
        assert error.value.status_code == 409


def test_signup_requires_an_explicit_privacy_acceptance():
    with pytest.raises(Exception):
        RegisterIn(name="Runner", email="runner@example.test", password="strong-password")


def test_participant_can_erase_their_account_identifiers():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    request = Request({"type": "http", "headers": [], "client": ("127.0.0.1", 1234)})
    with Session(engine) as db:
        user = User(name="Runner", email="runner@example.test", normalized_email="runner@example.test", password_hash=hash_password("strong-password"), role="participant", is_active=True)
        db.add(user)
        db.commit()
        result = delete_my_account(DeleteAccountIn(password="strong-password", confirmation="DELETE"), Response(), request, None, db, user)
        assert result == {"status": "erased"}
        db.refresh(user)
        assert not user.is_active
        assert user.name == "Deleted user"
        assert user.phone is None
        assert user.email.endswith("@erased.sportpass.invalid")
