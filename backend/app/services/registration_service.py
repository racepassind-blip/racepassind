from __future__ import annotations

import base64
import csv
import datetime as dt
import hmac
import io
import json
import secrets
from decimal import Decimal
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.services.auth_service import hash_opaque_token, normalize_email, normalize_phone, utc_now
from app.services.audit_service import record_audit
from app.services.payment_service import normalize_payment_reference, validate_manual_upi_settings
from app.services.registration_config_service import calculate_registration_total, normalize_event_configs
from app.services.ticket_service import serialize_ticket, ticket_token_for_registration
from app.services.organizer_visibility_service import _authorized_event_ids, get_visibility_for_events, serialize_visibility, visibility_filter_for_events
from models import Event, EventPaymentSettings, Order, OrderItem, Organization, OrganizationMember, Participant, Payment, Registration, Ticket, User


def _human_reference() -> str:
    return f"RP-{secrets.token_hex(5).upper()}"


def _claim_code() -> str:
    return secrets.token_urlsafe(8).replace("-", "").replace("_", "")[:10].upper()


def _confirmation_token() -> str:
    return secrets.token_urlsafe(40)


def registration_query():
    return select(Registration).options(
        selectinload(Registration.participant),
        selectinload(Registration.ticket).selectinload(Ticket.category),
        selectinload(Registration.payment),
        selectinload(Registration.user),
    )


def serialize_registration(registration: Registration, *, confirmation_token: str | None = None, claim_code: str | None = None) -> dict:
    payment = registration.payment
    return {
        "id": str(registration.id),
        "registrationReference": registration.registration_reference,
        "eventId": str(registration.event_id),
        "ticketId": str(registration.ticket_id),
        "participant": {
            "name": registration.participant.name,
            "email": registration.participant.email,
            "phone": registration.participant.phone,
            "dateOfBirth": registration.participant.date_of_birth,
            "gender": registration.participant.gender,
            "jerseySize": registration.participant.jersey_size,
            "emergencyContact": registration.participant.emergency_contact,
            "teamName": registration.participant.team_name,
        },
        "quantity": registration.quantity,
        "amountPaise": registration.total_amount_paise,
        "responses": registration.responses or {},
        "selections": registration.selections or {},
        "computedTotal": registration.computed_total or {},
        "currency": "INR",
        "status": registration.status,
        "checkInStatus": "checked_in" if registration.checked_in or registration.status == "checked_in" else "not_checked_in",
        "checkedInAt": registration.checked_in_at,
        "paymentStatus": registration.payment_status,
        "source": registration.source,
        "isManualEntry": registration.source == "manual",
        "receivedAmountPaise": payment.received_amount_paise if payment else None,
        "utrReference": payment.utr_reference if payment else None,
        "reservedUntil": registration.reserved_until,
        "ticketToken": None,
        "confirmationToken": confirmation_token,
        "claimCode": claim_code,
    }


def _load_idempotent_registration(db: Session, idempotency_key: str | None) -> Registration | None:
    if not idempotency_key:
        return None
    existing_order = db.scalar(select(Order).where(Order.idempotency_key == idempotency_key))
    if not existing_order or not existing_order.items:
        return None
    return db.scalar(registration_query().where(Registration.id == existing_order.items[0].registration_id))


def _registration_responses(payload) -> dict:
    responses = dict(payload.responses or {})
    legacy_values = {
        "full_name": payload.full_name,
        "email": payload.email,
        "phone": payload.phone,
        "date_of_birth": payload.date_of_birth.isoformat() if payload.date_of_birth else None,
        "gender": payload.gender,
        "jersey_size": payload.jersey_size,
        "emergency_contact_name": payload.emergency_contact,
        "team_name": payload.team_name,
    }
    for field_id, value in legacy_values.items():
        if field_id not in responses and value not in (None, ""):
            responses[field_id] = value
    return responses


def create_guest_registration(db: Session, payload, *, idempotency_key: str | None, user_id=None) -> tuple[Registration, str, str]:
    existing = _load_idempotent_registration(db, idempotency_key)
    if existing is not None:
        return existing, "", ""

    event = db.scalar(
        select(Event)
        .options(selectinload(Event.payment_settings))
        .where(Event.id == payload.event_id)
        .with_for_update()
    )
    ticket = db.scalar(select(Ticket).where(Ticket.id == payload.ticket_id).with_for_update())
    # The first lookup can race with another transaction. Once the inventory row
    # is locked, a committed request with this key must be replayed rather than
    # attempting a second insert into the unique orders.idempotency_key index.
    existing = _load_idempotent_registration(db, idempotency_key)
    if existing is not None:
        return existing, "", ""
    if event is None or ticket is None or ticket.event_id != payload.event_id:
        raise ValueError("Event or ticket not found")
    if event.status != "published" or event.archived_at is not None:
        raise ValueError("Event is not available for registration")
    if event.registration_status != "open":
        raise ValueError("Registration is closed")
    if not ticket.is_active:
        raise ValueError("Ticket is not available")
    now = utc_now()
    for value, label in ((ticket.sale_start, "Ticket sales have not opened"), (ticket.sale_end, "Ticket sales have closed")):
        if value is None:
            continue
        aware_value = value if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)
        if label.endswith("opened") and now < aware_value:
            raise ValueError(label)
        if label.endswith("closed") and now > aware_value:
            raise ValueError(label)
    if ticket.available < 1:
        raise ValueError("Ticket is sold out")

    field_config, addon_config = normalize_event_configs(event.field_config, event.addon_config)
    try:
        responses, selections, computed_total = calculate_registration_total(
            field_config,
            addon_config,
            _registration_responses(payload),
            payload.selections,
            base_fee_paise=ticket.price,
        )
    except ValueError:
        raise
    amount_paise = computed_total["totalPaise"]
    if amount_paise > 0:
        if event.payment_settings is None:
            raise ValueError("Manual UPI payment settings are not configured")
        validate_manual_upi_settings(event.payment_settings)
    computed_total["fieldConfig"] = field_config
    computed_total["addonConfig"] = addon_config
    is_free = amount_paise == 0
    confirmation_token = _confirmation_token()
    claim_code = _claim_code()
    reservation_until = None
    participant_name = str(responses["full_name"])
    email_value = responses.get("email")
    phone_value = responses.get("phone")
    emergency_name = responses.get("emergency_contact_name")
    emergency_phone = responses.get("emergency_contact_phone")
    emergency_contact = " / ".join(str(value) for value in (emergency_name, emergency_phone) if value) or None
    date_of_birth = None
    if responses.get("date_of_birth"):
        date_of_birth = dt.date.fromisoformat(str(responses["date_of_birth"]))
    participant = Participant(
        name=participant_name,
        email=normalize_email(str(email_value)) if email_value else None,
        normalized_email=normalize_email(str(email_value)) if email_value else None,
        phone=str(phone_value).strip() if phone_value else None,
        normalized_phone=normalize_phone(str(phone_value)) if phone_value else None,
        date_of_birth=date_of_birth,
        gender=str(responses["gender"]) if responses.get("gender") else None,
        jersey_size=str(responses["jersey_size"]) if responses.get("jersey_size") else None,
        emergency_contact=emergency_contact,
        team_name=str(responses["team_name"]) if responses.get("team_name") else None,
    )
    db.add(participant)
    db.flush()
    registration = Registration(
        event_id=event.id,
        participant_id=participant.id,
        user_id=user_id,
        ticket_id=ticket.id,
        category_id=ticket.category_id,
        status="confirmed" if is_free else "awaiting_payment",
        payment_status="not_required" if is_free else "pending",
        quantity=1,
        unit_price_paise=amount_paise,
        total_amount_paise=amount_paise,
        responses=responses,
        selections=selections,
        computed_total=computed_total,
        registration_reference=_human_reference(),
        confirmation_token_hash=hash_opaque_token(confirmation_token),
        claim_code_hash=hash_opaque_token(claim_code),
        claim_code_expires_at=now + dt.timedelta(days=7),
        reserved_until=reservation_until,
    )
    ticket.quantity_reserved += 1
    db.add(registration)
    db.flush()
    if is_free:
        _release_reservation(ticket, 1)
        ticket.quantity_sold += registration.quantity
        event.participants += registration.quantity
        registration.ticket_token_hash = hash_opaque_token(ticket_token_for_registration(registration))
    order = Order(
        user_id=user_id,
        total_amount=Decimal(amount_paise) / Decimal(100),
        total_amount_paise=amount_paise,
        currency="INR",
        status="paid" if is_free else "pending",
        idempotency_key=idempotency_key,
    )
    db.add(order)
    db.flush()
    db.add(OrderItem(order_id=order.id, registration_id=registration.id, price=Decimal(amount_paise) / Decimal(100)))
    db.add(
        Payment(
            order_id=order.id,
            registration_id=registration.id,
            amount=Decimal(amount_paise) / Decimal(100),
            expected_amount_paise=amount_paise,
            currency="INR",
            payment_gateway="free" if is_free else "manual_upi",
            method="free" if is_free else "manual_upi",
            status="not_required" if is_free else "pending",
            paid_at=now if is_free else None,
        )
    )
    record_audit(db, actor_user_id=user_id, action="registration_created", resource_type="registration", resource_id=registration.id)
    db.commit()
    saved = db.scalar(registration_query().where(Registration.id == registration.id))
    return saved, confirmation_token, claim_code


def update_payment_reference(db: Session, confirmation_token: str, utr_reference: str | None) -> Registration:
    registration = db.scalar(
        registration_query().where(Registration.confirmation_token_hash == hash_opaque_token(confirmation_token)).with_for_update()
    )
    if registration is None:
        raise ValueError("Registration not found")
    now = utc_now()
    if registration.status not in {"awaiting_payment", "pending_verification"}:
        raise ValueError("Registration is no longer awaiting payment")
    payment = registration.payment
    if payment is None:
        raise ValueError("Payment record not found")

    normalized_reference = normalize_payment_reference(utr_reference)
    existing_reference = normalize_payment_reference(payment.utr_reference)
    if existing_reference:
        if normalized_reference == existing_reference:
            return registration
        if normalized_reference is not None:
            raise ValueError("A payment reference is already submitted for this registration")
        return registration
    if normalized_reference is None:
        return registration

    order = _lock_order_for_registration(db, registration.id)
    all_batch = _registrations_for_order(db, order.id) if order is not None else [registration]
    batch = [child for child in all_batch if child.status in {"awaiting_payment", "pending_verification"}]
    if not batch:
        return registration
    for child in batch:
        if child.payment is None:
            raise ValueError("A registration in this order has no payment record")
    for child in batch:
        child.payment.utr_reference = normalized_reference
        child.payment.submitted_at = now
        child.payment.status = "reference_submitted"
        child.payment_status = "pending_verification"
        child.status = "pending_verification"
        record_audit(
            db,
            actor_user_id=None,
            action="utr_submitted",
            resource_type="registration",
            resource_id=child.id,
            metadata={"submission_mode": "confirmation_token", "reference_present": True},
        )
    db.commit()
    return db.scalar(registration_query().where(Registration.id == registration.id))


_REVIEWABLE_REGISTRATION_STATES = {"awaiting_payment", "pending_verification"}
_REVIEWABLE_PAYMENT_STATES = {"pending", "reference_submitted"}
_LISTABLE_STATES = _REVIEWABLE_REGISTRATION_STATES | {"confirmed", "rejected", "expired", "checked_in"}
_PAYMENT_STATUS_FILTERS = _REVIEWABLE_PAYMENT_STATES | {"approved", "not_required", "rejected", "expired"}
_CHECK_IN_STATUS_FILTERS = {"all", "checked_in", "not_checked_in"}
_MAX_CSV_EXPORT_ROWS = 5000
_CSV_HEADERS = [
    "Registration reference",
    "Participant name",
    "Email",
    "Phone",
    "Race category",
    "Ticket",
    "Amount",
    "Payment status",
    "Registration status",
    "UTR",
    "Registration date",
    "Check-in status",
]


def _active_organization_ids_for_user(user):
    return select(OrganizationMember.organization_id).join(
        Organization, Organization.id == OrganizationMember.organization_id
    ).where(
        OrganizationMember.user_id == user.id,
        OrganizationMember.member_role == "organizer",
        Organization.status == "active",
    )


def _scoped_registration_query(user):
    query = (
        select(Registration)
        .join(Event, Event.id == Registration.event_id)
        .join(Organization, Organization.id == Event.organization_id)
        .where(Organization.status == "active")
    )
    if user.role != "admin":
        query = query.where(Event.organization_id.in_(_active_organization_ids_for_user(user)))
    return query


def serialize_organizer_registration(registration: Registration, event: Event) -> dict:
    payment = registration.payment
    ticket = registration.ticket
    is_checked_in = registration.checked_in or registration.status == "checked_in"
    return {
        "id": str(registration.id),
        "registrationReference": registration.registration_reference,
        "event": {"id": str(event.id), "name": event.name},
        "participant": {
            "name": registration.participant.name,
            "email": registration.participant.email,
            "phone": registration.participant.phone,
        },
        "ticket": {
            "id": str(ticket.id),
            "name": ticket.name,
            "category": ticket.category.name if ticket.category else None,
        },
        "amountPaise": registration.total_amount_paise,
        "responses": registration.responses or {},
        "selections": registration.selections or {},
        "computedTotal": registration.computed_total or {},
        "currency": "INR",
        "status": registration.status,
        "paymentStatus": registration.payment_status,
        "source": registration.source,
        "isManualEntry": registration.source == "manual",
        "receivedAmountPaise": payment.received_amount_paise if payment else None,
        "checkInStatus": "checked_in" if is_checked_in else "not_checked_in",
        "checkedInAt": registration.checked_in_at,
        "utrReference": payment.utr_reference if payment else None,
        "reservedUntil": registration.reserved_until,
        "createdAt": registration.created_at,
        "submittedAt": payment.submitted_at if payment else None,
        "decisionReason": payment.decision_reason if payment else None,
        "reviewedAt": payment.reviewed_at if payment else None,
    }


def _normalize_filter(value: str | None) -> str | None:
    normalized = value.strip() if value else ""
    return normalized or None


def _organizer_registration_query(
    db: Session,
    user,
    *,
    event_id: UUID | None = None,
    category_id: UUID | None = None,
    ticket_id: UUID | None = None,
    status_filter: str | None = None,
    search: str | None = None,
    participant_search: str | None = None,
    email_search: str | None = None,
    phone_search: str | None = None,
    registration_reference: str | None = None,
    payment_status: str | None = None,
    check_in_status: str | None = None,
    visibility_by_event: dict[UUID, dict] | None = None,
    visibility_event_ids: list[UUID] | None = None,
):
    query = _scoped_registration_query(user).add_columns(Event).options(
        joinedload(Registration.participant),
        joinedload(Registration.ticket).joinedload(Ticket.category),
        joinedload(Registration.payment),
    ).join(Participant, Participant.id == Registration.participant_id)

    if visibility_event_ids is None:
        visibility_event_ids = _authorized_event_ids(db, user, event_id)
    if visibility_by_event is None:
        visibility_by_event = get_visibility_for_events(db, user, visibility_event_ids)
    visibility_filter = visibility_filter_for_events(
        db,
        user,
        visibility_event_ids,
        visibility_by_event=visibility_by_event,
    )
    if visibility_filter is not None:
        ranked_registrations, visibility_condition = visibility_filter
        query = query.outerjoin(ranked_registrations, ranked_registrations.c.registration_id == Registration.id).where(visibility_condition)

    if event_id is not None:
        query = query.where(Registration.event_id == event_id)
    if category_id is not None:
        query = query.where(Registration.category_id == category_id)
    if ticket_id is not None:
        query = query.where(Registration.ticket_id == ticket_id)

    normalized_status = _normalize_filter(status_filter)
    if normalized_status in {None, "pending"}:
        query = query.where(Registration.status.in_(_REVIEWABLE_REGISTRATION_STATES))
    elif normalized_status == "all":
        query = query.where(Registration.status.in_(_LISTABLE_STATES))
    elif normalized_status in _LISTABLE_STATES:
        query = query.where(Registration.status == normalized_status)
    else:
        raise ValueError("Unsupported registration status filter")

    normalized_payment_status = _normalize_filter(payment_status)
    if normalized_payment_status is not None:
        if normalized_payment_status not in _PAYMENT_STATUS_FILTERS:
            raise ValueError("Unsupported payment status filter")
        query = query.where(Registration.payment_status == normalized_payment_status)

    normalized_check_in_status = _normalize_filter(check_in_status) or "all"
    if normalized_check_in_status not in _CHECK_IN_STATUS_FILTERS:
        raise ValueError("Unsupported check-in status filter")
    if normalized_check_in_status == "checked_in":
        query = query.where(or_(Registration.checked_in.is_(True), Registration.status == "checked_in"))
    elif normalized_check_in_status == "not_checked_in":
        query = query.where(and_(Registration.checked_in.is_(False), Registration.status != "checked_in"))

    for value, column in (
        (search, None),
        (participant_search, Participant.name),
        (email_search, Participant.email),
        (phone_search, Participant.phone),
        (registration_reference, Registration.registration_reference),
    ):
        normalized_value = _normalize_filter(value)
        if not normalized_value:
            continue
        pattern = f"%{normalized_value}%"
        if column is None:
            query = query.where(
                or_(
                    Participant.name.ilike(pattern),
                    Participant.email.ilike(pattern),
                    Participant.phone.ilike(pattern),
                    Registration.registration_reference.ilike(pattern),
                )
            )
        else:
            query = query.where(column.ilike(pattern))
    return query


def _encode_registration_cursor(created_at: dt.datetime, registration_id: UUID) -> str:
    payload = json.dumps({"createdAt": created_at.isoformat(), "id": str(registration_id)}, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")


def _decode_registration_cursor(cursor: str) -> tuple[dt.datetime, UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
        created_at = dt.datetime.fromisoformat(payload["createdAt"])
        registration_id = UUID(payload["id"])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError, UnicodeError) as exc:
        raise ValueError("Invalid registration cursor") from exc
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=dt.timezone.utc)
    return created_at, registration_id


def list_organizer_registrations(
    db: Session,
    user,
    *,
    event_id: UUID | None = None,
    category_id: UUID | None = None,
    ticket_id: UUID | None = None,
    status_filter: str | None = None,
    search: str | None = None,
    participant_search: str | None = None,
    email_search: str | None = None,
    phone_search: str | None = None,
    registration_reference: str | None = None,
    payment_status: str | None = None,
    check_in_status: str | None = None,
    page_size: int = 50,
    cursor: str | None = None,
    visibility_by_event: dict[UUID, dict] | None = None,
    visibility_event_ids: list[UUID] | None = None,
) -> dict:
    authorized_event_ids = visibility_event_ids if visibility_event_ids is not None else _authorized_event_ids(db, user, event_id)
    if visibility_by_event is None:
        visibility_by_event = get_visibility_for_events(db, user, authorized_event_ids)
    query = _organizer_registration_query(
        db,
        user,
        event_id=event_id,
        category_id=category_id,
        ticket_id=ticket_id,
        status_filter=status_filter,
        search=search,
        participant_search=participant_search,
        email_search=email_search,
        phone_search=phone_search,
        registration_reference=registration_reference,
        payment_status=payment_status,
        check_in_status=check_in_status,
        visibility_by_event=visibility_by_event,
        visibility_event_ids=authorized_event_ids,
    )
    if cursor:
        cursor_created_at, cursor_id = _decode_registration_cursor(cursor)
        query = query.where(
            or_(
                Registration.created_at < cursor_created_at,
                and_(Registration.created_at == cursor_created_at, Registration.id < cursor_id),
            )
        )

    rows = db.execute(
        query.order_by(Registration.created_at.desc(), Registration.id.desc()).limit(page_size + 1)
    ).all()
    has_more = len(rows) > page_size
    page_rows = rows[:page_size]
    items = [serialize_organizer_registration(registration, event) for registration, event in page_rows]
    next_cursor = None
    if has_more and page_rows:
        last_registration = page_rows[-1][0]
        next_cursor = _encode_registration_cursor(last_registration.created_at, last_registration.id)
    if event_id is not None and event_id in visibility_by_event:
        visibility_response = serialize_visibility(visibility_by_event[event_id])
    else:
        visibility_response = {
            "plan": None,
            "upgradePlan": None,
            "planLimit": None,
            "effectiveLimit": None,
            "totalConfirmedQuantity": sum(item["totalConfirmedQuantity"] for item in visibility_by_event.values()),
            "visibleConfirmedQuantity": sum(item["visibleConfirmedQuantity"] for item in visibility_by_event.values()),
            "lockedConfirmedQuantity": sum(item["lockedConfirmedQuantity"] for item in visibility_by_event.values()),
            "lockedConfirmedRecords": sum(item["lockedConfirmedRecords"] for item in visibility_by_event.values()),
            "visibleConfirmedRecords": sum(item["visibleConfirmedRecords"] for item in visibility_by_event.values()),
            "visibleCheckedInQuantity": sum(item["visibleCheckedInQuantity"] for item in visibility_by_event.values()),
            "visibleCheckedInRecords": sum(item["visibleCheckedInRecords"] for item in visibility_by_event.values()),
            "visibleApprovedAmountPaise": sum(item["visibleApprovedAmountPaise"] for item in visibility_by_event.values()),
            "graceActive": any(item["graceActive"] for item in visibility_by_event.values()),
            "graceEndsAt": next((item["graceEndsAt"] for item in visibility_by_event.values() if item["graceEndsAt"]), None),
            "lockedSummary": next((item["lockedSummary"] for item in visibility_by_event.values() if item["lockedSummary"]), None),
            "isLocked": any(item["isLocked"] for item in visibility_by_event.values()),
        }
    return {"items": items, "nextCursor": next_cursor, "hasMore": has_more, "visibility": visibility_response}


def list_pending_registrations(
    db: Session,
    user,
    *,
    event_id=None,
    status_filter: str | None = None,
    search: str | None = None,
    limit: int = 50,
) -> list[dict]:
    # Backward-compatible service shape for existing payment-decision callers/tests.
    return list_organizer_registrations(
        db,
        user,
        event_id=event_id,
        status_filter=status_filter,
        search=search,
        page_size=limit,
    )["items"]


class CsvExportTooLargeError(ValueError):
    pass


def _authorized_event_for_organizer(db: Session, user, event_id: UUID) -> Event | None:
    query = (
        select(Event)
        .join(Organization, Organization.id == Event.organization_id)
        .where(Event.id == event_id, Organization.status == "active")
    )
    if user.role != "admin":
        query = query.where(Event.organization_id.in_(_active_organization_ids_for_user(user)))
    return db.scalar(query)


def _csv_cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, (dt.datetime, dt.date)):
        text = value.isoformat()
    else:
        text = str(value)
    if text.startswith(("=", "+", "-", "@")):
        return f"'{text}"
    return text


def _csv_amount(amount_paise: int | None) -> str:
    if amount_paise is None:
        return ""
    return f"INR {amount_paise / 100:.2f}"


def _export_config_definitions(event: Event, rows: list[tuple[Registration, Event]]) -> tuple[list[dict], list[dict]]:
    field_definitions: dict[str, dict] = {}
    addon_definitions: dict[str, dict] = {}
    current_field_config = event.field_config or {}
    current_addon_config = event.addon_config or {}
    for field in current_field_config.get("fields", []) if isinstance(current_field_config, dict) else []:
        if isinstance(field, dict) and field.get("id"):
            field_definitions[field["id"]] = field
    for addon in current_addon_config.get("addons", []) if isinstance(current_addon_config, dict) else []:
        if isinstance(addon, dict) and addon.get("id"):
            addon_definitions[addon["id"]] = addon
    for registration, _ in rows:
        snapshot = registration.computed_total or {}
        for field in snapshot.get("fieldConfig", {}).get("fields", []) if isinstance(snapshot, dict) else []:
            if isinstance(field, dict) and field.get("id"):
                field_definitions.setdefault(field["id"], field)
        for addon in snapshot.get("addonConfig", {}).get("addons", []) if isinstance(snapshot, dict) else []:
            if isinstance(addon, dict) and addon.get("id"):
                addon_definitions.setdefault(addon["id"], addon)
    return list(field_definitions.values()), list(addon_definitions.values())


def _legacy_response_value(registration: Registration, field_id: str):
    responses = registration.responses or {}
    if field_id in responses:
        return responses[field_id]
    participant = registration.participant
    return {
        "full_name": participant.name,
        "email": participant.email,
        "phone": participant.phone,
        "date_of_birth": participant.date_of_birth,
        "gender": participant.gender,
        "jersey_size": participant.jersey_size,
        "emergency_contact_name": participant.emergency_contact,
        "team_name": participant.team_name,
    }.get(field_id)


def _addon_export_value(registration: Registration, addon_id: str) -> str:
    selection = (registration.selections or {}).get(addon_id)
    if not isinstance(selection, dict):
        return ""
    if "selected" in selection:
        return str(selection["selected"])
    if "qty" in selection:
        return str(selection["qty"])
    return ""


def export_organizer_registrations_csv(
    db: Session,
    user,
    *,
    event_id: UUID,
    category_id: UUID | None = None,
    ticket_id: UUID | None = None,
    status_filter: str | None = None,
    search: str | None = None,
    participant_search: str | None = None,
    email_search: str | None = None,
    phone_search: str | None = None,
    registration_reference: str | None = None,
    payment_status: str | None = None,
    check_in_status: str | None = None,
) -> str:
    event = _authorized_event_for_organizer(db, user, event_id)
    if event is None:
        raise ValueError("Event not found")

    rows = db.execute(
        _organizer_registration_query(
            db,
            user,
            event_id=event_id,
            category_id=category_id,
            ticket_id=ticket_id,
            status_filter=status_filter,
            search=search,
            participant_search=participant_search,
            email_search=email_search,
            phone_search=phone_search,
            registration_reference=registration_reference,
            payment_status=payment_status,
            check_in_status=check_in_status,
            visibility_event_ids=[event_id],
        ).order_by(Registration.created_at.desc(), Registration.id.desc()).limit(_MAX_CSV_EXPORT_ROWS + 1)
    ).all()
    if len(rows) > _MAX_CSV_EXPORT_ROWS:
        record_audit(
            db,
            actor_user_id=user.id,
            action="organizer_registration_export_rejected",
            resource_type="event",
            resource_id=event_id,
            metadata={"reason": "row_limit", "max_rows": _MAX_CSV_EXPORT_ROWS},
        )
        db.commit()
        raise CsvExportTooLargeError(f"Export exceeds the {_MAX_CSV_EXPORT_ROWS}-row limit")

    field_definitions, addon_definitions = _export_config_definitions(event, rows)
    dynamic_headers = [field.get("label", field.get("id", "")) for field in field_definitions]
    dynamic_headers += [f"Add-on: {addon.get('name', addon.get('id', ''))}" for addon in addon_definitions]
    if field_definitions or addon_definitions or any(registration.computed_total for registration, _ in rows):
        dynamic_headers.append("Computed total")

    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(_CSV_HEADERS + dynamic_headers)
    for registration, _ in rows:
        ticket = registration.ticket
        payment = registration.payment
        is_checked_in = registration.checked_in or registration.status == "checked_in"
        dynamic_values = [
            _csv_cell(_legacy_response_value(registration, field.get("id", "")))
            for field in field_definitions
        ]
        dynamic_values.extend(
            _csv_cell(_addon_export_value(registration, addon.get("id", "")))
            for addon in addon_definitions
        )
        if field_definitions or addon_definitions or registration.computed_total:
            dynamic_values.append(_csv_cell(_csv_amount(registration.total_amount_paise)))
        writer.writerow([
            _csv_cell(registration.registration_reference),
            _csv_cell(registration.participant.name),
            _csv_cell(registration.participant.email),
            _csv_cell(registration.participant.phone),
            _csv_cell(ticket.category.name if ticket.category else None),
            _csv_cell(ticket.name),
            _csv_cell(_csv_amount(registration.total_amount_paise)),
            _csv_cell(registration.payment_status),
            _csv_cell(registration.status),
            _csv_cell(payment.utr_reference if payment else None),
            _csv_cell(registration.created_at),
            _csv_cell("checked_in" if is_checked_in else "not_checked_in"),
            *dynamic_values,
        ])
    record_audit(
        db,
        actor_user_id=user.id,
        action="organizer_registrations_exported",
        resource_type="event",
        resource_id=event_id,
        metadata={"row_count": len(rows), "filter_count": sum(value is not None for value in (
            category_id, ticket_id, status_filter, search, participant_search, email_search,
            phone_search, registration_reference, payment_status, check_in_status,
        ))},
    )
    db.commit()
    return output.getvalue()


def _reload_organizer_registration(db: Session, registration_id):
    registration = db.scalar(registration_query().where(Registration.id == registration_id))
    if registration is None:
        raise ValueError("Registration not found")
    event = db.get(Event, registration.event_id)
    return registration, event


def _lock_order_for_registration(db: Session, registration_id):
    return db.scalar(
        select(Order)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .where(OrderItem.registration_id == registration_id)
        .with_for_update()
    )


def _release_reservation(ticket: Ticket, quantity: int) -> None:
    ticket.quantity_reserved = max(0, ticket.quantity_reserved - quantity)


def decide_registration_payment(db: Session, user, event_id, registration_id, *, decision: str, reason: str | None = None):
    if decision not in {"approve", "reject"}:
        raise ValueError("Unsupported payment decision")
    if decision == "reject" and not reason:
        raise ValueError("A rejection reason is required")

    registration = db.scalar(
        _scoped_registration_query(user).where(
            Registration.id == registration_id,
            Registration.event_id == event_id,
        ).with_for_update()
    )
    if registration is None:
        raise ValueError("Registration not found")
    order = _lock_order_for_registration(db, registration.id)
    all_batch = _registrations_for_order(db, order.id) if order is not None else [registration]
    batch = [child for child in all_batch if child.status in _REVIEWABLE_REGISTRATION_STATES]
    if not batch:
        return _reload_organizer_registration(db, registration.id)
    payments: dict[UUID, Payment] = {}
    tickets: dict[UUID, Ticket] = {}
    for child in batch:
        payment = db.scalar(select(Payment).where(Payment.registration_id == child.id).with_for_update())
        ticket = db.scalar(select(Ticket).where(Ticket.id == child.ticket_id).with_for_update())
        if payment is None or ticket is None:
            raise ValueError("Registration payment data is incomplete")
        payments[child.id] = payment
        tickets[child.id] = ticket
    now = utc_now()

    if all(
        (child.status == "confirmed" and payments[child.id].status == "approved")
        if decision == "approve"
        else (child.status == "rejected" and payments[child.id].status == "rejected")
        for child in batch
    ):
        record_audit(
            db,
            actor_user_id=user.id,
            action="payment_approval_idempotent" if decision == "approve" else "payment_rejection_idempotent",
            resource_type="registration",
            resource_id=registration.id,
            metadata={"decision": decision, "alreadyFinalized": True, "batchSize": len(batch)},
        )
        db.commit()
        return _reload_organizer_registration(db, registration.id)

    if any(
        child.status not in _REVIEWABLE_REGISTRATION_STATES or payments[child.id].status not in _REVIEWABLE_PAYMENT_STATES
        for child in batch
    ):
        raise ValueError("A registration in this order is no longer awaiting payment review")
    if any(tickets[child.id].quantity_reserved < child.quantity for child in batch):
        raise ValueError("A registration reservation is no longer available")

    event = db.get(Event, event_id)
    for child in batch:
        payment = payments[child.id]
        ticket = tickets[child.id]
        payment.reviewed_by = user.id
        payment.reviewed_at = now
        payment.decision_reason = reason
        child.reserved_until = None
        _release_reservation(ticket, child.quantity)
        if decision == "approve":
            ticket.quantity_sold += child.quantity
            if event is not None:
                event.participants += child.quantity
            child.status = "confirmed"
            child.payment_status = "approved"
            payment.status = "approved"
            payment.paid_at = now
            if not child.confirmation_token_hash:
                child.confirmation_token_hash = hash_opaque_token(_confirmation_token())
            child.ticket_token_hash = hash_opaque_token(ticket_token_for_registration(child))
        else:
            child.status = "rejected"
            child.payment_status = "rejected"
            payment.status = "rejected"
        record_audit(
            db,
            actor_user_id=user.id,
            action="payment_approved" if decision == "approve" else "payment_rejected",
            resource_type="registration",
            resource_id=child.id,
            metadata={"decision": decision, "hasUtr": bool(payment.utr_reference), "batchSize": len(batch)},
        )
    if order is not None:
        order.status = "paid" if decision == "approve" else "cancelled"
    db.commit()
    return _reload_organizer_registration(db, registration.id)


def load_confirmation_registration(db: Session, confirmation_token: str) -> Registration | None:
    registration = db.scalar(
        registration_query()
        .where(Registration.confirmation_token_hash == hash_opaque_token(confirmation_token))
        .with_for_update()
    )
    if registration is None:
        return None

    return registration


def serialize_participant_registration(registration: Registration, event: Event) -> dict:
    ticket = registration.ticket
    serialized_ticket = serialize_ticket(registration)
    return {
        "id": str(registration.id),
        "registrationReference": registration.registration_reference,
        "event": {
            "id": str(event.id),
            "name": event.name,
            "date": event.date,
            "location": event.location,
            "whatsappGroupUrl": event.whatsapp_group_url if serialized_ticket is not None else None,
        },
        "participantName": registration.participant.name,
        "ticketType": {
            "name": ticket.name,
            "category": ticket.category.name if ticket.category else None,
        },
        "amountPaise": registration.total_amount_paise,
        "responses": registration.responses or {},
        "selections": registration.selections or {},
        "computedTotal": registration.computed_total or {},
        "currency": "INR",
        "status": registration.status,
        "checkInStatus": "checked_in" if registration.checked_in or registration.status == "checked_in" else "not_checked_in",
        "checkedInAt": registration.checked_in_at,
        "paymentStatus": registration.payment_status,
        "ticket": serialized_ticket,
    }


def _owned_participant_registration_query(user_id):
    return (
        select(Registration, Event)
        .join(Event, Event.id == Registration.event_id)
        .options(
            selectinload(Registration.participant),
            selectinload(Registration.ticket).selectinload(Ticket.category),
            selectinload(Registration.payment),
        )
        .where(Registration.user_id == user_id)
    )


def link_verified_contact_registrations(db: Session, user: User) -> int:
    conditions = []
    if user.email_verified_at is not None and user.normalized_email:
        conditions.append(Participant.normalized_email == user.normalized_email)
    if user.phone_verified_at is not None and user.normalized_phone:
        conditions.append(Participant.normalized_phone == user.normalized_phone)
    if not conditions:
        return 0

    candidates = db.scalars(
        select(Registration)
        .join(Participant, Participant.id == Registration.participant_id)
        .where(Registration.user_id.is_(None), or_(*conditions))
        .with_for_update()
    ).all()
    linked = 0
    for registration in candidates:
        if registration.user_id is not None:
            continue
        registration.user_id = user.id
        linked += 1
        record_audit(
            db,
            actor_user_id=user.id,
            action="registration_auto_linked",
            resource_type="registration",
            resource_id=registration.id,
            metadata={"match": "verified_contact"},
        )
    if linked:
        db.commit()
    return linked


def list_my_registrations(db: Session, user: User) -> list[dict]:
    link_verified_contact_registrations(db, user)
    rows = db.execute(
        _owned_participant_registration_query(user.id)
        .order_by(Registration.created_at.desc())
        .limit(100)
    ).all()
    return [serialize_participant_registration(registration, event) for registration, event in rows]


def _load_claim_registration(db: Session, registration_reference: str):
    return db.scalar(
        registration_query()
        .where(Registration.registration_reference == registration_reference)
        .with_for_update()
    )


def claim_registration(db: Session, user: User, *, registration_reference: str, claim_code: str) -> dict:
    registration = _load_claim_registration(db, registration_reference)
    if registration is None:
        raise ValueError("Registration not found or claim failed")
    if registration.user_id == user.id:
        registration_result, event = _reload_organizer_registration(db, registration.id)
        return serialize_participant_registration(registration_result, event)
    if registration.user_id is not None:
        raise ValueError("Registration not found or claim failed")

    now = utc_now()
    expires_at = registration.claim_code_expires_at
    if registration.claim_code_claimed_at is not None or not registration.claim_code_hash or expires_at is None:
        record_audit(
            db,
            actor_user_id=user.id,
            action="registration_claim_failed",
            resource_type="registration",
            resource_id=None,
            metadata={"reason": "expired_or_consumed"},
        )
        db.commit()
        raise ValueError("Registration not found or claim failed")
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=dt.timezone.utc)
    if now >= expires_at or not hmac.compare_digest(registration.claim_code_hash, hash_opaque_token(claim_code)):
        record_audit(
            db,
            actor_user_id=user.id,
            action="registration_claim_failed",
            resource_type="registration",
            resource_id=None,
            metadata={"reason": "invalid_claim"},
        )
        db.commit()
        raise ValueError("Registration not found or claim failed")

    registration.user_id = user.id
    registration.claim_code_claimed_at = now
    registration.claim_code_hash = None
    record_audit(
        db,
        actor_user_id=user.id,
        action="registration_claimed",
        resource_type="registration",
        resource_id=registration.id,
        metadata={"match": "claim_code"},
    )
    db.commit()
    registration_result, event = _reload_organizer_registration(db, registration.id)
    return serialize_participant_registration(registration_result, event)


def _registrations_for_order(db: Session, order_id) -> list[Registration]:
    return list(
        db.scalars(
            select(Registration)
            .join(OrderItem, OrderItem.registration_id == Registration.id)
            .where(OrderItem.order_id == order_id)
            .options(
                selectinload(Registration.participant),
                selectinload(Registration.ticket).selectinload(Ticket.category),
                selectinload(Registration.payment),
                selectinload(Registration.user),
            )
            .order_by(Registration.created_at, Registration.id)
        ).all()
    )


def create_guest_batch_registration(db: Session, payload, *, idempotency_key: str | None, user_id=None) -> tuple[list[Registration], list[str], list[str]]:
    existing = _load_idempotent_registration(db, idempotency_key)
    if existing is not None:
        order = _lock_order_for_registration(db, existing.id)
        return _registrations_for_order(db, order.id) if order is not None else [existing], [], []

    event = db.scalar(
        select(Event)
        .options(selectinload(Event.payment_settings))
        .where(Event.id == payload.event_id)
        .with_for_update()
    )
    if event is None:
        raise ValueError("Event or ticket not found")
    if event.status != "published" or event.archived_at is not None:
        raise ValueError("Event is not available for registration")
    if event.registration_status != "open":
        raise ValueError("Registration is closed")

    ticket_ids = {rider.ticket_id for rider in payload.riders}
    tickets = {
        ticket.id: ticket
        for ticket in db.scalars(
            select(Ticket).where(Ticket.id.in_(ticket_ids)).with_for_update()
        ).all()
    }
    if len(tickets) != len(ticket_ids) or any(ticket.event_id != payload.event_id for ticket in tickets.values()):
        raise ValueError("Event or ticket not found")

    now = utc_now()
    for ticket in tickets.values():
        if not ticket.is_active:
            raise ValueError("Ticket is not available")
        for value, label in ((ticket.sale_start, "Ticket sales have not opened"), (ticket.sale_end, "Ticket sales have closed")):
            if value is None:
                continue
            aware_value = value if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)
            if label.endswith("opened") and now < aware_value:
                raise ValueError(label)
            if label.endswith("closed") and now > aware_value:
                raise ValueError(label)
    requested_by_ticket: dict[UUID, int] = {}
    for rider in payload.riders:
        requested_by_ticket[rider.ticket_id] = requested_by_ticket.get(rider.ticket_id, 0) + 1
    for ticket_id, requested in requested_by_ticket.items():
        if tickets[ticket_id].available < requested:
            raise ValueError(f"Not enough spots left for {tickets[ticket_id].name}")

    field_config, addon_config = normalize_event_configs(event.field_config, event.addon_config)
    prepared: list[dict] = []
    for rider in payload.riders:
        responses, selections, computed_total = calculate_registration_total(
            field_config,
            addon_config,
            dict(rider.responses or {}),
            rider.selections,
            base_fee_paise=tickets[rider.ticket_id].price,
        )
        computed_total["fieldConfig"] = field_config
        computed_total["addonConfig"] = addon_config
        amount_paise = computed_total["totalPaise"]
        if amount_paise > 0 and event.payment_settings is None:
            raise ValueError("Manual UPI payment settings are not configured")
        prepared.append({
            "rider": rider,
            "responses": responses,
            "selections": selections,
            "computed_total": computed_total,
            "amount_paise": amount_paise,
        })

    total_amount_paise = sum(item["amount_paise"] for item in prepared)
    if total_amount_paise > 0:
        validate_manual_upi_settings(event.payment_settings)
    confirmation_tokens: list[str] = []
    claim_codes: list[str] = []
    registrations: list[Registration] = []
    for item in prepared:
        rider = item["rider"]
        responses = item["responses"]
        amount_paise = item["amount_paise"]
        is_free = amount_paise == 0
        confirmation_token = _confirmation_token()
        claim_code = _claim_code()
        confirmation_tokens.append(confirmation_token)
        claim_codes.append(claim_code)
        email_value = responses.get("email")
        phone_value = responses.get("phone")
        emergency_contact = " / ".join(str(value) for value in (
            responses.get("emergency_contact_name"), responses.get("emergency_contact_phone")
        ) if value) or None
        date_of_birth = dt.date.fromisoformat(str(responses["date_of_birth"])) if responses.get("date_of_birth") else None
        participant = Participant(
            name=str(responses["full_name"]),
            email=normalize_email(str(email_value)) if email_value else None,
            normalized_email=normalize_email(str(email_value)) if email_value else None,
            phone=str(phone_value).strip() if phone_value else None,
            normalized_phone=normalize_phone(str(phone_value)) if phone_value else None,
            date_of_birth=date_of_birth,
            gender=str(responses["gender"]) if responses.get("gender") else None,
            jersey_size=str(responses["jersey_size"]) if responses.get("jersey_size") else None,
            emergency_contact=emergency_contact,
            team_name=str(responses["team_name"]) if responses.get("team_name") else None,
        )
        db.add(participant)
        db.flush()
        ticket = tickets[rider.ticket_id]
        registration = Registration(
            event_id=event.id,
            participant_id=participant.id,
            user_id=user_id,
            ticket_id=ticket.id,
            category_id=ticket.category_id,
            status="confirmed" if is_free else "awaiting_payment",
            payment_status="not_required" if is_free else "pending",
            quantity=1,
            unit_price_paise=amount_paise,
            total_amount_paise=amount_paise,
            responses=responses,
            selections=item["selections"],
            computed_total=item["computed_total"],
            registration_reference=_human_reference(),
            confirmation_token_hash=hash_opaque_token(confirmation_token),
            claim_code_hash=hash_opaque_token(claim_code),
            claim_code_expires_at=now + dt.timedelta(days=7),
        )
        ticket.quantity_reserved += 1
        db.add(registration)
        db.flush()
        if is_free:
            _release_reservation(ticket, 1)
            ticket.quantity_sold += 1
            event.participants += 1
            registration.ticket_token_hash = hash_opaque_token(ticket_token_for_registration(registration))
        registrations.append(registration)

    order = Order(
        user_id=user_id,
        total_amount=Decimal(total_amount_paise) / Decimal(100),
        total_amount_paise=total_amount_paise,
        currency="INR",
        status="paid" if total_amount_paise == 0 else "pending",
        idempotency_key=idempotency_key,
    )
    db.add(order)
    db.flush()
    for registration in registrations:
        amount = Decimal(registration.total_amount_paise or 0) / Decimal(100)
        db.add(OrderItem(order_id=order.id, registration_id=registration.id, price=amount))
        db.add(Payment(
            order_id=order.id,
            registration_id=registration.id,
            amount=amount,
            expected_amount_paise=registration.total_amount_paise or 0,
            currency="INR",
            payment_gateway="free" if (registration.total_amount_paise or 0) == 0 else "manual_upi",
            method="free" if (registration.total_amount_paise or 0) == 0 else "manual_upi",
            status="not_required" if (registration.total_amount_paise or 0) == 0 else "pending",
            paid_at=now if (registration.total_amount_paise or 0) == 0 else None,
        ))
        record_audit(db, actor_user_id=user_id, action="registration_created", resource_type="registration", resource_id=registration.id)
    db.commit()
    saved = _registrations_for_order(db, order.id)
    return saved, confirmation_tokens, claim_codes


def create_manual_registration(db: Session, user, payload, *, idempotency_key: str | None):
    existing = _load_idempotent_registration(db, idempotency_key)
    if existing is not None:
        event = db.get(Event, existing.event_id)
        return existing, event

    event = db.scalar(
        select(Event)
        .options(selectinload(Event.payment_settings))
        .where(Event.id == payload.event_id)
        .with_for_update()
    )
    ticket = db.scalar(select(Ticket).where(Ticket.id == payload.ticket_id).with_for_update())
    existing = _load_idempotent_registration(db, idempotency_key)
    if existing is not None:
        return existing, event
    if event is None or ticket is None or ticket.event_id != payload.event_id:
        raise ValueError("Event or ticket not found")
    if event.status != "published" or event.archived_at is not None:
        raise ValueError("Event is not available for registration")
    if not ticket.is_active:
        raise ValueError("Ticket is not available")
    if ticket.available < 1:
        raise ValueError("Ticket is sold out")

    field_config, addon_config = normalize_event_configs(
        event.field_config,
        event.addon_config,
        category_options=sorted({category.distance for category in event.categories if category.distance}),
    )
    responses, selections, computed_total = calculate_registration_total(
        field_config,
        addon_config,
        payload.responses,
        payload.selections,
        base_fee_paise=ticket.price,
    )
    computed_total["fieldConfig"] = field_config
    computed_total["addonConfig"] = addon_config
    amount_paise = computed_total["totalPaise"]
    is_free = amount_paise == 0
    if payload.payment_received and not is_free and payload.received_amount_paise is None:
        raise ValueError("Received payment amount is required for a paid registration")
    if payload.payment_received and not is_free and payload.received_amount_paise <= 0:
        raise ValueError("Received payment amount must be positive")

    now = utc_now()
    confirmation_token = _confirmation_token()
    claim_code = _claim_code()
    email_value = responses.get("email")
    phone_value = responses.get("phone")
    emergency_contact = " / ".join(str(value) for value in (
        responses.get("emergency_contact_name"), responses.get("emergency_contact_phone")
    ) if value) or None
    date_of_birth = dt.date.fromisoformat(str(responses["date_of_birth"])) if responses.get("date_of_birth") else None
    participant = Participant(
        name=str(responses["full_name"]),
        email=normalize_email(str(email_value)) if email_value else None,
        normalized_email=normalize_email(str(email_value)) if email_value else None,
        phone=str(phone_value).strip() if phone_value else None,
        normalized_phone=normalize_phone(str(phone_value)) if phone_value else None,
        date_of_birth=date_of_birth,
        gender=str(responses["gender"]) if responses.get("gender") else None,
        jersey_size=str(responses["jersey_size"]) if responses.get("jersey_size") else None,
        emergency_contact=emergency_contact,
        team_name=str(responses["team_name"]) if responses.get("team_name") else None,
    )
    db.add(participant)
    db.flush()

    confirmed = is_free or payload.payment_received
    registration = Registration(
        event_id=event.id,
        participant_id=participant.id,
        user_id=None,
        ticket_id=ticket.id,
        category_id=ticket.category_id,
        status="confirmed" if confirmed else "awaiting_payment",
        payment_status="not_required" if is_free else "approved" if payload.payment_received else "pending",
        source="manual",
        quantity=1,
        unit_price_paise=amount_paise,
        total_amount_paise=amount_paise,
        responses=responses,
        selections=selections,
        computed_total=computed_total,
        registration_reference=_human_reference(),
        confirmation_token_hash=hash_opaque_token(confirmation_token),
        claim_code_hash=hash_opaque_token(claim_code),
        claim_code_expires_at=now + dt.timedelta(days=7),
    )
    ticket.quantity_reserved += 1
    db.add(registration)
    db.flush()
    if confirmed:
        _release_reservation(ticket, 1)
        ticket.quantity_sold += 1
        event.participants += 1
        registration.ticket_token_hash = hash_opaque_token(ticket_token_for_registration(registration))

    received_amount_paise = payload.received_amount_paise if payload.payment_received and not is_free else None
    payment_amount_paise = received_amount_paise if received_amount_paise is not None else amount_paise
    order = Order(
        user_id=None,
        total_amount=Decimal(amount_paise) / Decimal(100),
        total_amount_paise=amount_paise,
        currency="INR",
        status="paid" if confirmed else "pending",
        idempotency_key=idempotency_key,
    )
    db.add(order)
    db.flush()
    db.add(OrderItem(order_id=order.id, registration_id=registration.id, price=Decimal(amount_paise) / Decimal(100)))
    db.add(Payment(
        order_id=order.id,
        registration_id=registration.id,
        amount=Decimal(payment_amount_paise) / Decimal(100),
        received_amount_paise=received_amount_paise,
        expected_amount_paise=amount_paise,
        currency="INR",
        payment_gateway="manual_offline",
        method="manual_offline",
        status="not_required" if is_free else "approved" if payload.payment_received else "pending",
        paid_at=now if confirmed else None,
        reviewed_by=user.id if payload.payment_received and not is_free else None,
        reviewed_at=now if payload.payment_received and not is_free else None,
    ))
    record_audit(
        db,
        actor_user_id=user.id,
        action="manual_registration_created",
        resource_type="registration",
        resource_id=registration.id,
        metadata={
            "payment_received": bool(payload.payment_received),
            "received_amount_paise": received_amount_paise,
            "expected_amount_paise": amount_paise,
        },
    )
    db.commit()
    return _reload_organizer_registration(db, registration.id)


def load_registration_batch(db: Session, registration: Registration) -> list[Registration]:
    order = db.scalar(
        select(Order)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .where(OrderItem.registration_id == registration.id)
    )
    return _registrations_for_order(db, order.id) if order is not None else [registration]
