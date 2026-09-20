from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from db import get_db
from models import Event, EventCategory, FoundingProgram, PricingPlan, Ticket
from schemas import EventOut
from app.config import get_settings
from app.infrastructure.storage.factory import get_storage_service
from app.services.registration_config_service import normalize_event_configs
from app.services.media_service import resolve_media_url
from app.services.match_service import list_public_match_results
from app.services.platform_fee_service import get_or_create_config

router = APIRouter()


def _fee_config_values(db: Session) -> tuple[int, int]:
    """Return (percentage_basis_points, per_registration_paise) for fee previews."""
    config = get_or_create_config(db)
    return config.percentage_basis_points, config.per_registration_paise


def _public_event(event: Event, storage=None, *, fee_percentage_basis_points: int = 500, fee_per_registration_paise: int = 1000) -> dict:
    tickets = list(event.tickets)
    if event.categories:
        ordered_tickets = []
        for category in event.categories:
            for ticket in category.tickets:
                ordered_tickets.append((category.name, category, ticket))
    else:
        ordered_tickets = [(event.distance, None, ticket) for ticket in tickets]

    tiers = [
        {
            "id": ticket.id,
            "name": f"{category_name} · {ticket.name}" if category_name else ticket.name,
            "price": ticket.price // 100 if ticket.currency == "INR" else ticket.price,
            "description": ticket.description,
            "available": ticket.available,
            "entryType": category.entry_type if category is not None else "singles",
            "participantsPerEntry": category.participants_per_entry if category is not None else 1,
            "teamSizeMin": category.team_size_min if category is not None else None,
            "teamSizeMax": category.team_size_max if category is not None else None,
        }
        for category_name, category, ticket in ordered_tickets
    ]
    field_config, addon_config = normalize_event_configs(
        event.field_config,
        event.addon_config,
        category_options=sorted({category.distance for category in event.categories if category.distance}),
    )
    return {
        "id": event.id,
        "title": event.title,
        "date": event.date,
        "location": event.location,
        "locationDetails": event.locationDetails,
        "category": event.category,
        "image": resolve_media_url(event.banner_url, storage, get_settings().storage_signed_url_ttl_seconds) or "/placeholder.svg",
        "description": event.description,
        "distance": event.distance,
        "participants": sum(ticket.quantity_sold for ticket in event.tickets),
        "maxParticipants": event.maxParticipants,
        "organizer": event.organizer,
        "registrationOpen": event.registration_open.isoformat() if event.registration_open else None,
        "registrationClose": event.registration_close.isoformat() if event.registration_close else None,
        "registrationStatus": event.registration_status,
        "status": event.status,
        "rules": event.rules,
        "schedule": event.schedule or [],
        "fieldConfig": field_config,
        "addonConfig": addon_config,
        "tiers": tiers,
        "platformFeeBearer": event.platform_fee_bearer,
        "sportPassFeePercentageBasisPoints": fee_percentage_basis_points,
        "sportPassFeePerRegistrationPaise": fee_per_registration_paise,
    }


def _event_query():
    return select(Event).options(
        selectinload(Event.organization),
        selectinload(Event.tickets),
        selectinload(Event.categories).selectinload(EventCategory.tickets),
    )


@router.get("/events", response_model=list[EventOut])
def list_public_events(
    q: str | None = Query(default=None, max_length=120),
    sport: str | None = Query(default=None, max_length=40),
    city: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    storage=Depends(get_storage_service),
) -> list[dict]:
    query = _event_query().where(Event.status == "published", Event.archived_at.is_(None))
    if sport:
        query = query.where(Event.category == sport.strip().lower())
    if city:
        query = query.where(Event.city.ilike(f"%{city.strip()}%"))
    if q:
        term = f"%{q.strip()}%"
        query = query.where(or_(Event.name.ilike(term), Event.location_name.ilike(term), Event.description.ilike(term)))
    events = db.scalars(query.order_by(Event.start_date).offset(offset).limit(limit)).unique().all()
    fee_bps, fee_flat = _fee_config_values(db)
    return [_public_event(event, storage, fee_percentage_basis_points=fee_bps, fee_per_registration_paise=fee_flat) for event in events]


@router.get("/events/{event_id}/results")
def get_public_results(
    event_id: UUID,
    category_id: UUID | None = None,
    match_status: str | None = Query(default=None, alias="status", max_length=30),
    db: Session = Depends(get_db),
) -> dict:
    event = db.scalar(
        select(Event)
        .options(selectinload(Event.categories))
        .where(Event.id == event_id, Event.status == "published", Event.archived_at.is_(None))
    )
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if category_id is not None and not any(category.id == category_id for category in event.categories):
        raise HTTPException(status_code=404, detail="Category not found")
    if match_status is not None and match_status not in {"scheduled", "in_progress", "completed"}:
        raise HTTPException(status_code=422, detail="Unsupported match status")
    return {
        "event": {"id": str(event.id), "title": event.title, "date": event.date, "category": event.category},
        "categories": [
            {"id": str(category.id), "name": category.name, "distance": category.distance, "entryType": category.entry_type}
            for category in event.categories
        ],
        "matches": list_public_match_results(db, event.id, category_id=category_id, status=match_status),
    }


def _public_display_name(full_name: str | None) -> str:
    """First name + last initial for privacy on the public number list."""
    if not full_name:
        return "Participant"
    parts = full_name.strip().split()
    if len(parts) == 1:
        return parts[0]
    return f"{parts[0]} {parts[-1][0]}."


def _sport_number_label(sport: str | None) -> str:
    """Return the number label shown publicly for a sport."""
    normalized = (sport or "").strip().lower()
    labels = {
        "running": "Bib Number",
        "cycling": "Bib Number",
        "badminton": "Jersey Number",
        "tennis": "Player ID",
        "squash": "Jersey Number",
    }
    if normalized in labels:
        return labels[normalized]
    if "badminton" in normalized or "squash" in normalized:
        return "Jersey Number"
    return "Bib Number"


@router.get("/events/{event_id}/number-list")
def get_public_number_list(
    event_id: UUID,
    db: Session = Depends(get_db),
) -> dict:
    """Public, read-only view of PUBLISHED number allocations for an event.

    Only published allocations are exposed. Draft/unassigned entries and
    private contact details are never returned here. Names are reduced to
    first name + last initial for privacy.
    """
    from models import Registration

    event = db.scalar(
        select(Event)
        .options(selectinload(Event.categories))
        .where(Event.id == event_id, Event.status == "published", Event.archived_at.is_(None))
    )
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")

    rows = db.scalars(
        select(Registration)
        .options(selectinload(Registration.participant), selectinload(Registration.category))
        .where(
            Registration.event_id == event_id,
            Registration.allocation_status == "published",
            Registration.allocation_number.isnot(None),
        )
        .order_by(Registration.allocation_number)
    ).all()

    entries = [
        {
            "allocationNumber": reg.allocation_number,
            "displayName": _public_display_name(reg.participant.name if reg.participant else None),
            "categoryName": reg.category.name if reg.category else None,
            "teamName": reg.participant.team_name if reg.participant else None,
        }
        for reg in rows
    ]

    return {
        "event": {
            "id": str(event.id),
            "title": event.title,
            "date": event.date,
            "sport": event.category,
            "location": event.location,
        },
        "numberLabel": _sport_number_label(event.category),
        "categories": [
            {"id": str(category.id), "name": category.name}
            for category in event.categories
        ],
        "entries": entries,
    }


@router.get("/events/{event_id}", response_model=EventOut)
def get_public_event(
    event_id: UUID,
    db: Session = Depends(get_db),
    storage=Depends(get_storage_service),
) -> dict:
    event = db.scalars(
        _event_query().where(Event.id == event_id, Event.status == "published", Event.archived_at.is_(None))
    ).unique().first()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    fee_bps, fee_flat = _fee_config_values(db)
    return _public_event(event, storage, fee_percentage_basis_points=fee_bps, fee_per_registration_paise=fee_flat)


@router.get("/organizer-plans")
def list_public_organizer_plans(db: Session = Depends(get_db)) -> dict:
    plans = db.scalars(
        select(PricingPlan)
        .where(PricingPlan.active.is_(True))
        .order_by(PricingPlan.sort_order.asc(), PricingPlan.min_confirmed_registrations.asc())
    ).all()
    program = db.get(FoundingProgram, 1)
    return {
        "currency": "INR",
        "plans": [
            {
                "id": str(plan.id),
                "code": plan.code,
                "name": plan.name,
                "minConfirmedRegistrations": plan.min_confirmed_registrations,
                "maxConfirmedRegistrations": plan.max_confirmed_registrations,
                "pricePaise": plan.price_paise,
                "billingUnit": plan.billing_unit,
                "currency": plan.currency,
            }
            for plan in plans
        ],
        "foundingProgram": {
            "enabled": bool(program and program.enabled),
            "freeRacesCount": program.free_races_count if program else 1,
            "defaultDiscountPercent": (program.default_discount_basis_points / 100) if program else 100,
        },
    }



@router.get("/events/{event_id}/categories/{category_id}/standings")
def get_public_standings(
    event_id: str,
    category_id: str,
    db: Session = Depends(get_db),
) -> list[dict]:
    """Public standings endpoint — no auth required, event must be published."""
    import uuid as _uuid
    from models import Event as _Event
    from app.services.match_service import compute_standings, MatchValidationError

    try:
        event_uuid = _uuid.UUID(event_id)
        category_uuid = _uuid.UUID(category_id)
    except ValueError:
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=400, detail="Invalid id")

    event = db.get(_Event, event_uuid)
    if event is None or event.status != "published" or event.archived_at is not None:
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=404, detail="Event not found")

    try:
        return compute_standings(db, event_uuid, category_uuid)
    except MatchValidationError as exc:
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=404, detail=str(exc))
