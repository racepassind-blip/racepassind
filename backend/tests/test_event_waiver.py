"""Focused tests for the generic event-level Waiver & Declaration.

The waiver is a reusable, capability-gated event setting (not sport-specific):
content lives on the individual event (stored in field_config), acceptance is
captured per registration through the ordinary participant-response pipeline.

These exercise the config/validation/response layers directly (they import no
HTTP/DB/Clerk code). HTTP route persistence is covered by reading events.py in
review; the schema below is what the route stores.
"""
from uuid import uuid4

import pytest

from app.schemas.events import OrganizerEventCreateV1, OrganizerEventUpdateV1
from app.services.registration_config_service import (
    WAIVER_ACCEPTANCE_FIELD_ID,
    calculate_registration_total,
    default_waiver_config,
    normalize_field_config,
    normalize_waiver_config,
    waiver_acceptance_field,
)
from app.sports.registry import get_adapter


# --- capability (generic, all sports) --------------------------------------

@pytest.mark.parametrize("sport", ["trekking", "running", "cycling", "badminton"])
def test_waiver_is_a_generic_capability_on_every_sport(sport):
    assert get_adapter(sport).supports_waiver is True


# --- config normalization --------------------------------------------------

def test_disabled_waiver_carries_no_content():
    assert normalize_waiver_config(None) == {"enabled": False}
    assert default_waiver_config() == {"enabled": False}
    # Content is dropped when disabled.
    assert normalize_waiver_config({"enabled": False, "title": "x", "text": "y"}) == {"enabled": False}


def test_enabled_waiver_requires_title_and_text():
    result = normalize_waiver_config({"enabled": True, "title": "Trek Waiver", "text": "I accept the risks."})
    assert result == {"enabled": True, "title": "Trek Waiver", "text": "I accept the risks."}
    with pytest.raises(ValueError):
        normalize_waiver_config({"enabled": True, "title": "No text"})
    with pytest.raises(ValueError):
        normalize_waiver_config({"enabled": True, "text": "No title"})


# --- event configuration via the create/edit schema ------------------------

def _payload(sport, waiver, *, distance="12 KM"):
    return {
        "organization_id": uuid4(), "name": "Event", "description": "d", "sport": sport,
        "event_date": "2026-10-10", "location_name": "Base", "max_participants": 100,
        "waiver": waiver,
        "categories": [{"name": "Open", "distance": distance,
                        "tickets": [{"name": "Entry", "price_rupees": "0", "quantity": 10}]}],
    }


def test_event_stores_its_own_waiver_content():
    event1 = OrganizerEventCreateV1.model_validate(
        _payload("trekking", {"enabled": True, "title": "Trekking Waiver", "text": "trek terms"})
    )
    event2 = OrganizerEventCreateV1.model_validate(
        _payload("running", {"enabled": True, "title": "Running Declaration", "text": "run terms"})
    )
    event3 = OrganizerEventCreateV1.model_validate(_payload("cycling", {}))
    # Each event owns its own content; one event's waiver does not affect another.
    assert event1.waiver == {"enabled": True, "title": "Trekking Waiver", "text": "trek terms"}
    assert event2.waiver == {"enabled": True, "title": "Running Declaration", "text": "run terms"}
    assert event3.waiver == {"enabled": False}


def test_edit_omitting_waiver_leaves_it_unset_for_preservation():
    # The update schema only normalizes waiver when the field was submitted, so the
    # route preserves the stored value when it is absent.
    payload = _payload("trekking", {"enabled": True, "title": "T", "text": "x"})
    payload.pop("organization_id")
    payload.pop("waiver")
    model = OrganizerEventUpdateV1.model_validate(payload)
    assert "waiver" not in model.model_fields_set


# --- acceptance enforcement + storage (generic response pipeline) ----------

def _base_field_config():
    return normalize_field_config({"fields": [
        {"id": "full_name", "label": "Full name", "type": "text", "required": True, "predefined": True},
        {"id": "email", "label": "Email", "type": "email", "required": True, "predefined": True},
    ]})


def test_registration_blocked_without_waiver_acceptance():
    with pytest.raises(ValueError, match="accept the waiver"):
        calculate_registration_total(
            _base_field_config(), {"addons": []},
            {"full_name": "A", "email": "a@b.test"}, {},
            base_fee_paise=0, extra_required_fields=[waiver_acceptance_field()],
        )


def test_waiver_acceptance_stored_in_generic_responses():
    responses, _selections, _total = calculate_registration_total(
        _base_field_config(), {"addons": []},
        {"full_name": "A", "email": "a@b.test", WAIVER_ACCEPTANCE_FIELD_ID: True}, {},
        base_fee_paise=0, extra_required_fields=[waiver_acceptance_field()],
    )
    assert responses[WAIVER_ACCEPTANCE_FIELD_ID] is True


def test_declined_waiver_is_rejected():
    with pytest.raises(ValueError, match="must accept"):
        calculate_registration_total(
            _base_field_config(), {"addons": []},
            {"full_name": "A", "email": "a@b.test", WAIVER_ACCEPTANCE_FIELD_ID: False}, {},
            base_fee_paise=0, extra_required_fields=[waiver_acceptance_field()],
        )


def test_no_waiver_field_required_when_not_injected():
    # When the event has no waiver, no acceptance field is injected and the exact
    # same registration succeeds — existing (Running/Cycling/Badminton) behavior.
    responses, _s, _t = calculate_registration_total(
        _base_field_config(), {"addons": []},
        {"full_name": "A", "email": "a@b.test"}, {},
        base_fee_paise=0,
    )
    assert WAIVER_ACCEPTANCE_FIELD_ID not in responses
