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
from sqlalchemy.orm import Session, selectinload

from app.services.auth_service import hash_opaque_token, normalize_email, normalize_phone, utc_now
from app.services.audit_service import record_audit
from app.services.payment_service import normalize_payment_reference, validate_manual_upi_settings
from app.services.ticket_service import serialize_ticket, ticket_token_for_registration
from models import Event, EventPaymentSettings, Order, OrderItem, Organization, OrganizationMember, Participant, Payment, Registration, Ticket, User

_RESERVATION_MINUTES = 30


def _human_reference() -> str:
    return f"RP-{secrets.token_hex(5).upper()}"


def _claim_code() -> str:
    return secrets.token_urlsafe(8).replace("-", "").replace("_", "")[:10].upper()


def _confirmation_token() -> str:
    return secrets.token_urlsafe(40)


def registration_query():
    return select(Registration).options(
        selectinload(Registration.participant),
        selectinload(Registration.ticket),
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
        "currency": "INR",
        "status": registration.status,
        "checkInStatus": "checked_in" if registration.checked_in or registration.status == "checked_in" else "not_checked_in",
        "checkedInAt": registration.checked_in_at,
        "paymentStatus": registration.payment_status,
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
    if event.payment_settings is None:
        raise ValueError("Manual UPI payment settings are not configured")
    validate_manual_upi_settings(event.payment_settings)
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

    email = normalize_email(payload.email) if payload.email else None
    phone = normalize_phone(payload.phone)
    confirmation_token = _confirmation_token()
    claim_code = _claim_code()
    reservation_until = now + dt.timedelta(minutes=_RESERVATION_MINUTES)
    amount_paise = ticket.price
    participant = Participant(
        name=payload.full_name.strip(),
        email=email,
        normalized_email=email,
        phone=payload.phone.strip() if payload.phone else None,
        normalized_phone=phone,
        date_of_birth=payload.date_of_birth,
        gender=payload.gender,
        jersey_size=payload.jersey_size,
        emergency_contact=payload.emergency_contact,
        team_name=payload.team_name,
    )
    db.add(participant)
    db.flush()
    registration = Registration(
        event_id=event.id,
        participant_id=participant.id,
        user_id=user_id,
        ticket_id=ticket.id,
        category_id=ticket.category_id,
        status="awaiting_payment",
        payment_status="pending",
        quantity=1,
        unit_price_paise=amount_paise,
        total_amount_paise=amount_paise,
        registration_reference=_human_reference(),
        confirmation_token_hash=hash_opaque_token(confirmation_token),
        claim_code_hash=hash_opaque_token(claim_code),
        claim_code_expires_at=now + dt.timedelta(days=7),
        reserved_until=reservation_until,
    )
    ticket.quantity_reserved += 1
    db.add(registration)
    db.flush()
    order = Order(
        user_id=user_id,
        total_amount=Decimal(amount_paise) / Decimal(100),
        total_amount_paise=amount_paise,
        currency="INR",
        status="pending",
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
            payment_gateway="manual_upi",
            method="manual_upi",
            status="pending",
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
    if registration.reserved_until:
        reserved_until = registration.reserved_until if registration.reserved_until.tzinfo else registration.reserved_until.replace(tzinfo=dt.timezone.utc)
        if now > reserved_until and registration.status in {"awaiting_payment", "pending_verification"}:
            raise ValueError("Registration payment window has expired")
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

    payment.utr_reference = normalized_reference
    payment.submitted_at = now
    payment.status = "reference_submitted"
    registration.payment_status = "pending_verification"
    registration.status = "pending_verification"
    record_audit(
        db,
        actor_user_id=None,
        action="utr_submitted",
        resource_type="registration",
        resource_id=registration.id,
        metadata={"submission_mode": "confirmation_token", "reference_present": True},
    )
    db.commit()
    return db.scalar(registration_query().where(Registration.id == registration.id))


_REVIEWABLE_REGISTRATION_STATES = {"awaiting_payment", "pending_verification"}
_REVIEWABLE_PAYMENT_STATES = {"pending", "reference_submitted"}
_LISTABLE_STATES = _REVIEWABLE_REGISTRATION_STATES | {"confirmed", "rejected", "expired", "checked_in"}
_PAYMENT_STATUS_FILTERS = _REVIEWABLE_PAYMENT_STATES | {"approved", "rejected", "expired"}
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


class RegistrationExpiredError(ValueError):
    pass


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
        "currency": "INR",
        "status": registration.status,
        "paymentStatus": registration.payment_status,
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
):
    query = _scoped_registration_query(user).add_columns(Event).options(
        selectinload(Registration.participant),
        selectinload(Registration.ticket).selectinload(Ticket.category),
        selectinload(Registration.payment),
    ).join(Participant, Participant.id == Registration.participant_id)

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
) -> dict:
    page_size = max(1, min(page_size, 100))
    query = _organizer_registration_query(
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
    return {"items": items, "nextCursor": next_cursor, "hasMore": has_more}


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

    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(_CSV_HEADERS)
    for registration, _ in rows:
        ticket = registration.ticket
        payment = registration.payment
        is_checked_in = registration.checked_in or registration.status == "checked_in"
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


def decide_registration_payment(db: Session, user, registration_id, *, decision: str, reason: str | None = None):
    if decision not in {"approve", "reject"}:
        raise ValueError("Unsupported payment decision")
    if decision == "reject" and not reason:
        raise ValueError("A rejection reason is required")

    registration = db.scalar(
        _scoped_registration_query(user).where(Registration.id == registration_id).with_for_update()
    )
    if registration is None:
        raise ValueError("Registration not found")
    payment = db.scalar(
        select(Payment).where(Payment.registration_id == registration.id).with_for_update()
    )
    ticket = db.scalar(select(Ticket).where(Ticket.id == registration.ticket_id).with_for_update())
    if payment is None or ticket is None:
        raise ValueError("Registration payment data is incomplete")
    order = _lock_order_for_registration(db, registration.id)
    now = utc_now()

    if decision == "approve" and registration.status == "confirmed" and payment.status == "approved":
        record_audit(
            db,
            actor_user_id=user.id,
            action="payment_approval_idempotent",
            resource_type="registration",
            resource_id=registration.id,
            metadata={"decision": "approve", "alreadyConfirmed": True},
        )
        db.commit()
        return _reload_organizer_registration(db, registration.id)
    if decision == "reject" and registration.status == "rejected" and payment.status == "rejected":
        record_audit(
            db,
            actor_user_id=user.id,
            action="payment_rejection_idempotent",
            resource_type="registration",
            resource_id=registration.id,
            metadata={"decision": "reject", "alreadyRejected": True},
        )
        db.commit()
        return _reload_organizer_registration(db, registration.id)
    if registration.status not in _REVIEWABLE_REGISTRATION_STATES or payment.status not in _REVIEWABLE_PAYMENT_STATES:
        raise ValueError("Registration is no longer awaiting payment review")

    if registration.reserved_until:
        reserved_until = registration.reserved_until if registration.reserved_until.tzinfo else registration.reserved_until.replace(tzinfo=dt.timezone.utc)
        if now > reserved_until:
            _release_reservation(ticket, registration.quantity)
            registration.status = "expired"
            registration.payment_status = "expired"
            payment.status = "expired"
            payment.reviewed_at = now
            payment.decision_reason = "Registration payment window expired"
            registration.reserved_until = None
            if order is not None:
                order.status = "expired"
            record_audit(
                db,
                actor_user_id=user.id,
                action="registration_expired",
                resource_type="registration",
                resource_id=registration.id,
                metadata={"reason": "reservation_expired"},
            )
            db.commit()
            raise RegistrationExpiredError("Registration payment window has expired")

    quantity = registration.quantity
    if ticket.quantity_reserved < quantity:
        raise ValueError("Registration reservation is no longer available")

    payment.reviewed_by = user.id
    payment.reviewed_at = now
    payment.decision_reason = reason
    registration.reserved_until = None
    if decision == "approve":
        _release_reservation(ticket, quantity)
        ticket.quantity_sold += quantity
        registration.status = "confirmed"
        registration.payment_status = "approved"
        payment.status = "approved"
        payment.paid_at = now
        if not registration.confirmation_token_hash:
            registration.confirmation_token_hash = hash_opaque_token(_confirmation_token())
        registration.ticket_token_hash = hash_opaque_token(ticket_token_for_registration(registration))
        if order is not None:
            order.status = "paid"
        audit_action = "payment_approved"
    else:
        _release_reservation(ticket, quantity)
        registration.status = "rejected"
        registration.payment_status = "rejected"
        payment.status = "rejected"
        if order is not None:
            order.status = "cancelled"
        audit_action = "payment_rejected"
    record_audit(
        db,
        actor_user_id=user.id,
        action=audit_action,
        resource_type="registration",
        resource_id=registration.id,
        metadata={"decision": decision, "hasUtr": bool(payment.utr_reference)},
    )
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

    if registration.status in _REVIEWABLE_REGISTRATION_STATES and registration.reserved_until:
        reserved_until = registration.reserved_until if registration.reserved_until.tzinfo else registration.reserved_until.replace(tzinfo=dt.timezone.utc)
        if utc_now() > reserved_until:
            payment = db.scalar(select(Payment).where(Payment.registration_id == registration.id).with_for_update())
            ticket = db.scalar(select(Ticket).where(Ticket.id == registration.ticket_id).with_for_update())
            order = _lock_order_for_registration(db, registration.id)
            if payment is not None and ticket is not None:
                now = utc_now()
                _release_reservation(ticket, registration.quantity)
                registration.status = "expired"
                registration.payment_status = "expired"
                registration.reserved_until = None
                payment.status = "expired"
                payment.reviewed_at = now
                payment.decision_reason = "Registration payment window expired"
                if order is not None:
                    order.status = "expired"
                record_audit(
                    db,
                    actor_user_id=None,
                    action="registration_expired",
                    resource_type="registration",
                    resource_id=registration.id,
                    metadata={"reason": "confirmation_lookup_expired"},
                )
                db.commit()
                return db.scalar(registration_query().where(Registration.id == registration.id))
    return registration


def serialize_participant_registration(registration: Registration, event: Event) -> dict:
    ticket = registration.ticket
    return {
        "id": str(registration.id),
        "registrationReference": registration.registration_reference,
        "event": {
            "id": str(event.id),
            "name": event.name,
            "date": event.date,
            "location": event.location,
        },
        "participantName": registration.participant.name,
        "ticketType": {
            "name": ticket.name,
            "category": ticket.category.name if ticket.category else None,
        },
        "amountPaise": registration.total_amount_paise,
        "currency": "INR",
        "status": registration.status,
        "checkInStatus": "checked_in" if registration.checked_in or registration.status == "checked_in" else "not_checked_in",
        "checkedInAt": registration.checked_in_at,
        "paymentStatus": registration.payment_status,
        "ticket": serialize_ticket(registration),
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
