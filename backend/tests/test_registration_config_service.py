import pytest

from app.services.registration_config_service import normalize_addon_config


def test_addon_description_is_normalized_and_preserved():
    result = normalize_addon_config(
        {
            "addons": [
                {
                    "id": "addon_breakfast",
                    "name": "Extra breakfast",
                    "description": "  Served after the finish. Collect using your bib.  ",
                    "price_paise": 10000,
                    "type": "quantity",
                    "required": False,
                    "max_qty": 3,
                }
            ]
        }
    )

    assert result["addons"][0]["description"] == "Served after the finish. Collect using your bib."


def test_legacy_addon_without_description_remains_valid():
    result = normalize_addon_config(
        {
            "addons": [
                {
                    "id": "addon_shirt",
                    "name": "Event T-shirt",
                    "price_paise": 50000,
                    "type": "single_select",
                    "required": False,
                    "options": ["S", "M", "L"],
                }
            ]
        }
    )

    assert result["addons"][0]["description"] == ""


def test_addon_description_has_a_safe_length_limit():
    with pytest.raises(ValueError, match="Description for Extra breakfast is invalid"):
        normalize_addon_config(
            {
                "addons": [
                    {
                        "id": "addon_breakfast",
                        "name": "Extra breakfast",
                        "description": "x" * 501,
                        "price_paise": 10000,
                        "type": "quantity",
                        "required": False,
                    }
                ]
            }
        )
