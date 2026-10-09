"""Focused tests for Trekking event creation/editing at the schema layer.

These exercise ``OrganizerEventCreateV1`` / ``OrganizerEventUpdateV1`` — the
layer where sport-specific setup is validated/normalized via ``get_adapter`` —
without importing the HTTP/DB stack (which transitively requires the optional
``clerk_backend_api`` package that is not installed in this environment).

The HTTP route itself only persists ``category = payload.sport.strip().lower()``
and stores ``sport_config`` inside ``field_config``, so a schema that validates
to ``sport == "trekking"`` with an empty ``sport_config`` is what gets stored.
"""
from uuid import uuid4

import pytest

from app.schemas.events import OrganizerEventCreateV1, OrganizerEventUpdateV1


def _create_payload(sport, *, sport_config=None, distance="12 KM"):
    return {
        "organization_id": uuid4(),
        "name": "Sport event",
        "description": "An event",
        "sport": sport,
        "event_date": "2026-10-10",
        "location_name": "Base camp",
        "max_participants": 100,
        "sport_config": sport_config or {},
        "categories": [
            {"name": "Open", "distance": distance,
             "tickets": [{"name": "Entry", "price_rupees": "0", "quantity": 10}]},
        ],
    }


def _update_payload(sport, *, sport_config=None, distance="12 KM"):
    payload = _create_payload(sport, sport_config=sport_config, distance=distance)
    payload.pop("organization_id")
    return payload


# --- Trekking creation -----------------------------------------------------

def test_create_trekking_event_stores_sport_trekking():
    model = OrganizerEventCreateV1.model_validate(_create_payload("trekking"))
    assert model.sport == "trekking"
    # The HTTP layer stores category = payload.sport.strip().lower().
    assert model.sport.strip().lower() == "trekking"


def test_trekking_has_no_sport_specific_config():
    # Trekking exposes no tournament/match/draw/court/race/bib configuration, so
    # the adapter normalizes any sport_config down to an empty dict.
    model = OrganizerEventCreateV1.model_validate(
        _create_payload("trekking", sport_config={"tournament_format": "league", "overs_per_innings": 10})
    )
    assert model.sport_config == {}


def test_trekking_keeps_generic_distance_configuration():
    model = OrganizerEventCreateV1.model_validate(_create_payload("trekking", distance="18.5 KM"))
    assert model.categories[0].distance == "18.5 KM"


# --- Trekking editing ------------------------------------------------------

def test_edit_trekking_event_keeps_sport_trekking():
    model = OrganizerEventUpdateV1.model_validate(_update_payload("trekking"))
    assert model.sport == "trekking"
    assert model.sport_config == {}


# --- Sport isolation: other sports unaffected ------------------------------

def test_badminton_still_validates_its_tournament_format():
    model = OrganizerEventCreateV1.model_validate({
        **_create_payload("badminton", sport_config={"tournament_format": "league"}, distance=None),
    })
    assert model.sport == "badminton"
    assert model.sport_config == {"tournament_format": "league"}
    with pytest.raises(ValueError):
        OrganizerEventCreateV1.model_validate(
            _create_payload("badminton", sport_config={"tournament_format": "nonsense"}, distance=None)
        )


def test_cricket_still_normalizes_its_setup():
    config = {
        "tournament_format": "league",
        "ball_type": "leather",
        "overs_per_innings": 20,
        "minimum_players": 11,
        "maximum_players": 15,
    }
    model = OrganizerEventCreateV1.model_validate(
        _create_payload("cricket", sport_config=config, distance=None)
    )
    assert model.sport == "cricket"
    assert model.sport_config["overs_per_innings"] == 20


@pytest.mark.parametrize("sport", ["running", "cycling"])
def test_running_and_cycling_unchanged(sport):
    model = OrganizerEventCreateV1.model_validate(_create_payload(sport, distance="10 KM"))
    assert model.sport == sport
    # Race sports carry no sport_config block from the generic form.
    assert model.sport_config == {}
    assert model.categories[0].distance == "10 KM"


def test_unknown_sport_fallback_unchanged():
    model = OrganizerEventCreateV1.model_validate(_create_payload("some_unknown_sport", distance="5 KM"))
    assert model.sport == "some_unknown_sport"
    assert model.sport_config == {}
