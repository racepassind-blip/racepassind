from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_authorized_event, require_csrf, require_roles
from app.schemas.matches import MatchIn, ScoringConfigIn
from app.services.match_service import (
    MatchValidationError,
    create_match,
    delete_match,
    list_match_entries,
    list_matches,
    list_scoring_configs,
    update_match,
    update_scoring_config,
)
from db import get_db
from models import User

router = APIRouter()


def _require_badminton(event) -> None:
    if event.category.casefold() != "badminton":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Badminton matches are not available for this event")


def _validation_error(error: MatchValidationError) -> HTTPException:
    detail = str(error)
    code = status.HTTP_404_NOT_FOUND if detail == "Match not found" else status.HTTP_422_UNPROCESSABLE_ENTITY
    return HTTPException(status_code=code, detail=detail)


@router.get("/events/{event_id}/scoring-config")
def get_scoring_config(
    event_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
) -> dict:
    event = get_authorized_event(db, user, event_id)
    _require_badminton(event)
    return {"categories": list_scoring_configs(db, event)}


@router.put("/events/{event_id}/categories/{category_id}/scoring-config")
def put_scoring_config(
    event_id: UUID,
    category_id: UUID,
    payload: ScoringConfigIn,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    event = get_authorized_event(db, user, event_id)
    _require_badminton(event)
    try:
        return update_scoring_config(db, event, category_id, payload)
    except MatchValidationError as exc:
        db.rollback()
        raise _validation_error(exc) from exc


@router.get("/events/{event_id}/match-entries")
def get_match_entries(
    event_id: UUID,
    category_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
) -> list[dict]:
    event = get_authorized_event(db, user, event_id)
    _require_badminton(event)
    try:
        return list_match_entries(db, user, event, category_id)
    except MatchValidationError as exc:
        raise _validation_error(exc) from exc


@router.get("/events/{event_id}/matches")
def get_matches(
    event_id: UUID,
    category_id: UUID | None = None,
    match_status: str | None = Query(default=None, alias="status", max_length=30),
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
) -> list[dict]:
    event = get_authorized_event(db, user, event_id)
    _require_badminton(event)
    if match_status is not None and match_status not in {"scheduled", "in_progress", "completed"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unsupported match status")
    return list_matches(db, event.id, category_id=category_id, status=match_status)


@router.post("/events/{event_id}/matches", status_code=status.HTTP_201_CREATED)
def post_match(
    event_id: UUID,
    payload: MatchIn,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    event = get_authorized_event(db, user, event_id)
    _require_badminton(event)
    try:
        return create_match(db, user, event, payload)
    except MatchValidationError as exc:
        db.rollback()
        raise _validation_error(exc) from exc


@router.put("/events/{event_id}/matches/{match_id}")
def put_match(
    event_id: UUID,
    match_id: UUID,
    payload: MatchIn,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    event = get_authorized_event(db, user, event_id)
    _require_badminton(event)
    try:
        return update_match(db, user, event, match_id, payload)
    except MatchValidationError as exc:
        db.rollback()
        raise _validation_error(exc) from exc


@router.delete("/events/{event_id}/matches/{match_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def remove_match(
    event_id: UUID,
    match_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> None:
    event = get_authorized_event(db, user, event_id)
    _require_badminton(event)
    try:
        delete_match(db, event.id, match_id)
    except MatchValidationError as exc:
        db.rollback()
        raise _validation_error(exc) from exc
