"""Motorcycle V1 exercises existing services with isolated SQLite persistence.

No provider calls, production credentials or schema migrations are used.
"""
import csv
import io
import json
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from db import Base
from models import OrganizationMember, Registration, User
from tests.test_sport_isolation import make_event
from tests import test_cashfree_integration as cashfree_tests
from app.api.v1.allocations import _get_event_or_404, get_sport_allocation_config
from app.api.v1.events import update_operational_features
from app.schemas.events import OperationalFeaturesIn
from app.schemas.registrations import RegistrationCreateIn, BatchRegistrationCreateIn
from app.services.registration_service import (
    create_guest_registration, create_guest_batch_registration, export_organizer_registrations_csv,
    list_organizer_registrations, pickup_point_summary, decide_registration_payment,
)
from app.services.checkin_service import check_in_registration
from app.services.ticket_service import ticket_token_for_registration, ticket_qr_payload


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def rider_fields():
    return [dict(id=key, label=label, type="text", required=True, predefined=False)
            for key, label in [("custom_motorcycle_make_model", "Motorcycle make and model"),
                               ("custom_motorcycle_registration_number", "Motorcycle registration number")]]


def setup_ride(db, *, required=False):
    event, owner, _ = make_event(db, "motorcycle")
    owner.role = "organizer"
    db.add(OrganizationMember(organization_id=event.organization_id, user_id=owner.id, member_role="organizer"))
    event.field_config = {**event.field_config,
        "fields": event.field_config["fields"] + rider_fields(),
        "pickup_points": {"enabled": True, "required": required,
                          "points": [{"id": "gate", "name": "Main gate"}]}}
    db.commit()
    return event, owner


def responses(name="Rider", plate="KA01AB1234"):
    return {"full_name": name, "email": f"{uuid4()}@example.test",
            "custom_motorcycle_make_model": "Honda CB350",
            "custom_motorcycle_registration_number": plate, "pickup_point_id": "gate"}


def register(db, event, answers):
    return create_guest_registration(db, RegistrationCreateIn(
        event_id=event.id, ticket_id=event.categories[0].tickets[0].id,
        responses=answers), idempotency_key=str(uuid4()))[0]


def test_persistence_filter_export_privacy_and_both_checkin_credentials(db):
    event, owner = setup_ride(db)
    registration = register(db, event, responses())
    registration_id = registration.id
    db.expire_all()
    registration = db.get(Registration, registration_id)
    assert registration.responses["custom_motorcycle_registration_number"] == "KA01AB1234"
    assert registration.responses["pickup_point_id"] == "gate"
    assert registration.status == "confirmed"
    assert registration.allocation_number is None
    assert list_organizer_registrations(db, owner, event_id=event.id, status_filter="all", pickup_point_id="gate")["items"]
    assert not list_organizer_registrations(db, owner, event_id=event.id, status_filter="all", pickup_point_id="other")["items"]
    exported = list(csv.DictReader(io.StringIO(export_organizer_registrations_csv(db, owner, event_id=event.id, status_filter="all"))))
    assert exported[0]["Motorcycle registration number"] == "KA01AB1234"
    assert exported[0]["Meeting point"] == "Rider: Main gate"
    assert "Pickup point" not in exported[0]
    from main import get_event
    assert "KA01AB1234" not in json.dumps(get_event(str(event.id), db=db, storage=None), default=str)
    stranger = User(name="Other", email="other@example.test", password_hash="test", role="organizer", is_active=True)
    db.add(stranger); db.commit()
    assert not list_organizer_registrations(db, stranger, event_id=event.id, status_filter="all")["items"]
    with pytest.raises(ValueError, match="Event not found"):
        export_organizer_registrations_csv(db, stranger, event_id=event.id)
    first = check_in_registration(db, owner, credential=ticket_qr_payload(ticket_token_for_registration(registration)))
    assert first["status"] == "checked_in"
    assert check_in_registration(db, owner, registration_reference=registration.registration_reference)["alreadyCheckedIn"]


@pytest.mark.parametrize("missing", ["custom_motorcycle_make_model", "custom_motorcycle_registration_number"])
def test_rider_fields_are_required_before_persistence(db, missing):
    event, _ = setup_ride(db)
    answers = responses(); answers.pop(missing)
    with pytest.raises(ValueError, match="required"):
        register(db, event, answers)
    assert event.categories[0].tickets[0].quantity_sold == 0


def test_optional_required_and_invalid_meeting_selection(db):
    event, _ = setup_ride(db)
    answers = responses(); answers.pop("pickup_point_id")
    assert register(db, event, answers).status == "confirmed"
    event.field_config = {**event.field_config, "pickup_points": {**event.field_config["pickup_points"], "required": True}}
    db.commit()
    with pytest.raises(ValueError, match="Meeting point.*required"):
        register(db, event, answers)
    with pytest.raises(ValueError):
        register(db, event, {**answers, "pickup_point_id": "not-in-this-event"})


def test_team_riders_keep_individual_vehicle_answers_and_meeting_points(db):
    event, owner = setup_ride(db, required=True)
    category = event.categories[0]
    category.entry_type = "team"
    category.participants_per_entry = 2
    category.team_size_max = 2
    event.field_config = {**event.field_config, "fields": [],
        "main_registrant_fields": [{"id": "team_name", "label": "Team name", "type": "text", "required": True, "predefined": True}],
        "participant_fields": [{"id": "full_name", "label": "Full name", "type": "text", "required": True, "predefined": True}] + rider_fields()}
    db.commit()
    answers = [{**responses("Captain", "KA01AA1111"), "team_name": "Weekend club"}, responses("Member", "KA01BB2222")]
    payload = BatchRegistrationCreateIn(event_id=event.id, entries=[{
        "ticket_id": category.tickets[0].id, "participants": [{"responses": answer} for answer in answers]}])
    for missing in ["custom_motorcycle_registration_number", "custom_motorcycle_make_model", "pickup_point_id"]:
        invalid = payload.model_copy(deep=True)
        invalid.entries[0].participants[1].responses.pop(missing)
        with pytest.raises(ValueError, match="required"):
            create_guest_batch_registration(db, invalid, idempotency_key=str(uuid4()))
    registrations, _, _ = create_guest_batch_registration(db, payload, idempotency_key=str(uuid4()))
    db.expire_all()
    registration = db.get(Registration, registrations[0].id)
    assert {member.responses["custom_motorcycle_registration_number"] for member in registration.participant_memberships} == {"KA01AA1111", "KA01BB2222"}
    assert pickup_point_summary(db, owner, event.id)["points"][0]["count"] == 2
    exported = list(csv.DictReader(io.StringIO(export_organizer_registrations_csv(db, owner, event_id=event.id, status_filter="all"))))[0]
    assert "Captain: KA01AA1111" in exported["Motorcycle registration number"]
    assert "Member: KA01BB2222" in exported["Motorcycle registration number"]


def test_backend_capability_rejects_bibs_and_results(db):
    from app.api.deps import require_tournament_capable
    event, owner = setup_ride(db)
    assert get_sport_allocation_config(event.id, db, owner).number_enabled is False
    with pytest.raises(HTTPException) as exc:
        _get_event_or_404(db, event.id, owner)
    assert exc.value.status_code == 422
    for flags in [{"bib_numbers_enabled": True}, {"results_enabled": True}]:
        with pytest.raises(HTTPException) as exc:
            update_operational_features(event.id, OperationalFeaturesIn(**flags), user=owner, db=db)
        assert exc.value.status_code == 422
    with pytest.raises(HTTPException):
        require_tournament_capable(event, db)


@pytest.mark.parametrize("sport", ["running", "cycling", "trekking", "badminton"])
def test_existing_sports_keep_backend_number_and_pickup_policies(db, sport):
    from app.sports import get_adapter
    event, owner, _ = make_event(db, sport)
    assert get_sport_allocation_config(event.id, db, owner).number_enabled is True
    assert _get_event_or_404(db, event.id, owner) is event
    assert get_adapter(sport).pickup_point_label == "Pickup point"


def test_direct_upi_registration_approval_and_checkin(db):
    from models import EventPaymentSettings, OrganizationPaymentDestination
    from app.services.credit_service import add_credits
    event, owner = setup_ride(db)
    event.organization.paid_verification_status = "VERIFIED"
    event.categories[0].tickets[0].price = 10000
    destination = OrganizationPaymentDestination(organization_id=event.organization_id, upi_id="test@bank", payee_name="Ride club", status="APPROVED")
    db.add(destination); db.flush()
    event.payment_settings = EventPaymentSettings(method="manual_upi", upi_id="test@bank", payee_name="Ride club", is_active=True, payment_destination_id=destination.id)
    add_credits(db, organization_id=event.organization_id, amount=100000, description="Test balance")
    db.commit()
    registration = register(db, event, responses())
    assert registration.status == "awaiting_payment"
    decide_registration_payment(db, owner, event.id, registration.id, decision="approve")
    db.refresh(registration)
    assert registration.status == "confirmed"
    assert registration.responses["custom_motorcycle_registration_number"] == "KA01AB1234"
    assert check_in_registration(db, owner, registration_reference=registration.registration_reference)["status"] == "checked_in"


class MotorcycleCashfreeRegressionTests(cashfree_tests.CashfreeIntegrationTests):
    """Run existing confirmation, ledger, retry, webhook and refund tests on motorcycle."""
    def _seed(self):
        super()._seed()
        self.event.category = "motorcycle"
        self.db.commit()


def test_manual_entry_uses_same_rider_validation_and_storage(db):
    from app.schemas.registrations import ManualRegistrationCreateIn
    from app.services.registration_service import create_manual_registration
    event, owner = setup_ride(db, required=True)
    payload = ManualRegistrationCreateIn(event_id=event.id, ticket_id=event.categories[0].tickets[0].id,
                                         responses=responses())
    registration, _ = create_manual_registration(db, owner, payload, idempotency_key=str(uuid4()))
    db.expire_all()
    registration = db.get(Registration, registration.id)
    assert registration.source == "manual"
    assert registration.responses["pickup_point_id"] == "gate"
    assert registration.responses["custom_motorcycle_registration_number"] == "KA01AB1234"
    assert registration.status == "confirmed"
