from __future__ import annotations

from app.sports import get_adapter

import datetime as dt
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from db import get_db
from models import Event, EventCategory, Ticket
from schemas import EventOut
from app.config import get_settings
from app.infrastructure.storage.factory import get_storage_service
from app.services.registration_config_service import normalize_event_configs
from app.services.media_service import resolve_media_url
from app.services.match_service import list_public_match_results
from app.services.platform_fee_service import get_effective_pricing, get_or_create_config

router = APIRouter()


def _fee_config_values(db: Session) -> tuple[int, int, int, int]:
    config = get_or_create_config(db)
    return config.percentage_basis_points, 2000, 6000, 0


def _public_event(event: Event, storage=None, *, fee_percentage_basis_points: int = 400, fee_minimum_paise: int = 2000, fee_maximum_paise: int = 6000, fee_fixed_paise: int = 0) -> dict:
    pricing = get_effective_pricing(event.organization)
    if pricing["mode"] != "DEFAULT":
        fee_percentage_basis_points = pricing["percentageBasisPoints"]
        fee_minimum_paise = pricing["minimumFeePaise"]
        fee_maximum_paise = pricing["maximumFeePaise"]
        fee_fixed_paise = pricing["fixedFeePaise"] or 0
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
        "endDate": event.end_date.date().isoformat() if event.end_date else None,
        "location": event.location,
        "locationDetails": event.locationDetails,
        "category": event.category,
        "image": resolve_media_url(event.banner_url, storage, get_settings().storage_signed_url_ttl_seconds) or "/placeholder.svg",
        "description": event.description,
        "distance": event.distance,
        "participants": sum(ticket.quantity_sold for ticket in event.tickets),
        "maxParticipants": event.maxParticipants,
        "organizer": event.organizer,
        "organizerInfo": {
            "name": event.organization.name if event.organization else event.organizer,
            "logoUrl": resolve_media_url(event.organization.logo_url, storage, get_settings().storage_signed_url_ttl_seconds) if event.organization else None,
        },
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
        "paymentCollectionMethod": event.payment_collection_method,
        "sportPassFeePercentageBasisPoints": fee_percentage_basis_points,
        "sportPassFeeMinimumPaise": fee_minimum_paise,
        "sportPassFeeMaximumPaise": fee_maximum_paise,
        "sportPassFeeFixedPaise": fee_fixed_paise,
        # Refund policy (shown to participants only when enabled)
        "refundPolicyEnabled": event.refund_policy_enabled,
        "refundPolicyType": event.refund_policy_type if event.refund_policy_enabled else None,
        "refundCutoffAt": event.refund_cutoff_at.isoformat() if event.refund_cutoff_at and event.refund_policy_enabled else None,
        "refundPercentage": event.refund_percentage if event.refund_policy_enabled else None,
        "platformFeeRefundable": event.platform_fee_refundable if event.refund_policy_enabled else None,
        "refundPolicyText": event.refund_policy_text if event.refund_policy_enabled else None,
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
    fee_bps, fee_min, fee_max, fee_fixed = _fee_config_values(db)
    return [_public_event(event, storage, fee_percentage_basis_points=fee_bps, fee_minimum_paise=fee_min, fee_maximum_paise=fee_max, fee_fixed_paise=fee_fixed) for event in events]


@router.get("/events/search")
def search_public_events(
    q: str | None = Query(default=None, max_length=120),
    sport: str | None = Query(default=None, max_length=40),
    city: str | None = Query(default=None, max_length=120),
    timing: str = Query(default="UPCOMING", max_length=20),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=48),
    db: Session = Depends(get_db),
    storage=Depends(get_storage_service),
) -> dict:
    normalized_timing = timing.strip().upper()
    if normalized_timing not in {"UPCOMING", "PAST", "ALL"}:
        raise HTTPException(status_code=422, detail="Unsupported event timing filter")
    filters = [Event.status == "published", Event.archived_at.is_(None)]
    if sport:
        filters.append(Event.category == sport.strip().lower())
    if city:
        filters.append(Event.city == city.strip())
    if q:
        term = f"%{q.strip()}%"
        filters.append(or_(Event.name.ilike(term), Event.location_name.ilike(term), Event.city.ilike(term), Event.description.ilike(term), Event.category.ilike(term)))
    now = dt.datetime.now(dt.timezone.utc)
    event_end = func.coalesce(Event.end_date, Event.start_date)
    if normalized_timing == "UPCOMING":
        filters.append(event_end >= now)
    elif normalized_timing == "PAST":
        filters.append(event_end < now)
    total = int(db.scalar(select(func.count()).select_from(Event).where(*filters)) or 0)
    order = Event.start_date.desc() if normalized_timing == "PAST" else Event.start_date.asc()
    events = db.scalars(_event_query().where(*filters).order_by(order, Event.id).offset((page - 1) * page_size).limit(page_size)).unique().all()
    facet_filter = [Event.status == "published", Event.archived_at.is_(None)]
    sports = [value for value in db.scalars(select(Event.category).where(*facet_filter).distinct().order_by(Event.category)).all() if value]
    cities = [value for value in db.scalars(select(Event.city).where(*facet_filter, Event.city.is_not(None)).distinct().order_by(Event.city)).all() if value]
    fee_bps, fee_min, fee_max, fee_fixed = _fee_config_values(db)
    return {
        "items": [_public_event(event, storage, fee_percentage_basis_points=fee_bps, fee_minimum_paise=fee_min, fee_maximum_paise=fee_max, fee_fixed_paise=fee_fixed) for event in events],
        "page": page,
        "pageSize": page_size,
        "total": total,
        "sports": sports,
        "cities": cities,
    }


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
        "matches": list_public_match_results(db, event.id, category_id=category_id, status=match_status)
        if get_adapter(event.category).tournament_capable(any(c.entry_type == "team" for c in event.categories)) else [],
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
    return get_adapter(sport).number_label


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
    fee_bps, fee_min, fee_max, fee_fixed = _fee_config_values(db)
    return _public_event(event, storage, fee_percentage_basis_points=fee_bps, fee_minimum_paise=fee_min, fee_maximum_paise=fee_max, fee_fixed_paise=fee_fixed)


@router.get("/organizer-plans")
def list_public_organizer_plans(db: Session = Depends(get_db)) -> dict:
    raise HTTPException(status_code=410, detail="Legacy organizer plans have been unwired.")



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
        return compute_standings(db, event_uuid, category_uuid, approved_only=True)
    except MatchValidationError as exc:
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=404, detail=str(exc))
