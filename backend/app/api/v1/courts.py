from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_authorized_event, require_csrf, require_roles
from app.schemas.courts import CourtIn
from db import get_db
from models import Court, Event, Match, User

router = APIRouter()


def _serialize_court(court: Court) -> dict[str, str]:
    return {
        "id": str(court.id),
        "eventId": str(court.event_id),
        "name": court.name,
        "createdAt": court.created_at.isoformat(),
    }


def _get_court(db: Session, event: Event, court_id: UUID) -> Court:
    court = db.scalar(select(Court).where(Court.id == court_id, Court.event_id == event.id))
    if court is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Court not found")
    return court


@router.get("/events/{event_id}/courts")
def list_courts(
    event_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
) -> list[dict[str, str]]:
    event = get_authorized_event(db, user, event_id)
    courts = db.scalars(select(Court).where(Court.event_id == event.id).order_by(Court.name, Court.id)).all()
    return [_serialize_court(court) for court in courts]


@router.post("/events/{event_id}/courts", status_code=status.HTTP_201_CREATED)
def create_court(
    event_id: UUID,
    payload: CourtIn,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    event = get_authorized_event(db, user, event_id)
    court = Court(event_id=event.id, name=payload.name)
    db.add(court)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A court with this name already exists for the event") from exc
    db.refresh(court)
    return _serialize_court(court)


@router.put("/events/{event_id}/courts/{court_id}")
def update_court(
    event_id: UUID,
    court_id: UUID,
    payload: CourtIn,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    event = get_authorized_event(db, user, event_id)
    court = _get_court(db, event, court_id)
    court.name = payload.name
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A court with this name already exists for the event") from exc
    db.refresh(court)
    return _serialize_court(court)


@router.delete("/events/{event_id}/courts/{court_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_court(
    event_id: UUID,
    court_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> None:
    event = get_authorized_event(db, user, event_id)
    court = _get_court(db, event, court_id)
    if db.scalar(select(Match.id).where(Match.court_id == court.id)) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Court cannot be deleted while matches use it")
    db.delete(court)
    db.commit()
