from __future__ import annotations

import datetime as dt
from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_authorized_event, get_authorized_organization, require_csrf, require_roles
from app.infrastructure.storage.factory import get_storage_service
from app.schemas.events import OrganizerEventCreateV1, OrganizerEventUpdateV1, PaymentSettingsIn, RegistrationStatusIn, rupees_to_paise
from app.services.audit_service import record_audit
from app.services.auth_service import utc_now
from app.services.event_archive_service import restore_event_record
from app.services.image_validation import ImageValidationError
from app.services.media_service import MEDIA_REFERENCE_PREFIX, record_media_failure, resolve_media_url, upload_media
from app.services.organization_qr_service import (
    OrganizationQrNotConfiguredError,
    qr_image_response,
    remove_organization_qr,
    upload_organization_qr,
)
from app.services.organizer_dashboard_service import build_organizer_event_dashboard
from app.services.organizer_visibility_service import get_event_visibility, get_visibility_for_events, serialize_visibility
from app.services.registration_config_service import normalize_event_configs
from app.services.storage_service import StorageError, StorageService
from app.config import get_settings
from db import get_db
from models import Event, EventCategory, EventCheckpoint, EventPaymentSettings, Organization, OrganizationMember, Registration, Ticket, User

router = APIRouter()


def _normalize_whatsapp_group_url(value: str | None) -> str | None:
    normalized = value.strip() if value else None
    if not normalized:
        return None
    parsed = urlparse(normalized)
    if parsed.scheme != "https" or parsed.hostname != "chat.whatsapp.com" or not parsed.path.strip("/"):
        raise HTTPException(status_code=422, detail="Enter a valid HTTPS WhatsApp group invite link")
    return normalized


def _event_response(event: Event, storage: StorageService | None = None, signed_url_ttl_seconds: int = 900, visibility: dict | None = None) -> dict:
    image_response = (
        qr_image_response(event.payment_settings, storage, signed_url_ttl_seconds)
        if storage
        else {"qrImageUrl": None, "qrImageExpiresAt": None}
    )
    payment_settings = None
    if event.payment_settings:
        # Only expose payment settings if Direct UPI is enabled for this organizer.
        # This prevents showing UPI QR codes for published events when admin has
        # disabled Direct UPI for the organizer (preventing further registrations).
        organization = db.scalar(select(Organization).where(Organization.id == event.organization_id))
        if organization and organization.allow_direct_upi:
            payment_settings = {
                "method": event.payment_settings.method,
                "upiId": event.payment_settings.upi_id,
                "payeeName": event.payment_settings.payee_name,
                "instructions": event.payment_settings.instructions,
                **image_response,
            }
    field_config, addon_config = normalize_event_configs(
        event.field_config,
        event.addon_config,
        category_options=sorted({category.distance for category in event.categories if category.distance}),
    )
    return {
        "id": str(event.id),
        "organizationId": str(event.organization_id),
        "name": event.name,
        "sport": event.category,
        "description": event.description,
        "eventDate": event.date,
        "location": {
            "name": event.location_name,
            "address": event.address,
            "city": event.city,
            "state": event.state,
            "country": event.country,
            "latitude": float(event.latitude) if event.latitude is not None else None,
            "longitude": float(event.longitude) if event.longitude is not None else None,
        },
        "bannerUrl": resolve_media_url(event.banner_url, storage, signed_url_ttl_seconds),
        "whatsappGroupUrl": event.whatsapp_group_url,
        "registrationOpen": event.registration_open.isoformat() if event.registration_open else None,
        "registrationClose": event.registration_close.isoformat() if event.registration_close else None,
        "registrationStatus": event.registration_status,
        "status": event.status,
        "archivedAt": event.archived_at.isoformat() if event.archived_at else None,
        "isArchived": event.archived_at is not None,
        "participants": visibility["visibleConfirmedQuantity"] if visibility is not None else event.participants,
        "totalParticipants": visibility["totalConfirmedQuantity"] if visibility is not None else event.participants,
        "lockedParticipants": visibility["lockedConfirmedQuantity"] if visibility is not None else 0,
        "visibility": serialize_visibility(visibility) if visibility is not None else None,
        "maxParticipants": event.max_participants,
        "rules": event.rules,
        "schedule": event.schedule or [],
        "fieldConfig": field_config,
        "addonConfig": addon_config,
        "categories": [
            {
                "id": str(category.id),
                "name": category.name,
                "distance": category.distance,
                "description": category.description,
                "ageMin": category.age_min,
                "ageMax": category.age_max,
                "gender": category.gender,
                "entryType": category.entry_type,
                "participantsPerEntry": category.participants_per_entry,
                "teamSizeMin": category.team_size_min,
                "teamSizeMax": category.team_size_max,
                "tickets": [
                    {
                        "id": str(ticket.id),
                        "name": ticket.name,
                        "description": ticket.description,
                        "pricePaise": ticket.price,
                        "currency": ticket.currency,
                        "quantityTotal": ticket.quantity_total,
                        "quantitySold": visibility["visibleConfirmedByTicket"].get(ticket.id, 0) if visibility is not None else ticket.quantity_sold,
                        "quantityReserved": ticket.quantity_reserved,
                        "available": ticket.available,
                        "saleStart": ticket.sale_start.isoformat() if ticket.sale_start else None,
                        "saleEnd": ticket.sale_end.isoformat() if ticket.sale_end else None,
                        "maxPerUser": ticket.max_per_user,
                    }
                    for ticket in category.tickets
                ],
            }
            for category in event.categories
        ],
        "paymentSettings": payment_settings,
        "paymentCollectionMethod": event.payment_collection_method,
        "platformFeeBearer": event.platform_fee_bearer,
        # The fee bearer is locked once a priced ticket has sold, matching the
        # backend guard that blocks changes after paid registrations start.
        "platformFeeBearerLocked": any(
            (ticket.price or 0) > 0 and (ticket.quantity_sold or 0) > 0
            for category in event.categories
            for ticket in category.tickets
        ),
        "adminFeatureOverride": event.features_unlocked,
    }


def _validate_registration_window(payload: OrganizerEventCreateV1 | OrganizerEventUpdateV1) -> None:
    if payload.registration_open and payload.registration_close and payload.registration_close <= payload.registration_open:
        raise HTTPException(status_code=422, detail="Registration close must be after registration open")
    for category in payload.categories:
        if category.age_min is not None and category.age_max is not None and category.age_max < category.age_min:
            raise HTTPException(status_code=422, detail="Category age_max must be greater than or equal to age_min")
        for ticket in category.tickets:
            if ticket.sale_start and ticket.sale_end and ticket.sale_end <= ticket.sale_start:
                raise HTTPException(status_code=422, detail="Ticket sale_end must be after sale_start")


def _category_distance(value: str | None) -> str | None:
    normalized = value.strip() if value else ""
    return normalized or None


def _category_distances(payload: OrganizerEventCreateV1 | OrganizerEventUpdateV1) -> list[str]:
    return [distance for category in payload.categories if (distance := _category_distance(category.distance))]


def _legacy_event_distance(payload: OrganizerEventCreateV1 | OrganizerEventUpdateV1) -> str:
    distances = _category_distances(payload)
    return distances[0] if distances else "badminton"


@router.get("/events")
def list_my_events(
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
    storage: StorageService = Depends(get_storage_service),
) -> list[dict]:
    query = select(Event).options(
        selectinload(Event.categories).selectinload(EventCategory.tickets),
        selectinload(Event.payment_settings),
    )
    if user.role != "admin":
        organization_ids = select(OrganizationMember.organization_id).where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.member_role == "organizer",
        )
        query = query.where(Event.organization_id.in_(organization_ids))
    events = db.scalars(query.order_by(Event.created_at.desc())).unique().all()
    visibility_by_event = get_visibility_for_events(db, user, [event.id for event in events])
    return [_event_response(event, storage, get_settings().storage_signed_url_ttl_seconds, visibility_by_event.get(event.id)) for event in events]


@router.get("/event-options")
def list_my_event_options(
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
) -> list[dict]:
    query = select(Event.id, Event.name, Event.archived_at)
    if user.role != "admin":
        organization_ids = select(OrganizationMember.organization_id).where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.member_role == "organizer",
        )
        query = query.where(Event.organization_id.in_(organization_ids))
    return [
        {"id": str(event_id), "name": name, "isArchived": archived_at is not None}
        for event_id, name, archived_at in db.execute(query.order_by(Event.created_at.desc())).all()
    ]


@router.post("/events", status_code=status.HTTP_201_CREATED)
def create_event(
    payload: OrganizerEventCreateV1,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    storage: StorageService = Depends(get_storage_service),
) -> dict:
    _validate_registration_window(payload)
    organization = get_authorized_organization(db, user, payload.organization_id)

    # Block Direct UPI if the organizer has not been granted access by admin.
    if payload.payment_collection_method == "DIRECT_UPI" and not organization.allow_direct_upi:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Direct UPI payments are not enabled for this organizer. Contact SportPass to request access.",
        )

    field_config, addon_config = normalize_event_configs(
        payload.field_config,
        payload.addon_config,
        category_options=_category_distances(payload),
    )
    event = Event(
        organization_id=organization.id,
        name=payload.name.strip(),
        description=payload.description.strip(),
        category=payload.sport.strip().lower(),
        location_name=payload.location_name.strip(),
        address=payload.address.strip() if payload.address else None,
        city=payload.city.strip() if payload.city else None,
        state=payload.state.strip() if payload.state else None,
        country=payload.country.strip(),
        banner_url=payload.banner_url,
        whatsapp_group_url=_normalize_whatsapp_group_url(payload.whatsapp_group_url),
        start_date=dt.datetime.combine(payload.event_date, dt.time.min),
        end_date=None,
        registration_open=payload.registration_open,
        registration_close=payload.registration_close,
        max_participants=payload.max_participants,
        latitude=payload.latitude,
        longitude=payload.longitude,
        status="draft",
        distance=_legacy_event_distance(payload),
        participants=0,
        rules=payload.rules,
        schedule=[item.model_dump() for item in payload.schedule],
        field_config=field_config,
        addon_config=addon_config,
        payment_collection_method=payload.payment_collection_method,
        platform_fee_bearer=payload.platform_fee_bearer,
    )
    db.add(event)
    db.flush()
    db.add(EventCheckpoint(event_id=event.id, name="Check-In", position=1))

    for category_payload in payload.categories:
        category = EventCategory(
            event_id=event.id,
            name=category_payload.name.strip(),
            distance=_category_distance(category_payload.distance),
            description=category_payload.description.strip(),
            age_min=category_payload.age_min,
            age_max=category_payload.age_max,
            gender=category_payload.gender,
            entry_type=category_payload.entry_type,
            participants_per_entry=category_payload.participants_per_entry,
            team_size_min=category_payload.team_size_min,
            team_size_max=category_payload.team_size_max,
        )
        db.add(category)
        db.flush()
        for ticket_payload in category_payload.tickets:
            db.add(
                Ticket(
                    event_id=event.id,
                    category_id=category.id,
                    name=ticket_payload.name.strip(),
                    description=ticket_payload.description.strip(),
                    price=rupees_to_paise(ticket_payload.price_rupees),
                    currency="INR",
                    quantity_total=ticket_payload.quantity,
                    quantity_sold=0,
                    quantity_reserved=0,
                    sale_start=ticket_payload.sale_start,
                    sale_end=ticket_payload.sale_end,
                    max_per_user=ticket_payload.max_per_user,
                    is_active=True,
                )
            )

    record_audit(
        db,
        actor_user_id=user.id,
        action="event_created",
        resource_type="event",
        resource_id=event.id,
        metadata={"organization_id": str(organization.id)},
    )
    db.commit()
    db.refresh(event)
    return _event_response(event, storage, get_settings().storage_signed_url_ttl_seconds, get_event_visibility(db, user, event.id))


@router.get("/events/{event_id}")
def get_my_event(
    event_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
    storage: StorageService = Depends(get_storage_service),
) -> dict:
    event = get_authorized_event(db, user, event_id)
    event = db.scalar(
        select(Event)
        .options(selectinload(Event.categories).selectinload(EventCategory.tickets), selectinload(Event.payment_settings))
        .where(Event.id == event.id)
    )
    return _event_response(event, storage, get_settings().storage_signed_url_ttl_seconds, get_event_visibility(db, user, event.id))


@router.get("/events/{event_id}/dashboard")
def get_event_dashboard(
    event_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
    storage: StorageService = Depends(get_storage_service),
) -> dict:
    event = get_authorized_event(db, user, event_id)
    event = db.scalar(
        select(Event)
        .options(selectinload(Event.categories).selectinload(EventCategory.tickets), selectinload(Event.payment_settings))
        .where(Event.id == event.id)
    )
    visibility = get_event_visibility(db, user, event.id)
    return {
        "event": _event_response(event, storage, get_settings().storage_signed_url_ttl_seconds, visibility),
        **build_organizer_event_dashboard(db, user, event, visibility=visibility),
    }


def _ticket_has_registrations(db: Session, ticket_id: UUID) -> bool:
    return db.scalar(select(Registration.id).where(Registration.ticket_id == ticket_id).limit(1)) is not None


def _category_has_registrations(db: Session, category: EventCategory) -> bool:
    return any(_ticket_has_registrations(db, ticket.id) for ticket in category.tickets)


def _event_has_paid_registration(db: Session, event_id: UUID) -> bool:
    """True once the event has at least one paid (base amount > 0) registration.

    Used to lock the platform-fee bearer, since changing who pays after money has
    started moving would be inconsistent with the snapshots on existing rows.
    """
    return db.scalar(
        select(Registration.id)
        .where(Registration.event_id == event_id, Registration.total_amount_paise > 0)
        .limit(1)
    ) is not None


@router.post("/events/{event_id}/registration-status")
def update_registration_status(
    event_id: UUID,
    payload: RegistrationStatusIn,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    event = get_authorized_event(db, user, event_id)
    if payload.status == "open" and event.archived_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Restore the event before opening registration")

    previous_status = event.registration_status
    if previous_status != payload.status:
        event.registration_status = payload.status
        record_audit(
            db,
            actor_user_id=user.id,
            action="registration_opened" if payload.status == "open" else "registration_closed",
            resource_type="event",
            resource_id=event.id,
            metadata={"previousStatus": previous_status, "newStatus": payload.status},
        )
        db.commit()

    return {
        "id": str(event.id),
        "registrationStatus": event.registration_status,
        "isAcceptingRegistrations": event.registration_status == "open" and event.archived_at is None,
    }


@router.post("/events/{event_id}/archive")
def archive_event(
    event_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    event = get_authorized_event(db, user, event_id)
    if event.archived_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Event is already archived")

    event.archived_at = utc_now()
    record_audit(
        db,
        actor_user_id=user.id,
        action="event_archived",
        resource_type="event",
        resource_id=event.id,
        metadata={"previousStatus": event.status},
    )
    db.commit()
    return {
        "id": str(event.id),
        "status": event.status,
        "archivedAt": event.archived_at.isoformat(),
        "isArchived": True,
    }


@router.post("/events/{event_id}/restore")
def restore_event(
    event_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    event = get_authorized_event(db, user, event_id)
    if event.archived_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Event is not archived")

    restore_event_record(db, event, user.id)
    db.commit()
    return {
        "id": str(event.id),
        "status": event.status,
        "archivedAt": None,
        "isArchived": False,
    }


@router.put("/events/{event_id}")
def update_event(
    event_id: UUID,
    payload: OrganizerEventUpdateV1,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    storage: StorageService = Depends(get_storage_service),
) -> dict:
    event = get_authorized_event(db, user, event_id)
    event = db.scalar(
        select(Event)
        .options(selectinload(Event.categories).selectinload(EventCategory.tickets), selectinload(Event.payment_settings))
        .where(Event.id == event.id)
    )
    _validate_registration_window(payload)
    field_config, addon_config = normalize_event_configs(
        payload.field_config,
        payload.addon_config,
        category_options=_category_distances(payload),
    )
    
    # Check if event is transitioning from free to paid
    current_has_paid_tickets = any(ticket.price > 0 for category in event.categories for ticket in category.tickets)
    new_has_paid_tickets = any(
        any(rupees_to_paise(ticket_payload.price_rupees) > 0 for ticket_payload in category_payload.tickets)
        for category_payload in payload.categories
    )
    
    # If transitioning from free to paid and event is published, check paid verification
    if event.status == "published" and not current_has_paid_tickets and new_has_paid_tickets:
        organization = db.scalar(select(Organization).where(Organization.id == event.organization_id))
        if organization and organization.paid_verification_status != "VERIFIED":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Complete Paid Organizer Verification to change this event from free to paid."
            )

    existing_categories = {category.id: category for category in event.categories}
    submitted_category_ids: set[UUID] = set()

    event.name = payload.name.strip()
    event.description = payload.description.strip()
    event.category = payload.sport.strip().lower()
    event.start_date = dt.datetime.combine(payload.event_date, dt.time.min)
    event.location_name = payload.location_name.strip()
    event.address = payload.address.strip() if payload.address else None
    event.city = payload.city.strip() if payload.city else None
    event.state = payload.state.strip() if payload.state else None
    event.country = payload.country.strip()
    event.whatsapp_group_url = _normalize_whatsapp_group_url(payload.whatsapp_group_url)
    if payload.banner_url and payload.banner_url.startswith(MEDIA_REFERENCE_PREFIX):
        event.banner_url = payload.banner_url
    event.max_participants = payload.max_participants
    event.latitude = payload.latitude
    event.longitude = payload.longitude
    event.rules = payload.rules
    event.schedule = [item.model_dump() for item in payload.schedule]
    event.field_config = field_config
    event.addon_config = addon_config
    event.registration_open = payload.registration_open
    event.registration_close = payload.registration_close
    event.distance = _legacy_event_distance(payload)
    if payload.payment_collection_method is not None:
        if payload.payment_collection_method == "DIRECT_UPI":
            org = db.scalar(select(Organization).where(Organization.id == event.organization_id))
            if org and not org.allow_direct_upi:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Direct UPI payments are not enabled for this organizer. Contact SportPass to request access.",
                )
        event.payment_collection_method = payload.payment_collection_method

    if payload.platform_fee_bearer is not None and payload.platform_fee_bearer != event.platform_fee_bearer:
        if _event_has_paid_registration(db, event.id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="SportPass fee responsibility cannot be changed after paid registrations have started.",
            )
        event.platform_fee_bearer = payload.platform_fee_bearer

    for category_payload in payload.categories:
        category = existing_categories.get(category_payload.id) if category_payload.id else None
        if category_payload.id and category is None:
            raise HTTPException(status_code=422, detail="Category does not belong to this event")
        if category is None:
            category = EventCategory(
                event_id=event.id,
                name=category_payload.name.strip(),
                distance=_category_distance(category_payload.distance),
                description=category_payload.description.strip(),
                age_min=category_payload.age_min,
                age_max=category_payload.age_max,
                gender=category_payload.gender,
                entry_type=category_payload.entry_type,
                participants_per_entry=category_payload.participants_per_entry,
                team_size_min=category_payload.team_size_min,
                team_size_max=category_payload.team_size_max,
            )
            db.add(category)
            db.flush()
        submitted_category_ids.add(category.id)
        if (
            category.entry_type != category_payload.entry_type
            or category.participants_per_entry != category_payload.participants_per_entry
        ) and _category_has_registrations(db, category):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Category '{category.name}' entry format cannot change after registrations exist",
            )
        category.name = category_payload.name.strip()
        category.distance = _category_distance(category_payload.distance)
        category.description = category_payload.description.strip()
        category.age_min = category_payload.age_min
        category.age_max = category_payload.age_max
        category.gender = category_payload.gender
        category.entry_type = category_payload.entry_type
        category.participants_per_entry = category_payload.participants_per_entry
        category.team_size_min = category_payload.team_size_min
        category.team_size_max = category_payload.team_size_max

        existing_tickets = {ticket.id: ticket for ticket in category.tickets}
        submitted_ticket_ids: set[UUID] = set()
        for ticket_payload in category_payload.tickets:
            ticket = existing_tickets.get(ticket_payload.id) if ticket_payload.id else None
            if ticket_payload.id and ticket is None:
                raise HTTPException(status_code=422, detail="Ticket does not belong to this category")
            ticket_name = ticket_payload.name.strip()
            ticket_description = ticket_payload.description.strip()
            ticket_price = rupees_to_paise(ticket_payload.price_rupees)
            if ticket is None:
                ticket = Ticket(
                    event_id=event.id,
                    category_id=category.id,
                    name=ticket_name,
                    description=ticket_description,
                    price=ticket_price,
                    currency="INR",
                    quantity_total=ticket_payload.quantity,
                    quantity_sold=0,
                    quantity_reserved=0,
                    sale_start=ticket_payload.sale_start,
                    sale_end=ticket_payload.sale_end,
                    max_per_user=ticket_payload.max_per_user,
                    is_active=True,
                )
                db.add(ticket)
                db.flush()
            submitted_ticket_ids.add(ticket.id)
            minimum_quantity = ticket.quantity_sold + ticket.quantity_reserved
            if ticket_payload.quantity < minimum_quantity:
                raise HTTPException(
                    status_code=422,
                    detail=f"Ticket quantity cannot be below committed inventory ({minimum_quantity})",
                )
            ticket.name = ticket_name
            ticket.description = ticket_description
            ticket.price = ticket_price
            ticket.quantity_total = ticket_payload.quantity
            ticket.sale_start = ticket_payload.sale_start
            ticket.sale_end = ticket_payload.sale_end
            ticket.max_per_user = ticket_payload.max_per_user
            ticket.is_active = True

        for ticket in list(category.tickets):
            if ticket.id not in submitted_ticket_ids:
                if _ticket_has_registrations(db, ticket.id):
                    raise HTTPException(status_code=422, detail=f"Ticket '{ticket.name}' cannot be removed after registrations exist")
                db.delete(ticket)

    for category in list(event.categories):
        if category.id not in submitted_category_ids:
            if any(_ticket_has_registrations(db, ticket.id) for ticket in category.tickets):
                raise HTTPException(status_code=422, detail=f"Category '{category.name}' cannot be removed after registrations exist")
            for ticket in list(category.tickets):
                db.delete(ticket)
            db.delete(category)

    record_audit(
        db,
        actor_user_id=user.id,
        action="event_updated",
        resource_type="event",
        resource_id=event.id,
        metadata={"status": event.status},
    )
    db.commit()
    updated = db.scalar(
        select(Event)
        .options(selectinload(Event.categories).selectinload(EventCategory.tickets), selectinload(Event.payment_settings))
        .where(Event.id == event.id)
    )
    return _event_response(updated, storage, get_settings().storage_signed_url_ttl_seconds, get_event_visibility(db, user, updated.id))


@router.put("/events/{event_id}/payment-settings")
def update_payment_settings(
    event_id: UUID,
    payload: PaymentSettingsIn,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    storage: StorageService = Depends(get_storage_service),
) -> dict:
    event = get_authorized_event(db, user, event_id)
    settings = event.payment_settings
    if settings is None:
        settings = EventPaymentSettings(event_id=event.id)
        db.add(settings)
    settings.method = "manual_upi"
    settings.upi_id = payload.upi_id.strip()
    settings.payee_name = payload.payee_name.strip()
    settings.instructions = payload.instructions.strip()
    settings.qr_image_url = None
    settings.is_active = True
    record_audit(db, actor_user_id=user.id, action="payment_settings_updated", resource_type="event", resource_id=event.id)
    db.commit()
    return {
        "eventId": str(event.id),
        "method": settings.method,
        "upiId": settings.upi_id,
        "payeeName": settings.payee_name,
        **qr_image_response(settings, storage, get_settings().storage_signed_url_ttl_seconds),
    }


@router.post("/events/{event_id}/payment-settings/qr")
def upload_qr_image(
    event_id: UUID,
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    storage: StorageService = Depends(get_storage_service),
) -> dict:
    event = get_authorized_event(db, user, event_id)
    settings = get_settings()
    payload = file.file.read(settings.storage_max_upload_bytes + 1)
    try:
        return upload_organization_qr(
            db,
            event=event,
            actor_user_id=user.id,
            payload=payload,
            filename=file.filename,
            content_type=file.content_type,
            storage=storage,
            max_upload_bytes=settings.storage_max_upload_bytes,
            max_dimension=settings.storage_max_dimension,
            signed_url_ttl_seconds=settings.storage_signed_url_ttl_seconds,
        )
    except (ImageValidationError, OrganizationQrNotConfiguredError) as exc:
        record_media_failure(
            db,
            actor_user_id=user.id,
            owner_type="event",
            owner_id=event.id,
            purpose="payment-qr",
            stage="validation",
            error=exc,
            request_id=getattr(request.state, "request_id", None),
            size_bytes=len(payload),
        )
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except StorageError as exc:
        record_media_failure(
            db,
            actor_user_id=user.id,
            owner_type="event",
            owner_id=event.id,
            purpose="payment-qr",
            stage="storage_write",
            error=exc,
            request_id=getattr(request.state, "request_id", None),
            size_bytes=len(payload),
        )
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="QR image storage is unavailable") from exc


@router.delete("/events/{event_id}/payment-settings/qr")
def delete_qr_image(
    event_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    storage: StorageService = Depends(get_storage_service),
) -> dict:
    event = get_authorized_event(db, user, event_id)
    return remove_organization_qr(
        db,
        event=event,
        actor_user_id=user.id,
        storage=storage,
        signed_url_ttl_seconds=get_settings().storage_signed_url_ttl_seconds,
    )


@router.post("/events/{event_id}/publish")
def publish_event(
    event_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    event = get_authorized_event(db, user, event_id)
    event = db.scalar(
        select(Event)
        .options(selectinload(Event.categories).selectinload(EventCategory.tickets), selectinload(Event.payment_settings))
        .where(Event.id == event.id)
    )
    if event.archived_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Restore the event before publishing it")
    if not event.categories or not any(category.tickets for category in event.categories):
        raise HTTPException(status_code=422, detail="Event needs at least one category and ticket")
    
    has_paid_tickets = any(ticket.price > 0 for category in event.categories for ticket in category.tickets)
    
    # Check paid organizer verification for paid events
    if has_paid_tickets:
        # Get the organization to check verification status
        organization = db.scalar(select(Organization).where(Organization.id == event.organization_id))
        if organization and organization.paid_verification_status != "VERIFIED":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Complete Paid Organizer Verification to publish this paid event."
            )
        
        if event.payment_collection_method == "DIRECT_UPI" and (event.payment_settings is None or not event.payment_settings.is_active or not event.payment_settings.upi_id):
            raise HTTPException(status_code=422, detail="Active manual UPI payment settings are required before publishing paid tickets with Direct UPI method")

        if event.payment_collection_method == "DIRECT_UPI" and organization and not organization.allow_direct_upi:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Direct UPI payments are not enabled for this organizer. Contact SportPass to request access.",
            )
    
    event.status = "published"
    record_audit(db, actor_user_id=user.id, action="event_published", resource_type="event", resource_id=event.id)
    db.commit()
    return {"id": str(event.id), "status": event.status}


@router.post("/events/{event_id}/banner")
def upload_event_banner(
    event_id: UUID,
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    storage: StorageService = Depends(get_storage_service),
) -> dict:
    event = get_authorized_event(db, user, event_id)
    settings = get_settings()
    payload = file.file.read(settings.storage_max_upload_bytes + 1)
    try:
        uploaded = upload_media(
            db,
            owner=event,
            owner_type="event",
            owner_id=event.id,
            reference_field="banner_url",
            actor_user_id=user.id,
            payload=payload,
            filename=file.filename,
            content_type=file.content_type,
            purpose="event-banner",
            storage=storage,
            max_upload_bytes=settings.storage_max_upload_bytes,
            max_dimension=settings.storage_max_dimension,
            signed_url_ttl_seconds=settings.storage_signed_url_ttl_seconds,
            request_id=getattr(request.state, "request_id", None),
        )
    except ImageValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except StorageError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return {
        "eventId": str(event.id),
        "bannerUrl": uploaded.url,
        "contentType": uploaded.content_type,
        "sizeBytes": uploaded.size_bytes,
        "width": uploaded.width,
        "height": uploaded.height,
    }
