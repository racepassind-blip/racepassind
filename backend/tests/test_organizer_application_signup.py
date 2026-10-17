from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from starlette.requests import Request
from starlette.responses import Response
from starlette.datastructures import Headers, UploadFile
from io import BytesIO

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
    class FakeStorage:
        def put_private(self, *_args, **_kwargs): return "private/test-proof.pdf"
        def remove(self, *_args, **_kwargs): return None

    with Session(engine) as db, patch("app.api.v1.auth.enforce_account_registration_limit"), patch("app.api.v1.auth.get_storage_service", return_value=FakeStorage()), patch("app.api.v1.admin.notify_application_review"):
        proof = UploadFile(filename="club.pdf", file=BytesIO(b"%PDF-1.7 test"), headers=Headers({"content-type": "application/pdf"}))
        result = organizer_signup(request, payload.organization_name, payload.name, payload.email, payload.phone, payload.password, True,
            "RUNNING_CLUB", "12 Main Road", "Mysuru", "Karnataka", "570001", "Weekly 5K runs", "REFERRAL", "DIRECT_UPI", "PAN", proof, None, db, upi_id="club@bank", payee_name="Cycling Club")
        assert result["status"] == "pending"
        assert db.scalar(select(func.count(User.id))) == 0
        assert db.scalar(select(func.count(Organization.id))) == 0
        application = db.scalar(select(OrganizerApplication))
        assert application is not None
        assert application.normalized_email == "rider@example.test"
        assert application.password_hash != payload.password
        assert application.privacy_policy_accepted_at is not None

        with pytest.raises(HTTPException) as error:
            proof = UploadFile(filename="club.pdf", file=BytesIO(b"%PDF-1.7 test"), headers=Headers({"content-type": "application/pdf"}))
            organizer_signup(request, payload.organization_name, payload.name, payload.email, payload.phone, payload.password, True,
                "RUNNING_CLUB", "12 Main Road", "Mysuru", "Karnataka", "570001", "Weekly 5K runs", "REFERRAL", "DIRECT_UPI", "PAN", proof, None, db, upi_id="club@bank", payee_name="Cycling Club")
        assert error.value.status_code == 409

        from app.api.v1.auth import LoginIn, organizer_application_status
        from app.api.v1.admin import ApplicationChangesIn, request_application_changes, approve_organizer_application, read_application_proof
        from models import OrganizationVerificationDocument, AuditLog
        admin = User(name="Reviewer", email="admin@example.test", password_hash=hash_password("admin-password"), role="admin", is_active=True)
        db.add(admin)
        db.commit()
        with patch("app.api.v1.auth.enforce_login_limit"):
            with pytest.raises(HTTPException) as denied:
                organizer_application_status(LoginIn(email=payload.email, password="wrong-password"), request, Response(), None, db)
            assert denied.value.status_code == 401
            response = Response()
            result = organizer_application_status(LoginIn(email=payload.email, password=payload.password), request, response, None, db)
            assert result["status"] == "pending"
            assert result["idProofUrl"] is None
            assert "password_hash" not in result
            assert response.headers["Cache-Control"] == "no-store"
        request_application_changes(application.id, ApplicationChangesIn(reason="Please update the event description"), admin, None, db)
        assert application.status == "changes_requested"
        proof = UploadFile(filename="club.pdf", file=BytesIO(b"%PDF-1.7 test"), headers=Headers({"content-type": "application/pdf"}))
        organizer_signup(request, payload.organization_name, payload.name, payload.email, payload.phone, payload.password, True,
            "RUNNING_CLUB", "12 Main Road", "Mysuru", "Karnataka", "570001", "Monthly cycling and running events", "REFERRAL", "DIRECT_UPI", "PAN", proof, None, db, upi_id="club@bank", payee_name="Cycling Club")
        assert db.scalar(select(func.count(OrganizerApplication.id))) == 1
        assert application.status == "pending"
        result = approve_organizer_application(application.id, admin, None, db)
        assert result["application"]["status"] == "approved"
        organization = db.scalar(select(Organization))
        assert organization.city == "Mysuru"
        assert organization.billing_address == "12 Main Road"
        assert not organization.allow_cashfree and not organization.allow_direct_upi
        assert db.scalar(select(func.count(OrganizationVerificationDocument.id))) == 1
        assert application.password_hash == ""
        with patch("app.api.v1.auth.enforce_login_limit"):
            assert organizer_application_status(LoginIn(email=payload.email, password=payload.password), request, Response(), None, db)["status"] == "approved"
        with pytest.raises(HTTPException) as conflict:
            approve_organizer_application(application.id, admin, None, db)
        assert conflict.value.status_code == 409
        assert db.scalar(select(func.count(AuditLog.id)).where(AuditLog.resource_type == "organizer_application")) >= 4


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


@pytest.fixture
def application_client():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy.pool import StaticPool
    from app.api.v1.auth import router
    from app.api.v1.admin import router as admin_router
    from db import get_db
    from unittest.mock import Mock
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    app = FastAPI()
    app.include_router(router, prefix="/auth")
    app.include_router(admin_router, prefix="/admin")
    storage = Mock()
    storage.put_private.side_effect = ["private/first.pdf", "private/second.pdf"]
    with Session(engine) as db:
        app.dependency_overrides[get_db] = lambda: db
        with patch("app.api.v1.auth.get_storage_service", return_value=storage), patch("app.api.v1.admin.notify_application_review"), patch("app.api.v1.auth.enforce_account_registration_limit"), patch("app.api.v1.auth.enforce_login_limit"):
            with TestClient(app) as client:
                client.cookies.set("racepass_csrf", "test-csrf")
                client.headers["X-CSRF-Token"] = "test-csrf"
                yield client, db, storage, app


def application_form(**overrides):
    return dict(organization_name="Test Club", name="Test Organizer", email="organizer@example.test",
        phone="9876543210", password="test-password", privacy_policy_accepted="true",
        organization_type="RUNNING_CLUB", address="123 Main Street", city="Mysuru", state="Karnataka",
        pincode="570001", event_history="Monthly running events", discovery_source="REFERRAL",
        payment_preference="CASHFREE", legal_name="Test Club", pan_number="ABCDE1234F", id_proof_type="PAN", **overrides)


def test_http_submission_status_rejection_and_admin_boundary(application_client):
    import uuid
    from app.api.v1.admin import reject_organizer_application, OrganizerApplicationDecisionIn, read_application_proof
    client, db, storage, app = application_client
    response = client.post("/auth/organizer-signup", data=application_form(), files={"id_proof": ("proof.pdf", b"%PDF-1.7 test", "application/pdf")})
    assert response.status_code == 201, response.text
    application = db.get(OrganizerApplication, uuid.UUID(response.json()["applicationId"]))
    assert application.payment_details["panNumber"] == "ABCDE1234F"
    assert client.get("/admin/organizer-applications").status_code == 401
    assert client.post(f"/admin/organizer-applications/{application.id}/id-proof", json={}).status_code == 401
    from app.api.deps import get_current_user
    app.dependency_overrides[get_current_user] = lambda: User(role="organizer", is_active=True)
    assert client.get("/admin/organizer-applications").status_code == 403
    assert client.post(f"/admin/organizer-applications/{application.id}/id-proof", json={}).status_code == 403
    app.dependency_overrides.pop(get_current_user)
    admin = User(name="Admin", email="admin@example.test", password_hash="unused", role="admin", is_active=True)
    db.add(admin)
    db.commit()
    storage.get_read_url.return_value = "https://example.test/private-proof"
    read_application_proof(application.id, Response(), admin, None, db, storage)
    storage.get_read_url.assert_called_once_with("private/first.pdf", expires_in=300)
    reject_organizer_application(application.id, OrganizerApplicationDecisionIn(reason="Organization details could not be verified"), admin, None, db)
    response = client.post("/auth/organizer-application/status", json={"email": application.email, "password": "test-password"})
    assert response.status_code == 200
    assert response.json()["status"] == "rejected"
    assert response.json()["rejectionReason"] == "Organization details could not be verified"
    assert response.json()["idProofUrl"] is None
    assert "private/first.pdf" not in response.text
    assert client.post("/auth/organizer-application/status", json={"email": application.email, "password": "incorrect"}).status_code == 401
    client.headers.pop("X-CSRF-Token")
    assert client.post("/auth/organizer-application/status", json={"email": application.email, "password": "test-password"}).status_code == 403


@pytest.mark.parametrize("field,value", [("address", " "), ("pincode", "123"), ("event_history", " "), ("privacy_policy_accepted", "false"), ("pan_number", "invalid"), ("discovery_source", "unknown")])
def test_invalid_applications_never_upload_proof(application_client, field, value):
    client, db, storage, app = application_client
    data = application_form()
    data[field] = value
    response = client.post("/auth/organizer-signup", data=data, files={"id_proof": ("proof.pdf", b"%PDF-1.7 test", "application/pdf")})
    assert response.status_code == 422
    storage.put_private.assert_not_called()
    assert db.scalar(select(func.count(OrganizerApplication.id))) == 0


def test_verification_migration_preserves_legacy_applications():
    import importlib.util
    from pathlib import Path
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import text, inspect
    path = Path(__file__).parents[1] / "migrations/versions/0082_organizer_application_verification.py"
    spec = importlib.util.spec_from_file_location("onboarding_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE organizer_applications (id INTEGER PRIMARY KEY, organization_name TEXT)"))
        connection.execute(text("INSERT INTO organizer_applications VALUES (1, 'Existing Club')"))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            assert "payment_details" in {column["name"] for column in inspect(connection).get_columns("organizer_applications")}
            assert connection.execute(text("SELECT organization_name FROM organizer_applications")).scalar() == "Existing Club"
            migration.downgrade()
            assert len(inspect(connection).get_columns("organizer_applications")) == 2


def test_application_recovery_is_single_use_and_expiring(application_client):
    import hashlib
    import datetime as dt
    client, db, storage, app = application_client
    client.post("/auth/organizer-signup", data=application_form(), files={"id_proof": ("proof.pdf", b"%PDF-1.7 test", "application/pdf")})
    application = db.scalar(select(OrganizerApplication))
    with patch("app.api.v1.auth.enforce_password_reset_request_limit"), patch("app.api.v1.auth.enforce_password_reset_attempt_limit"), patch("app.api.v1.auth.send_email") as email:
        response = client.post("/auth/forgot-password", json={"email": application.email})
        assert response.status_code == 200
        body = email.call_args.kwargs["body"]
        token = body.split("token=")[1].split()[0]
        db.refresh(application)
        assert application.recovery_token_hash == hashlib.sha256(token.encode()).hexdigest()
        response = client.post("/auth/reset-password", json={"token": token, "password": "new-strong-password"})
        assert response.status_code == 200
        assert response.json()["next"] == "/signup?type=organizer&status=1"
        assert client.post("/auth/reset-password", json={"token": token, "password": "another-password"}).status_code == 400
        assert client.post("/auth/organizer-application/status", json={"email": application.email, "password": "test-password"}).status_code == 401
        assert client.post("/auth/organizer-application/status", json={"email": application.email, "password": "new-strong-password"}).status_code == 200
        application.recovery_token_hash = hashlib.sha256(token.encode()).hexdigest()
        application.recovery_expires_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1)
        db.commit()
        assert client.post("/auth/reset-password", json={"token": token, "password": "another-password"}).status_code == 400
