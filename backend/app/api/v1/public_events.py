from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from db import get_db
from models import Event, EventCategory, Ticket
from schemas import EventOut

router = APIRouter()


def _public_event(event: Event) -> dict:
    tickets = list(event.tickets)
    if event.categories:
        ordered_tickets = []
        for category in event.categories:
            for ticket in category.tickets:
                ordered_tickets.append((category.name, ticket))
    else:
        ordered_tickets = [(event.distance, ticket) for ticket in tickets]

    tiers = [
        {
            "id": ticket.id,
            "name": f"{category_name} · {ticket.name}" if category_name else ticket.name,
            "price": ticket.price // 100 if ticket.currency == "INR" else ticket.price,
            "description": ticket.description,
            "available": ticket.available,
        }
        for category_name, ticket in ordered_tickets
    ]
    return {
        "id": event.id,
        "title": event.title,
        "date": event.date,
        "location": event.location,
        "category": event.category,
        "image": event.image,
        "description": event.description,
        "distance": event.distance,
        "participants": event.participants,
        "maxParticipants": event.maxParticipants,
        "organizer": event.organizer,
        "rules": event.rules,
        "tiers": tiers,
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
    return [_public_event(event) for event in events]


@router.get("/events/{event_id}", response_model=EventOut)
def get_public_event(event_id: UUID, db: Session = Depends(get_db)) -> dict:
    event = db.scalars(
        _event_query().where(Event.id == event_id, Event.status == "published", Event.archived_at.is_(None))
    ).unique().first()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return _public_event(event)
