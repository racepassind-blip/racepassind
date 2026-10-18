from app.services.registration_config_service import normalize_addon_config


def test_addon_description_normalizes_textarea_line_breaks():
    normalized = normalize_addon_config({
        "addons": [{
            "id": "addon_breakfast",
            "name": "Extra breakfast",
            "description": "Rider breakfast.\nBook extra packs here.",
            "price_paise": 8000,
            "type": "quantity",
            "required": False,
            "max_qty": 2,
        }],
    })

    assert normalized["addons"][0]["description"] == "Rider breakfast. Book extra packs here."
