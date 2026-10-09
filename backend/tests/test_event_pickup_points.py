"""Focused tests for the generic event-level Pickup Points feature.

Pickup points are a reusable, capability-gated event setting (not sport-specific):
the list of points lives on the individual event (stored in field_config), and a
participant's selection is captured PER PARTICIPANT through the ordinary
participant-response pipeline under the ``pickup_point_id`` field.

These exercise the config/validation/response layers directly (they import no
HTTP/DB/Clerk code). HTTP route persistence is covered by reading events.py in
review; the schema below is what the route stores.
"""
from uuid import uuid4

import pytest

from app.schemas.events import OrganizerEventCreateV1, OrganizerEventUpdateV1
from app.services.registration_config_service import (
    PICKUP_POINT_FIELD_ID,
    calculate_registration_total,
    default_pickup_points_config,
    normalize_field_config,
    normalize_pickup_points_config,
    pickup_point_field,
)
from app.sports.registry import get_adapter


# --- generic capability ----------------------------------------------------

def test_trekking_supports_pickup_points():
    assert get_adapter("trekking").supports_pickup_points is True


@pytest.mark.parametrize("sport", ["running", "cycling", "badminton"])
def test_pickup_points_are_available_as_a_generic_event_feature(sport):
    assert get_adapter(sport).supports_pickup_points is True


# --- config normalization --------------------------------------------------

def test_disabled_pickup_carries_no_points():
    assert normalize_pickup_points_config(None) == {"enabled": False}
    assert default_pickup_points_config() == {"enabled": False}
    # Points are dropped when disabled.
    assert normalize_pickup_points_config(
        {"enabled": False, "points": [{"id": "p1", "name": "Gate"}]}
    ) == {"enabled": False}


def test_enabled_pickup_normalizes_points_and_required_flag():
    result = normalize_pickup_points_config({
        "enabled": True,
        "required": True,
        "points": [
            {"id": "p1", "name": "Main Gate", "description": "By the arch", "address": "1 Main St"},
            {"id": "p2", "name": "North Lot"},
        ],
    })
    assert result == {
        "enabled": True,
        "required": True,
        "points": [
            {"id": "p1", "name": "Main Gate", "description": "By the arch", "address": "1 Main St"},
            {"id": "p2", "name": "North Lot"},
        ],
    }


def test_enabled_pickup_defaults_required_to_false():
    result = normalize_pickup_points_config({
        "enabled": True,
        "points": [{"id": "p1", "name": "Main Gate"}],
    })
    assert result["required"] is False


def test_optional_fields_are_omitted_when_empty():
    result = normalize_pickup_points_config({
        "enabled": True,
        "points": [{"id": "p1", "name": "Gate", "description": "", "address": ""}],
    })
    assert result["points"] == [{"id": "p1", "name": "Gate"}]


# --- invalid config rejected -----------------------------------------------

def test_enabled_pickup_requires_at_least_one_point():
    with pytest.raises(ValueError, match="At least one pickup point is required"):
        normalize_pickup_points_config({"enabled": True, "points": []})
    with pytest.raises(ValueError, match="At least one pickup point is required"):
        normalize_pickup_points_config({"enabled": True})


def test_duplicate_point_ids_rejected():
    with pytest.raises(ValueError, match="unique"):
        normalize_pickup_points_config({
            "enabled": True,
            "points": [{"id": "p1", "name": "A"}, {"id": "p1", "name": "B"}],
        })


def test_point_missing_id_or_name_rejected():
    with pytest.raises(ValueError):
        normalize_pickup_points_config({"enabled": True, "points": [{"name": "No id"}]})
    with pytest.raises(ValueError):
        normalize_pickup_points_config({"enabled": True, "points": [{"id": "p1"}]})


def test_too_many_points_rejected():
    many = [{"id": f"p{i}", "name": f"Point {i}"} for i in range(101)]
    with pytest.raises(ValueError):
        normalize_pickup_points_config({"enabled": True, "points": many})


# --- event configuration via the create/edit schema ------------------------

def _payload(sport, pickup_points, *, distance="12 KM"):
    return {
        "organization_id": uuid4(), "name": "Event", "description": "d", "sport": sport,
        "event_date": "2026-10-10", "location_name": "Base", "max_participants": 100,
        "pickup_points": pickup_points,
        "categories": [{"name": "Open", "distance": distance,
                        "tickets": [{"name": "Entry", "price_rupees": "0", "quantity": 10}]}],
    }


def test_any_sport_can_enable_event_specific_pickup_points():
    event = OrganizerEventCreateV1.model_validate(
        _payload("running", {"enabled": True, "points": [{"id": "p1", "name": "Gate"}]})
    )
    assert event.pickup_points["points"][0]["id"] == "p1"


def test_trekking_event_stores_its_own_pickup_points():
    event = OrganizerEventCreateV1.model_validate(
        _payload("trekking", {"enabled": True, "required": True,
                              "points": [{"id": "p1", "name": "Main Gate"}]})
    )
    assert event.pickup_points == {
        "enabled": True, "required": True, "points": [{"id": "p1", "name": "Main Gate"}],
    }


def test_event_isolation_two_events_own_distinct_points():
    event1 = OrganizerEventCreateV1.model_validate(
        _payload("trekking", {"enabled": True, "points": [{"id": "a", "name": "Alpha"}]})
    )
    event2 = OrganizerEventCreateV1.model_validate(
        _payload("trekking", {"enabled": True, "points": [{"id": "b", "name": "Beta"}]})
    )
    assert event1.pickup_points["points"] == [{"id": "a", "name": "Alpha"}]
    assert event2.pickup_points["points"] == [{"id": "b", "name": "Beta"}]


def test_disabled_or_omitted_pickup_normalizes_to_disabled():
    event = OrganizerEventCreateV1.model_validate(_payload("trekking", {}))
    assert event.pickup_points == {"enabled": False}


def test_edit_omitting_pickup_leaves_it_unset_for_preservation():
    payload = _payload("trekking", {"enabled": True, "points": [{"id": "p1", "name": "Gate"}]})
    payload.pop("organization_id")
    payload.pop("pickup_points")
    model = OrganizerEventUpdateV1.model_validate(payload)
    assert "pickup_points" not in model.model_fields_set


def test_edit_can_enable_pickup_on_any_sport():
    payload = _payload("running", {"enabled": True, "points": [{"id": "p1", "name": "Gate"}]})
    payload.pop("organization_id")
    model = OrganizerEventUpdateV1.model_validate(payload)
    assert model.pickup_points["enabled"] is True


# --- per-participant selection enforcement + storage -----------------------

def _base_field_config():
    return normalize_field_config({"fields": [
        {"id": "full_name", "label": "Full name", "type": "text", "required": True, "predefined": True},
        {"id": "email", "label": "Email", "type": "email", "required": True, "predefined": True},
    ]})


def test_valid_pickup_id_accepted_and_stored():
    responses, _s, _t = calculate_registration_total(
        _base_field_config(), {"addons": []},
        {"full_name": "A", "email": "a@b.test", PICKUP_POINT_FIELD_ID: "p1"}, {},
        base_fee_paise=0,
        per_participant_fields=[pickup_point_field(["p1", "p2"], required=True)],
    )
    assert responses[PICKUP_POINT_FIELD_ID] == "p1"


def test_invalid_pickup_id_rejected():
    with pytest.raises(ValueError, match="Select a valid value for Pickup point"):
        calculate_registration_total(
            _base_field_config(), {"addons": []},
            {"full_name": "A", "email": "a@b.test", PICKUP_POINT_FIELD_ID: "nope"}, {},
            base_fee_paise=0,
            per_participant_fields=[pickup_point_field(["p1", "p2"], required=True)],
        )


def test_required_pickup_missing_rejected():
    with pytest.raises(ValueError, match="is required"):
        calculate_registration_total(
            _base_field_config(), {"addons": []},
            {"full_name": "A", "email": "a@b.test"}, {},
            base_fee_paise=0,
            per_participant_fields=[pickup_point_field(["p1", "p2"], required=True)],
        )


def test_optional_pickup_may_be_omitted():
    responses, _s, _t = calculate_registration_total(
        _base_field_config(), {"addons": []},
        {"full_name": "A", "email": "a@b.test"}, {},
        base_fee_paise=0,
        per_participant_fields=[pickup_point_field(["p1", "p2"], required=False)],
    )
    assert PICKUP_POINT_FIELD_ID not in responses


def test_pickup_applies_to_team_members_too():
    # Per-participant fields are validated even for non-primary team members.
    with pytest.raises(ValueError, match="is required"):
        calculate_registration_total(
            _base_field_config(), {"addons": []},
            {"full_name": "B", "email": "b@b.test"}, {},
            base_fee_paise=0,
            is_team_member=True,
            per_participant_fields=[pickup_point_field(["p1"], required=True)],
        )


def test_no_pickup_field_required_when_not_injected():
    # When the event has no pickup config, no field is injected and the exact same
    # registration succeeds — existing (disabled) behavior intact.
    responses, _s, _t = calculate_registration_total(
        _base_field_config(), {"addons": []},
        {"full_name": "A", "email": "a@b.test"}, {},
        base_fee_paise=0,
    )
    assert PICKUP_POINT_FIELD_ID not in responses
