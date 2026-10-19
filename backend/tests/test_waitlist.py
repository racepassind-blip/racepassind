import datetime as dt
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from db import Base, get_db
from models import EventPaymentSettings, Registration, WaitlistEntry
from schemas import EventOut
from tests.test_sport_isolation import make_event, register
from app.api.deps import require_csrf, get_current_user, get_optional_current_user
from app.api.v1 import registrations, organizer, public_events
from app.infrastructure.storage.factory import get_storage_service
from app.config import get_settings
from app.schemas.registrations import WaitlistCreateIn, BatchRegistrationCreateIn
from app.services.registration_service import create_guest_batch_registration, _capacity_used
from app.services.waitlist_service import join, promote, resolve, token_for, expire_offers, send_notifications, recover_once
from app.services.auth_service import utc_now


@pytest.fixture
def context():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        event, user, _ = make_event(db, "trekking", quantity=1)
        event.max_participants = 1
        event.waitlist_enabled = True
        db.commit()
        registered = register(db, event)
        yield db, event, user, registered
    engine.dispose()


def queued(db, event, number=1):
    return join(db, WaitlistCreateIn(event_id=event.id, ticket_id=event.tickets[0].id,
                name=f"Walker {number}", email=f"walker{number}@example.test"))


def open_place(db, event, registered):
    registered.status = "cancelled"
    event.tickets[0].quantity_sold -= 1
    event.participants -= 1
    db.commit()


def checkout(entry, *, accepted=None, email=None):
    return BatchRegistrationCreateIn(event_id=entry.event_id, waitlist_token=token_for(entry), entries=[{
        "ticket_id": entry.ticket_id, "email": email or entry.email, "phone": "9876543210",
        "participants": [{"responses": {"full_name": entry.name, **({"waiver_accepted": accepted} if accepted is not None else {})}}],
    }])


def test_http_join_public_flags_and_organizer_invitation(context):
    db, event, user, registered = context
    app = FastAPI()
    app.include_router(public_events.router)
    app.include_router(registrations.router)
    app.include_router(organizer.router, prefix="/organizer")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_csrf] = lambda: None
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_optional_current_user] = lambda: None
    app.dependency_overrides[get_storage_service] = lambda: None
    client = TestClient(app)
    response = client.get(f"/events/{event.id}")
    assert response.status_code == 200
    assert response.json()["waitlistEnabled"] and response.json()["waitlistOpen"]
    response = client.post("/waitlist", json={"event_id": str(event.id), "name": "Walker", "email": "walker@example.test", "ticket_id": str(event.tickets[0].id)})
    assert response.status_code == 201
    entry_id = response.json()["id"]
    open_place(db, event, registered)
    response = client.post(f"/organizer/waitlist/{entry_id}/promote", json={"waive_payment": True})
    assert response.status_code == 200 and response.json()["status"] == "offered"
    entry = db.scalar(select(WaitlistEntry))
    token = token_for(entry)
    assert client.post("/waitlist/offer", json={"token": token}).json()["waivePayment"]
    with patch("app.api.v1.registrations._send_confirmation_email_background"):
        result = client.post("/registrations/batch", json=checkout(entry).model_dump(mode="json"), headers={"Idempotency-Key": "waitlist-http"})
    assert result.status_code == 201, result.text
    assert result.json()["status"] == "confirmed"
    assert event.tickets[0].quantity_sold == 1 and event.tickets[0].quantity_reserved == 0


def test_disabled_closed_invalid_and_duplicates(context):
    db, event, _, _ = context
    with pytest.raises(ValidationError):
        WaitlistCreateIn(event_id=event.id, name="Walker", email="bad-email")
    event.waitlist_enabled = False
    db.commit()
    with pytest.raises(ValueError, match="not open"):
        queued(db, event)
    event.waitlist_enabled = True
    event.registration_status = "closed"
    db.commit()
    with pytest.raises(ValueError, match="not open"):
        queued(db, event)
    event.registration_status = "open"
    db.commit()
    first = queued(db, event)
    assert queued(db, event).id == first.id
    assert queued(db, event, 2).position == 2


def test_ticket_capacity_and_pending_capacity_agree_with_public(context):
    db, event, _, registered = context
    event.max_participants = 20
    db.commit()
    assert queued(db, event).position == 1  # Ticket stock exhausted, even below event limit.
    event.tickets[0].quantity_total = 20
    event.max_participants = 1
    registered.status = "awaiting_payment"
    event.participants = 0
    db.commit()
    assert public_events._public_event(event)["waitlistOpen"]


def test_fifo_holds_and_retry(context):
    db, event, user, registered = context
    first, second = queued(db, event), queued(db, event, 2)
    open_place(db, event, registered)
    with pytest.raises(ValueError, match="first waiting"):
        promote(db, user, second.id)
    promote(db, user, first.id)
    promote(db, user, first.id)
    assert event.tickets[0].quantity_reserved == 1
    assert _capacity_used(db, event.id) == 1
    with pytest.raises(ValueError, match="No participant place"):
        promote(db, user, second.id)


def test_waiver_rollback_then_waived_checkout(context):
    db, event, user, registered = context
    entry = queued(db, event)
    open_place(db, event, registered)
    event.field_config = {**event.field_config, "waiver": {"enabled": True, "title": "Declaration", "text": "Accept the trek risks"}}
    event.tickets[0].price = 50000
    db.commit()
    promote(db, user, entry.id, waive_payment=True)
    with pytest.raises(ValueError, match="waiver"):
        create_guest_batch_registration(db, checkout(entry, accepted=False), idempotency_key="waiver-retry")
    db.rollback()
    assert entry.status == "offered" and event.tickets[0].quantity_reserved == 1
    with pytest.raises(ValueError, match="email address"):
        create_guest_batch_registration(db, checkout(entry, email="other@example.test"), idempotency_key="wrong-email")
    db.rollback()
    result, tokens, _ = create_guest_batch_registration(db, checkout(entry, accepted=True), idempotency_key="waiver-retry")
    assert result[0].status == "confirmed" and result[0].participant_total_paise == 0
    assert result[0].computed_total["waivedOriginalTotalPaise"] == 50000
    assert entry.registration_id == result[0].id
    assert event.tickets[0].quantity_sold == 1 and event.tickets[0].quantity_reserved == 0
    replay, _, _ = create_guest_batch_registration(db, checkout(entry), idempotency_key="waiver-retry")
    assert replay[0].id == result[0].id
    with pytest.raises(ValueError, match="already been used"):
        create_guest_batch_registration(db, checkout(entry), idempotency_key="different-key")


@pytest.mark.parametrize("method", ["DIRECT_UPI", "CASHFREE_MANAGED"])
def test_paid_checkout_uses_existing_payment_flow(context, method):
    db, event, user, registered = context
    entry = queued(db, event)
    open_place(db, event, registered)
    event.tickets[0].price = 10000
    event.payment_collection_method = method
    event.payment_settings = EventPaymentSettings(method="manual_upi", upi_id="test@bank", payee_name="Organizer", is_active=True)
    db.commit()
    promote(db, user, entry.id)
    settings = replace(get_settings(), cashfree_client_id="test", cashfree_client_secret="test", cashfree_enabled=True, cashfree_webhook_url="https://example.test/api/v1/webhooks/cashfree")
    with patch("app.services.registration_service.assert_paid_event_available"), patch("app.services.registration_service.validate_manual_upi_settings"), patch("app.services.registration_service.get_settings", return_value=settings):
        result, tokens, _ = create_guest_batch_registration(db, checkout(entry), idempotency_key=f"paid-{method}")
    assert result[0].status == "awaiting_payment" and tokens[0]
    assert result[0].payment.payment_gateway == ("cashfree" if method == "CASHFREE_MANAGED" else "manual_upi")
    assert result[0].participant_total_paise == 10000
    assert entry.status == "booked" and event.tickets[0].quantity_reserved == 1


def test_expiry_releases_once_and_worker_invites_next(context):
    db, event, user, registered = context
    first, second = queued(db, event), queued(db, event, 2)
    open_place(db, event, registered)
    promote(db, user, first.id)
    first.payment_due_at = utc_now() - dt.timedelta(seconds=1)
    db.commit()
    with pytest.raises(ValueError, match="expired"):
        create_guest_batch_registration(db, checkout(first), idempotency_key="late")
    db.rollback()
    with patch("app.services.waitlist_service.send_notifications"):
        recover_once(sessionmaker(bind=db.bind))
        recover_once(sessionmaker(bind=db.bind))
    db.expire_all()
    assert first.status == "expired" and second.status == "offered"
    assert event.tickets[0].quantity_reserved == 1


def test_email_failure_retry_secure_link_and_no_duplicate_success(context):
    db, event, user, registered = context
    entry = queued(db, event)
    open_place(db, event, registered)
    promote(db, user, entry.id)
    with patch("app.services.email_service.send_email", return_value=SimpleNamespace(success=False)) as failed:
        send_notifications(db, entry)
    assert not entry.joined_email_sent and not entry.offer_email_sent
    entry.email_retry_after = utc_now() - dt.timedelta(seconds=1)
    db.commit()
    with patch("app.services.email_service.send_email", return_value=SimpleNamespace(success=True)) as sent:
        send_notifications(db, entry)
        assert len(sent.call_args_list) == 2
        assert "#waitlist=" in sent.call_args_list[-1].kwargs["body"]
        send_notifications(db, entry)
        assert sent.call_count == 2
    with pytest.raises(ValueError, match="Invalid"):
        resolve(db, token_for(entry)[:-1] + ("0" if token_for(entry)[-1] != "0" else "1"))


def test_other_organizer_cannot_promote(context):
    from fastapi import HTTPException
    db, event, _, _ = context
    entry = queued(db, event)
    _, other, _ = make_event(db, "trekking")
    other.role = "organizer"
    db.commit()
    with pytest.raises(HTTPException):
        promote(db, other, entry.id)
