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
    # Team-specific predefined fields
    "captain_name": {"label": "Captain name", "type": "text", "required": True},
    "captain_phone": {"label": "Captain phone", "type": "phone", "required": True},
    "captain_email": {"label": "Captain email", "type": "email", "required": True},
}

PREDEFINED_FIELD_IDS = frozenset(PREDEFINED_FIELD_DEFINITIONS)
CUSTOM_FIELD_TYPES = frozenset({"text", "number", "dropdown", "yes_no"})
ADDON_TYPES = frozenset({"single_select", "quantity"})
_FIELD_ID_PATTERN = re.compile(r"^custom_[a-z0-9_]+$")


def default_field_config(category_options: list[str] | None = None) -> dict[str, list[dict[str, Any]]]:
    fields = []
    for field_id, definition in PREDEFINED_FIELD_DEFINITIONS.items():
        options = definition.get("options")
        if field_id == "category_distance" and not category_options:
            continue
        field = {
            "id": field_id,
            "label": definition["label"],
            "type": definition["type"],
            "required": definition["required"],
            "predefined": True,
            "order": len(fields) + 1,
        }
        if options is not None:
            field["options"] = list(category_options) if field_id == "category_distance" else list(options)
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


# ---------------------------------------------------------------------------
# Team registration: two-section field config
# Section A = main registrant / captain fields (collected once per entry)
# Section B = per-participant fields (repeated for every team member)
# ---------------------------------------------------------------------------

_DEFAULT_MAIN_REGISTRANT_FIELDS: list[dict[str, Any]] = [
    {"id": "team_name",     "label": "Team name",     "type": "text",  "required": True,  "predefined": True, "order": 1},
    {"id": "captain_name",  "label": "Captain name",  "type": "text",  "required": True,  "predefined": True, "order": 2},
    {"id": "captain_phone", "label": "Captain phone", "type": "phone", "required": True,  "predefined": True, "order": 3},
    {"id": "captain_email", "label": "Captain email", "type": "email", "required": True,  "predefined": True, "order": 4},
]

_DEFAULT_PARTICIPANT_FIELDS: list[dict[str, Any]] = [
    {"id": "full_name",     "label": "Full name",      "type": "text",     "required": True,  "predefined": True, "order": 1},
    {"id": "date_of_birth", "label": "Date of birth",  "type": "date",     "required": True,  "predefined": True, "order": 2},
    {"id": "blood_group",   "label": "Blood group",    "type": "dropdown", "required": False, "predefined": True, "order": 3,
     "options": ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"]},
    {"id": "jersey_size",   "label": "Jersey size",    "type": "dropdown", "required": False, "predefined": True, "order": 4,
     "options": ["XS", "S", "M", "L", "XL", "XXL"]},
]


def _normalize_team_section(
    raw_fields: list[Any],
    *,
    section_label: str,
    locked_id: str,
    custom_count_ref: list[int],
    max_custom: int = 10,
) -> list[dict[str, Any]]:
    """Validate and normalise one section of a team field_config."""
    if not isinstance(raw_fields, list) or len(raw_fields) > len(PREDEFINED_FIELD_IDS) + max_custom:
        raise ValueError(f"{section_label} configuration is invalid")

    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(raw_fields, start=1):
        if not isinstance(raw, dict):
            raise ValueError(f"{section_label} field configuration is invalid")
        field_id = _clean_text(raw.get("id"), f"{section_label} field id", max_length=60)
        if field_id in seen:
            raise ValueError(f"{section_label} field ids must be unique")
        seen.add(field_id)
        predefined = bool(raw.get("predefined", field_id in PREDEFINED_FIELD_IDS))
        if predefined:
            if field_id not in PREDEFINED_FIELD_IDS:
                raise ValueError(f"Unknown predefined field '{field_id}' in {section_label}")
            definition = PREDEFINED_FIELD_DEFINITIONS[field_id]
            field_type = definition["type"]
            label = definition["label"]
            required = bool(raw.get("required", definition["required"]))
        else:
            custom_count_ref[0] += 1
            if custom_count_ref[0] > max_custom or not _FIELD_ID_PATTERN.fullmatch(field_id):
                raise ValueError(f"A maximum of {max_custom} custom participant fields is allowed across all sections")
            field_type = _clean_text(raw.get("type"), "Custom participant field type", max_length=20)
            if field_type not in CUSTOM_FIELD_TYPES:
                raise ValueError("Unsupported custom participant field type")
            label = _clean_text(raw.get("label"), "Custom participant field label")
            required = bool(raw.get("required", False))

        # Locked field is always required
        if field_id == locked_id:
            required = True

        field: dict[str, Any] = {
            "id": field_id,
            "label": label,
            "type": field_type,
            "required": required,
            "predefined": predefined,
            "order": index,
        }
        if field_type in {"select", "dropdown"}:
            raw_options = raw.get("options")
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

    # Ensure the locked field is present
    if not any(f["id"] == locked_id for f in normalized):
        raise ValueError(f"'{locked_id}' is required and cannot be removed from {section_label}")
    return normalized


def normalize_team_field_config(config: dict[str, Any] | None) -> dict[str, Any]:
    """Normalise a two-section team field_config.

    Returns a dict with keys:
      ``main_registrant_fields`` — Section A (captain / team info, once per entry)
      ``participant_fields``     — Section B (per-member fields)
      ``fields``                 — empty list kept for schema compatibility
    """
    if not config:
        return {
            "main_registrant_fields": list(_DEFAULT_MAIN_REGISTRANT_FIELDS),
            "participant_fields": list(_DEFAULT_PARTICIPANT_FIELDS),
            "fields": [],
        }

    custom_count_ref: list[int] = [0]  # mutable counter shared across both sections

    raw_main = config.get("main_registrant_fields")
    if raw_main is None:
        main_fields = list(_DEFAULT_MAIN_REGISTRANT_FIELDS)
    else:
        main_fields = _normalize_team_section(
            raw_main,
            section_label="Main registrant fields",
            locked_id="team_name",
            custom_count_ref=custom_count_ref,
        )

    raw_participant = config.get("participant_fields")
    if raw_participant is None:
        participant_fields = list(_DEFAULT_PARTICIPANT_FIELDS)
    else:
        participant_fields = _normalize_team_section(
            raw_participant,
            section_label="Per-participant fields",
            locked_id="full_name",
            custom_count_ref=custom_count_ref,
        )

    return {
        "main_registrant_fields": main_fields,
        "participant_fields": participant_fields,
        "fields": [],
    }


def is_team_field_config(config: dict[str, Any] | None) -> bool:
    """Return True if config uses the two-section team layout."""
    return bool(config and ("main_registrant_fields" in config or "participant_fields" in config))


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
    if is_team_field_config(field_config):
        return (normalize_team_field_config(field_config), normalize_addon_config(addon_config))
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
    is_team_member: bool = False,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Validate responses and compute the registration total.

    For team registrations, set ``is_team_member=True`` for participant indices
    > 0 so that per-member rows are validated against ``participant_fields``
    only (no email/phone contact check applies).  For participant index 0 (the
    captain) or any non-team registration, leave ``is_team_member=False``.
    """
    responses = responses or {}
    selections = selections or {}

    # Choose the correct field list depending on config type and participant role
    if is_team_field_config(field_config):
        if is_team_member:
            # Per-member row: validate against Section B only
            fields = field_config.get("participant_fields", [])
            require_contact = False
        else:
            # Captain / primary registrant: validate Section A + Section B combined
            fields = field_config.get("main_registrant_fields", []) + field_config.get("participant_fields", [])
            require_contact = True
    else:
        fields = field_config["fields"]
        require_contact = True

    known_fields = {field["id"]: field for field in fields}
    # ``email`` and ``phone`` are shared-contact keys merged onto every member row
    # by the registration service (see _merge_shared_contact). They are entry-level
    # contact values, not per-member fields, so they are always allowed even when
    # the field config exposes contact as ``captain_email``/``captain_phone`` only.
    SHARED_CONTACT_KEYS = {"email", "phone"}
    unknown_fields = set(responses) - set(known_fields) - SHARED_CONTACT_KEYS
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
    # Carry through the merged shared-contact keys so the participant record and the
    # contact check below can see them, even when they are not declared fields (a
    # team config exposes contact as captain_email/captain_phone).
    for contact_key in ("email", "phone"):
        raw_contact = responses.get(contact_key)
        if contact_key not in normalized_responses and raw_contact not in (None, ""):
            normalized_responses[contact_key] = _clean_text(raw_contact, contact_key.capitalize(), max_length=320)
    # Mirror captain contact onto the plain email/phone keys used by the participant record.
    if not normalized_responses.get("email") and normalized_responses.get("captain_email"):
        normalized_responses["email"] = normalized_responses["captain_email"]
    if not normalized_responses.get("phone") and normalized_responses.get("captain_phone"):
        normalized_responses["phone"] = normalized_responses["captain_phone"]
    if require_contact and not normalized_responses.get("email") and not normalized_responses.get("phone") \
            and not normalized_responses.get("captain_email") and not normalized_responses.get("captain_phone"):
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
