from __future__ import annotations

import datetime as dt
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_authorized_event, get_authorized_organization, require_csrf, require_roles
from app.infrastructure.storage.factory import get_storage_service
from app.schemas.events import OrganizerEventCreateV1, PaymentSettingsIn, rupees_to_paise
from app.services.audit_service import record_audit
from app.services.image_validation import ImageValidationError
from app.services.organization_qr_service import (
    OrganizationQrNotConfiguredError,
    qr_image_response,
    remove_organization_qr,
    upload_organization_qr,
)
from app.services.storage_service import StorageError, StorageService
from app.config import get_settings
from db import get_db
from models import Event, EventCategory, EventPaymentSettings, OrganizationMember, Ticket, User

router = APIRouter()


def _event_response(event: Event, storage: StorageService | None = None, signed_url_ttl_seconds: int = 900) -> dict:
    image_response = (
        qr_image_response(event.payment_settings, storage, signed_url_ttl_seconds)
        if storage
        else {"qrImageUrl": None, "qrImageExpiresAt": None}
    )
    payment_settings = None
    if event.payment_settings:
        payment_settings = {
            "method": event.payment_settings.method,
            "upiId": event.payment_settings.upi_id,
            "payeeName": event.payment_settings.payee_name,
            "instructions": event.payment_settings.instructions,
            **image_response,
        }
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
        },
        "bannerUrl": event.banner_url,
        "status": event.status,
        "maxParticipants": event.max_participants,
        "rules": event.rules,
        "categories": [
            {
                "id": str(category.id),
                "name": category.name,
                "distance": category.distance,
                "description": category.description,
                "tickets": [
                    {
                        "id": str(ticket.id),
                        "name": ticket.name,
                        "description": ticket.description,
                        "pricePaise": ticket.price,
                        "currency": ticket.currency,
                        "quantityTotal": ticket.quantity_total,
                        "quantitySold": ticket.quantity_sold,
                        "quantityReserved": ticket.quantity_reserved,
                        "available": ticket.available,
                    }
                    for ticket in category.tickets
                ],
            }
            for category in event.categories
        ],
        "paymentSettings": payment_settings,
    }


def _validate_registration_window(payload: OrganizerEventCreateV1) -> None:
    if payload.registration_open and payload.registration_close and payload.registration_close <= payload.registration_open:
        raise HTTPException(status_code=422, detail="Registration close must be after registration open")
    for category in payload.categories:
        if category.age_min is not None and category.age_max is not None and category.age_max < category.age_min:
            raise HTTPException(status_code=422, detail="Category age_max must be greater than or equal to age_min")
        for ticket in category.tickets:
            if ticket.sale_start and ticket.sale_end and ticket.sale_end <= ticket.sale_start:
                raise HTTPException(status_code=422, detail="Ticket sale_end must be after sale_start")


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
    return [_event_response(event, storage, get_settings().storage_signed_url_ttl_seconds) for event in events]


@router.post("/events", status_code=status.HTTP_201_CREATED)
def create_event(
    payload: OrganizerEventCreateV1,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    _validate_registration_window(payload)
    organization = get_authorized_organization(db, user, payload.organization_id)
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
        start_date=dt.datetime.combine(payload.event_date, dt.time.min),
        end_date=None,
        registration_open=payload.registration_open,
        registration_close=payload.registration_close,
        max_participants=payload.max_participants,
        status="draft",
        distance=payload.categories[0].distance,
        participants=0,
        rules=payload.rules,
    )
    db.add(event)
    db.flush()

    for category_payload in payload.categories:
        category = EventCategory(
            event_id=event.id,
            name=category_payload.name.strip(),
            distance=category_payload.distance.strip(),
            description=category_payload.description.strip(),
            age_min=category_payload.age_min,
            age_max=category_payload.age_max,
            gender=category_payload.gender,
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
    return _event_response(event)


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
    return _event_response(event, storage, get_settings().storage_signed_url_ttl_seconds)


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
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except StorageError as exc:
        db.rollback()
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
    if not event.categories or not any(category.tickets for category in event.categories):
        raise HTTPException(status_code=422, detail="Event needs at least one category and ticket")
    if event.payment_settings is None or not event.payment_settings.is_active or not event.payment_settings.upi_id:
        raise HTTPException(status_code=422, detail="Active manual UPI payment settings are required before publishing")
    event.status = "published"
    record_audit(db, actor_user_id=user.id, action="event_published", resource_type="event", resource_id=event.id)
    db.commit()
    return {"id": str(event.id), "status": event.status}
