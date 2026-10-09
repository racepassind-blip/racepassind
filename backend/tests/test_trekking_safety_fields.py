"""Regression tests proving Trekking reuses the existing registration "Safety"
section (emergency contact name/number, blood group, and the "must answer"
behavior) through the generic registration-config pipeline.

Trekking is an ordinary event type, so it has no code of its own here: these
fields are predefined in the shared config and enforced by the shared
``calculate_registration_total`` regardless of sport. The tests exercise that
sport-agnostic pipeline directly (it imports no HTTP/DB/Clerk code).
"""
import pytest

from app.services.registration_config_service import (
    PREDEFINED_FIELD_DEFINITIONS,
    calculate_registration_total,
    normalize_field_config,
)

SAFETY_FIELD_IDS = ("emergency_contact_name", "emergency_contact_phone", "blood_group")


def _field(field_id, required):
    definition = PREDEFINED_FIELD_DEFINITIONS[field_id]
    field = {"id": field_id, "label": definition["label"], "type": definition["type"],
             "required": required, "predefined": True}
    if "options" in definition:
        field["options"] = list(definition["options"])
    return field


def _safety_field_config(required):
    # A minimal valid config: full_name + email are mandatory by the shared
    # rules, plus the three Safety fields the organizer has configured.
    return {
        "fields": [
            _field("full_name", True),
            _field("email", True),
            _field("emergency_contact_name", required),
            _field("emergency_contact_phone", required),
            _field("blood_group", required),
        ]
    }


def test_safety_fields_are_predefined_in_the_shared_config():
    for field_id in SAFETY_FIELD_IDS:
        assert field_id in PREDEFINED_FIELD_DEFINITIONS
    assert PREDEFINED_FIELD_DEFINITIONS["emergency_contact_name"]["label"] == "Emergency contact name"
    assert PREDEFINED_FIELD_DEFINITIONS["emergency_contact_phone"]["label"] == "Emergency contact number"
    assert PREDEFINED_FIELD_DEFINITIONS["blood_group"]["label"] == "Blood group"


def test_organizer_can_enable_safety_fields_for_a_trekking_event():
    normalized = normalize_field_config(_safety_field_config(required=False))
    by_id = {field["id"]: field for field in normalized["fields"]}
    for field_id in SAFETY_FIELD_IDS:
        assert field_id in by_id
    # Blood group keeps its predefined options.
    assert by_id["blood_group"]["options"] == PREDEFINED_FIELD_DEFINITIONS["blood_group"]["options"]


def test_safety_responses_use_the_generic_response_structure():
    field_config = normalize_field_config(_safety_field_config(required=True))
    responses, _selections, _total = calculate_registration_total(
        field_config,
        {"addons": []},
        {
            "full_name": "Trek Participant",
            "email": "trekker@example.test",
            "emergency_contact_name": "Kin Person",
            "emergency_contact_phone": "9876543210",
            "blood_group": "O+",
        },
        {},
        base_fee_paise=0,
    )
    # Stored in the same flat responses dict every sport uses — no trek-specific keys.
    assert responses["emergency_contact_name"] == "Kin Person"
    assert responses["emergency_contact_phone"] == "9876543210"
    assert responses["blood_group"] == "O+"


@pytest.mark.parametrize("missing", SAFETY_FIELD_IDS)
def test_must_answer_is_enforced_when_a_safety_field_is_required(missing):
    field_config = normalize_field_config(_safety_field_config(required=True))
    responses = {
        "full_name": "Trek Participant",
        "email": "trekker@example.test",
        "emergency_contact_name": "Kin Person",
        "emergency_contact_phone": "9876543210",
        "blood_group": "O+",
    }
    responses.pop(missing)
    with pytest.raises(ValueError, match="is required"):
        calculate_registration_total(field_config, {"addons": []}, responses, {}, base_fee_paise=0)


def test_optional_safety_fields_may_be_omitted():
    field_config = normalize_field_config(_safety_field_config(required=False))
    responses, _selections, _total = calculate_registration_total(
        field_config,
        {"addons": []},
        {"full_name": "Trek Participant", "email": "trekker@example.test"},
        {},
        base_fee_paise=0,
    )
    # Omitted optional fields simply do not appear in the stored responses.
    assert "emergency_contact_name" not in responses
    assert "blood_group" not in responses
