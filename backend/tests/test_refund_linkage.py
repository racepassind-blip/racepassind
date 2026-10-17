import csv
import datetime as dt
import io
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.api.deps import get_current_user
from app.api.v1.refunds import router
from app.services.checkin_service import check_in_registration, CheckinNotAllowedError
from app.services.refund_service import create_manual_refund, confirm_refund_received, serialize_refund
from app.services.cashfree_refunds import reconcile_cashfree_refund
from app.services.ticket_service import serialize_ticket, ticket_token_for_registration
from db import Base, get_db
from models import CreditTransaction, Event
from tests import test_checkin_service as checkin_fixtures


@pytest.fixture
def setup():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    # Match production's autoflush=False: refund completion must explicitly flush.
    with Session(engine, autoflush=False) as db:
        owner, other, registration = checkin_fixtures.CheckinServiceTests()._fixture(db)
        yield db, owner, other, registration
    engine.dispose()


def create(db, owner, registration, amount=10000, linked=True):
    return create_manual_refund(db, organizer_id=db.get(Event, registration.event_id).organization_id,
        event_id=registration.event_id, registration_id=registration.id if linked else None,
        participant_name="=unsafe", participant_contact=None, amount_paise=amount,
        refund_reason="Cannot attend", notes=None, refund_utr="UPI-123", actor_user_id=owner.id)


@pytest.mark.parametrize("amount,expected,admitted", [(10000, "refunded", False), (5000, "partially_refunded", True)])
def test_linked_upi_completion_and_ticket_access(setup, amount, expected, admitted):
    db, owner, _, reg = setup
    token = ticket_token_for_registration(reg)
    refund = create(db, owner, reg, amount)
    assert not refund.is_manual_refund
    assert refund.original_total_paid == 10000
    confirm_refund_received(db, refund_id=refund.id, actor_user_id=owner.id)
    assert reg.payment_status == expected
    assert (serialize_ticket(reg) is not None) == admitted
    if admitted:
        assert check_in_registration(db, owner, credential=token)["status"] == "checked_in"
    else:
        for args in ({"credential": token}, {"registration_reference": reg.registration_reference}):
            with pytest.raises(CheckinNotAllowedError, match="fully refunded"):
                check_in_registration(db, owner, **args)
    assert db.scalars(select(CreditTransaction)).all() == []
    assert serialize_refund(refund)["creditFeeTreatment"] == "retained"


def test_full_refund_also_blocks_already_scanned_ticket(setup):
    db, owner, _, reg = setup
    check_in_registration(db, owner, registration_reference=reg.registration_reference)
    refund = create(db, owner, reg)
    confirm_refund_received(db, refund_id=refund.id, actor_user_id=owner.id)
    with pytest.raises(CheckinNotAllowedError):
        check_in_registration(db, owner, registration_reference=reg.registration_reference)


def test_manual_amount_cap_and_unlinked_audit_record(setup):
    db, owner, _, reg = setup
    with pytest.raises(ValueError, match="original amount"):
        create(db, owner, reg, 10001)
    db.rollback()
    refund = create(db, owner, reg, 1000, linked=False)
    assert refund.is_manual_refund
    assert refund.registration_id is None
    assert reg.payment_status == "approved"


@pytest.mark.parametrize("amount,expected", [(10000, "refunded"), (2500, "partially_refunded")])
def test_gateway_success_updates_refund_and_registration_atomically(setup, amount, expected):
    db, owner, _, reg = setup
    refund = create(db, owner, reg, amount)
    refund.payment_provider = "CASHFREE"
    refund.status = "APPROVED"
    db.commit()
    body = {"refund_id": f"sp_ref_{refund.id.hex}", "order_id": "test-order", "refund_currency": "INR",
            "refund_amount": amount / 100, "refund_status": "SUCCESS"}
    with patch("app.services.cashfree_refunds.CashfreeGateway") as gateway, \
         patch("app.services.cashfree_refunds._refund_binding", return_value=SimpleNamespace(provider_order_id="test-order")), \
         patch("app.services.email_service.send_cashfree_refund_success_notifications"):
        gateway.return_value.get_refund.return_value = body
        assert reconcile_cashfree_refund(db, refund_id=refund.id, initiate=False) == "SUCCESS"
        assert reconcile_cashfree_refund(db, refund_id=refund.id, initiate=False) == "SUCCESS"
    assert reg.payment_status == expected
    assert refund.status == "REFUNDED"


def test_refund_date_export_pagination_and_organization_scope(setup):
    db, owner, other, reg = setup
    refund = create(db, owner, reg, 5000)
    refund.requested_at = dt.datetime(2026, 10, 16, 18, 30, tzinfo=dt.timezone.utc)
    refund.refunded_at = dt.datetime(2026, 10, 19, 18, 30, tzinfo=dt.timezone.utc)
    db.get(Event, reg.event_id).name = "=unsafe event"
    db.commit()
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: owner
    with TestClient(app) as client:
        params = {"date_from": "2026-10-17", "date_to": "2026-10-17"}
        result = client.get("/organizer/refunds", params=params)
        assert result.status_code == 200, result.text
        assert len(result.json()["refunds"]) == 1
        assert client.get("/organizer/refunds", params={**params, "date_field": "sent"}).json()["refunds"] == []
        exported = client.get("/organizer/refunds", params={**params, "export_csv": True, "limit": 1})
        assert exported.status_code == 200, exported.text
        rows = list(csv.DictReader(io.StringIO(exported.text)))
        assert len(rows) == 1
        assert rows[0]["event"] == "'=unsafe event"
        assert rows[0]["approved_refund_paise"] == "5000"
        assert "+05:30" in rows[0]["requested_at"]
        second = create(db, owner, reg, 2000, linked=False)
        second.requested_at = refund.requested_at
        db.commit()
        page = client.get("/organizer/refunds", params={**params, "limit": 1}).json()
        assert page["hasMore"] is True
        next_page = client.get("/organizer/refunds", params={**params, "limit": 1, "cursor": page["nextCursor"]}).json()
        assert next_page["refunds"][0]["id"] != page["refunds"][0]["id"]
        all_rows = client.get("/organizer/refunds", params={**params, "export_csv": True, "cursor": page["nextCursor"], "limit": 1})
        assert len(list(csv.DictReader(io.StringIO(all_rows.text)))) == 2
        assert client.get("/organizer/refunds", params={"date_from": "2026-10-20", "date_to": "2026-10-17"}).status_code == 422
        assert client.get("/organizer/refunds", params={"date_field": "invalid"}).status_code == 422
        app.dependency_overrides[get_current_user] = lambda: other
        assert client.get("/organizer/refunds").json()["refunds"] == []
        assert len(list(csv.DictReader(io.StringIO(client.get("/organizer/refunds", params={"export_csv": True}).text)))) == 0
        assert client.get("/admin/refunds").status_code == 403
        owner.role = "admin"
        db.commit()
        app.dependency_overrides[get_current_user] = lambda: owner
        assert len(client.get("/admin/refunds", params=params).json()["refunds"]) == 2
        assert len(list(csv.DictReader(io.StringIO(client.get("/admin/refunds", params={**params, "export_csv": True}).text)))) == 2


@pytest.mark.parametrize("amount,expected", [(5000, "partially_refunded"), (10000, "refunded")])
def test_historical_partial_refund_migration(setup, amount, expected):
    db, owner, _, reg = setup
    refund = create(db, owner, reg, amount)
    refund.status = "REFUNDED"
    reg.payment_status = "refunded"
    db.commit()
    path = Path(__file__).parents[1] / "migrations/versions/0084_refund_payment_status.py"
    spec = importlib.util.spec_from_file_location("refund_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with Operations.context(MigrationContext.configure(db.connection())):
        migration.upgrade()
        migration.upgrade()  # data correction is repeatable
    db.expire_all()
    assert reg.payment_status == expected
