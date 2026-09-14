from __future__ import annotations

import re
from typing import Any

PREDEFINED_FIELD_DEFINITIONS: dict[str, dict[str, Any]] = {
    "full_name": {"label": "Full name", "type": "text", "required": True},
    "email": {"label": "Email", "type": "email", "required": True},
    "phone": {"label": "Phone", "type": "phone", "required": False},
    "date_of_birth": {"label": "Date of birth", "type": "date", "required": False},
    "gender": {"label": "Gender", "type": "select", "required": False, "options": ["Male", "Female", "Other", "Prefer not to say"]},
    "emergency_contact_name": {"label": "Emergency contact name", "type": "text", "required": False},
    "emergency_contact_phone": {"label": "Emergency contact number", "type": "phone", "required": False},
    "team_name": {"label": "Team name", "type": "text", "required": False},
    "jersey_size": {"label": "Jersey size", "type": "select", "required": False, "options": ["XS", "S", "M", "L", "XL", "XXL"]},
    "blood_group": {"label": "Blood group", "type": "select", "required": False, "options": ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]},
    "college_organization": {"label": "College / organization name", "type": "text", "required": False},
    "category_distance": {"label": "Category / distance", "type": "select", "required": False, "options": []},
}

PREDEFINED_FIELD_IDS = frozenset(PREDEFINED_FIELD_DEFINITIONS)
CUSTOM_FIELD_TYPES = frozenset({"text", "number", "dropdown", "yes_no"})
ADDON_TYPES = frozenset({"single_select", "quantity"})
_FIELD_ID_PATTERN = re.compile(r"^custom_[a-z0-9_]+$")


def default_field_config(category_options: list[str] | None = None) -> dict[str, list[dict[str, Any]]]:
    fields = []
    for order, (field_id, definition) in enumerate(PREDEFINED_FIELD_DEFINITIONS.items(), start=1):
        field = {
            "id": field_id,
            "label": definition["label"],
            "type": definition["type"],
            "required": definition["required"],
            "predefined": True,
            "order": order,
        }
        options = definition.get("options")
        if options is not None:
            field["options"] = list(category_options or options) if field_id == "category_distance" else list(options)
        fields.append(field)
    return {"fields": fields}


def default_addon_config() -> dict[str, list[dict[str, Any]]]:
    return {"addons": []}


def _clean_text(value: Any, label: str, *, max_length: int = 160) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be text")
    cleaned = value.strip()
    if not cleaned or len(cleaned) > max_length or any(ord(character) < 32 or ord(character) == 127 for character in cleaned):
        raise ValueError(f"{label} is invalid")
    return cleaned


def normalize_field_config(config: dict[str, Any] | None, *, category_options: list[str] | None = None) -> dict[str, list[dict[str, Any]]]:
    if not config or not config.get("fields"):
        return default_field_config(category_options)
    raw_fields = config.get("fields")
    if not isinstance(raw_fields, list) or len(raw_fields) > len(PREDEFINED_FIELD_IDS) + 5:
        raise ValueError("Participant fields configuration is invalid")

    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    custom_count = 0
    for index, raw in enumerate(raw_fields, start=1):
        if not isinstance(raw, dict):
            raise ValueError("Participant field configuration is invalid")
        field_id = _clean_text(raw.get("id"), "Participant field id", max_length=60)
        if field_id in seen:
            raise ValueError("Participant field ids must be unique")
        seen.add(field_id)
        predefined = bool(raw.get("predefined", field_id in PREDEFINED_FIELD_IDS))
        if predefined:
            if field_id not in PREDEFINED_FIELD_IDS:
                raise ValueError("Unknown predefined participant field")
            definition = PREDEFINED_FIELD_DEFINITIONS[field_id]
            field_type = definition["type"]
            label = definition["label"]
            required = bool(raw.get("required", definition["required"]))
        else:
            custom_count += 1
            if custom_count > 5 or not _FIELD_ID_PATTERN.fullmatch(field_id):
                raise ValueError("A maximum of five custom participant fields is allowed")
            field_type = _clean_text(raw.get("type"), "Custom participant field type", max_length=20)
            if field_type not in CUSTOM_FIELD_TYPES:
                raise ValueError("Unsupported custom participant field type")
            label = _clean_text(raw.get("label"), "Custom participant field label")
            required = bool(raw.get("required", False))

        if field_id == "full_name":
            required = True
        field: dict[str, Any] = {
            "id": field_id,
            "label": label,
            "type": field_type,
            "required": required,
            "predefined": predefined,
            "order": index,
        }
        if field_type == "select" or field_type == "dropdown":
            raw_options = raw.get("options")
            if field_id == "category_distance" and not raw_options and category_options:
                raw_options = category_options
            if not isinstance(raw_options, list):
                raise ValueError(f"Options are required for {label}")
            options = []
            for option in raw_options:
                option_text = _clean_text(option, f"Option for {label}", max_length=80)
                if option_text not in options:
                    options.append(option_text)
            if not options:
                raise ValueError(f"At least one option is required for {label}")
            field["options"] = options
        normalized.append(field)

    by_id = {field["id"]: field for field in normalized}
    full_name = by_id.get("full_name")
    if full_name is None or not full_name["predefined"] or not full_name["required"]:
        raise ValueError("Full name is always required")
    if "email" not in by_id and "phone" not in by_id:
        raise ValueError("Email or phone must be configured")
    if not any(by_id.get(field_id, {}).get("required") for field_id in ("email", "phone")):
        raise ValueError("At least one of email or phone must be required")
    return {"fields": normalized}


def normalize_addon_config(config: dict[str, Any] | None) -> dict[str, list[dict[str, Any]]]:
    if not config:
        return default_addon_config()
    raw_addons = config.get("addons", [])
    if not isinstance(raw_addons, list) or len(raw_addons) > 30:
        raise ValueError("Add-ons configuration is invalid")
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(raw_addons, start=1):
        if not isinstance(raw, dict):
            raise ValueError("Add-on configuration is invalid")
        addon_id = _clean_text(raw.get("id"), "Add-on id", max_length=60)
        if addon_id in seen or not addon_id.startswith("addon_"):
            raise ValueError("Add-on ids must be unique and start with addon_")
        seen.add(addon_id)
        name = _clean_text(raw.get("name"), "Add-on name")
        try:
            price_paise = int(raw.get("price_paise", 0))
        except (TypeError, ValueError) as exc:
            raise ValueError("Add-on price must be a non-negative integer in paise") from exc
        if price_paise < 0:
            raise ValueError("Add-on price must be non-negative")
        addon_type = _clean_text(raw.get("type"), "Add-on type", max_length=30)
        if addon_type not in ADDON_TYPES:
            raise ValueError("Unsupported add-on type")
        required = bool(raw.get("required", False))
        addon: dict[str, Any] = {
            "id": addon_id,
            "name": name,
            "price_paise": price_paise,
            "type": addon_type,
            "required": required,
            "order": index,
        }
        if addon_type == "single_select":
            raw_options = raw.get("options", [])
            if not isinstance(raw_options, list) or not raw_options:
                raise ValueError(f"Options are required for add-on {name}")
            options = []
            for option in raw_options:
                option_text = _clean_text(option, f"Option for {name}", max_length=80)
                if option_text not in options:
                    options.append(option_text)
            addon["options"] = options
        else:
            max_qty = raw.get("max_qty")
            if max_qty is not None:
                try:
                    max_qty = int(max_qty)
                except (TypeError, ValueError) as exc:
                    raise ValueError(f"Maximum quantity for {name} is invalid") from exc
                if max_qty < 1 or max_qty > 100:
                    raise ValueError(f"Maximum quantity for {name} must be between 1 and 100")
            if required and max_qty == 0:
                raise ValueError(f"Required add-on {name} must allow a quantity")
            addon["max_qty"] = max_qty
        normalized.append(addon)
    return {"addons": normalized}


def normalize_event_configs(
    field_config: dict[str, Any] | None,
    addon_config: dict[str, Any] | None,
    *,
    category_options: list[str] | None = None,
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, list[dict[str, Any]]]]:
    return (
        normalize_field_config(field_config, category_options=category_options),
        normalize_addon_config(addon_config),
    )


def _response_value(value: Any, field: dict[str, Any]) -> Any:
    if value is None:
        return None
    field_type = field["type"]
    if field_type in {"text", "email", "phone", "date"}:
        return _clean_text(value, field["label"], max_length=320)
    if field_type == "number":
        try:
            number = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{field['label']} must be a number") from exc
        return int(number) if number.is_integer() else number
    if field_type in {"select", "dropdown"}:
        value = _clean_text(value, field["label"], max_length=120)
        if value not in field.get("options", []):
            raise ValueError(f"Select a valid value for {field['label']}")
        return value
    if field_type == "yes_no":
        if isinstance(value, bool):
            return value
        normalized = str(value).strip().lower()
        if normalized in {"yes", "true"}:
            return True
        if normalized in {"no", "false"}:
            return False
        raise ValueError(f"{field['label']} must be Yes or No")
    raise ValueError("Unsupported participant field type")


def calculate_registration_total(
    field_config: dict[str, Any],
    addon_config: dict[str, Any],
    responses: dict[str, Any] | None,
    selections: dict[str, Any] | None,
    *,
    base_fee_paise: int,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    responses = responses or {}
    selections = selections or {}
    fields = field_config["fields"]
    known_fields = {field["id"]: field for field in fields}
    unknown_fields = set(responses) - set(known_fields)
    if unknown_fields:
        raise ValueError("Unknown participant information field")
    normalized_responses: dict[str, Any] = {}
    for field in fields:
        value = responses.get(field["id"])
        if value in (None, ""):
            if field["required"]:
                raise ValueError(f"{field['label']} is required")
            continue
        normalized_responses[field["id"]] = _response_value(value, field)
    if not normalized_responses.get("email") and not normalized_responses.get("phone"):
        raise ValueError("At least one of email or phone is required")

    addons = addon_config["addons"]
    known_addons = {addon["id"]: addon for addon in addons}
    unknown_addons = set(selections) - set(known_addons)
    if unknown_addons:
        raise ValueError("Unknown add-on selection")
    normalized_selections: dict[str, Any] = {}
    addon_total_paise = 0
    selected_addons = []
    for addon in addons:
        selection = selections.get(addon["id"]) or {}
        if not isinstance(selection, dict):
            raise ValueError(f"Selection for {addon['name']} is invalid")
        if addon["type"] == "single_select":
            selected = selection.get("selected")
            if selected in (None, ""):
                if addon["required"]:
                    raise ValueError(f"Choose {addon['name']}")
                continue
            selected = _clean_text(selected, addon["name"], max_length=120)
            if selected not in addon["options"]:
                raise ValueError(f"Choose a valid option for {addon['name']}")
            normalized_selections[addon["id"]] = {"selected": selected}
            addon_total_paise += addon["price_paise"]
            selected_addons.append({"id": addon["id"], "selected": selected, "qty": 1, "amount_paise": addon["price_paise"]})
        else:
            raw_qty = selection.get("qty", 0)
            try:
                qty = int(raw_qty)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Quantity for {addon['name']} is invalid") from exc
            if qty < 0 or (addon.get("max_qty") is not None and qty > addon["max_qty"]):
                raise ValueError(f"Quantity for {addon['name']} is invalid")
            if addon["required"] and qty < 1:
                raise ValueError(f"Choose at least one {addon['name']}")
            if qty:
                normalized_selections[addon["id"]] = {"qty": qty}
                amount_paise = addon["price_paise"] * qty
                addon_total_paise += amount_paise
                selected_addons.append({"id": addon["id"], "qty": qty, "amount_paise": amount_paise})
    total_paise = int(base_fee_paise) + addon_total_paise
    computed_total = {
        "baseFeePaise": int(base_fee_paise),
        "addonTotalPaise": addon_total_paise,
        "totalPaise": total_paise,
        "currency": "INR",
        "addons": selected_addons,
    }
    return normalized_responses, normalized_selections, computed_total
