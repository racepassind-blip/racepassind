import pytest

from app.schemas.events import OrganizerEventCreateV1
from app.services.registration_config_service import calculate_registration_total, normalize_field_config, pickup_point_field
from app.sports.motorcycle import MotorcycleAdapter
from app.sports.registry import get_adapter


def test_motorcycle_uses_dedicated_operational_adapter():
    adapter = get_adapter("motorcycle")
    assert isinstance(adapter, MotorcycleAdapter)
    assert adapter.key == "motorcycle"
    assert adapter.supports_distance is True
    assert adapter.supports_pickup_points is True
    assert adapter.supports_tournament is False
    assert adapter.team_tournament is False
    assert adapter.result_type == "none"
    with pytest.raises(ValueError):
        adapter.race_metrics(300, 1000)


def test_motorcycle_is_not_an_alias_for_an_existing_sport():
    assert get_adapter("motorcycle") is not get_adapter("cycling")
    assert get_adapter("motorcycle") is not get_adapter("trekking")


def test_motorcycle_event_uses_canonical_key_and_existing_custom_fields():
    event = OrganizerEventCreateV1.model_validate({
        "organization_id": "00000000-0000-0000-0000-000000000001",
        "name": "Weekend Ride",
        "description": "A motorcycle ride",
        "sport": "motorcycle",
        "event_date": "2026-11-01",
        "location_name": "Bengaluru",
        "max_participants": 100,
        "field_config": {"fields": [
            {"id": "full_name", "label": "Full name", "type": "text", "required": True, "predefined": True},
            {"id": "email", "label": "Email", "type": "email", "required": True, "predefined": True},
            {"id": "emergency_contact_name", "label": "Emergency contact name", "type": "text", "required": True, "predefined": True},
            {"id": "emergency_contact_phone", "label": "Emergency contact number", "type": "phone", "required": True, "predefined": True},
            {"id": "custom_motorcycle_make_model", "label": "Motorcycle make and model", "type": "text", "required": True, "predefined": False},
            {"id": "custom_motorcycle_registration_number", "label": "Motorcycle registration number", "type": "text", "required": True, "predefined": False},
        ]},
        "categories": [{"name": "Open Ride", "distance": "100 KM", "tickets": [{"name": "Entry", "price_rupees": "0", "quantity": 10}]}],
    })
    assert event.sport == "motorcycle"
    fields = normalize_field_config(event.field_config)["fields"]
    assert {field["id"] for field in fields} >= {
        "custom_motorcycle_make_model",
        "custom_motorcycle_registration_number",
        "emergency_contact_name",
        "emergency_contact_phone",
    }
    responses, _, _ = calculate_registration_total(
        {"fields": fields},
        {"addons": []},
        {
            "full_name": "Rider",
            "email": "rider@example.test",
            "emergency_contact_name": "Contact",
            "emergency_contact_phone": "9876543210",
            "custom_motorcycle_make_model": "Honda CB350",
            "custom_motorcycle_registration_number": "KA01AB1234",
            "pickup_point_id": "meet-1",
        },
        {},
        base_fee_paise=0,
        per_participant_fields=[pickup_point_field(["meet-1"], required=False, label="Meeting point")],
    )
    assert responses["custom_motorcycle_make_model"] == "Honda CB350"
    assert responses["custom_motorcycle_registration_number"] == "KA01AB1234"
    assert responses["pickup_point_id"] == "meet-1"
