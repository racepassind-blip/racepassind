from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from starlette.requests import Request

from app.api.v1.auth import OrganizerApplicationIn, organizer_signup
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

        with pytest.raises(HTTPException) as error:
            organizer_signup(payload, request, None, db)
        assert error.value.status_code == 409
