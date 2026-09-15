from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_authorized_event, require_csrf, require_roles
from app.schemas.tournament_rounds import TournamentRoundsIn
from app.services.tournament_round_service import (
    TournamentRoundValidationError,
    list_tournament_rounds,
    update_tournament_rounds,
)
from db import get_db
from models import User

router = APIRouter()


def _require_badminton(event) -> None:
    if event.category.casefold() != "badminton":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tournament rounds are not available for this event")


def _validation_error(error: TournamentRoundValidationError) -> HTTPException:
    detail = str(error)
    code = status.HTTP_409_CONFLICT if "cannot be removed" in detail else status.HTTP_422_UNPROCESSABLE_ENTITY
    return HTTPException(status_code=code, detail=detail)


@router.get("/events/{event_id}/tournament-rounds")
def get_tournament_rounds(
    event_id: UUID,
    category_id: UUID = Query(...),
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
) -> list[dict]:
    event = get_authorized_event(db, user, event_id)
    _require_badminton(event)
    try:
        return list_tournament_rounds(db, event, category_id)
    except TournamentRoundValidationError as exc:
        raise _validation_error(exc) from exc


@router.put("/events/{event_id}/categories/{category_id}/tournament-rounds")
def put_tournament_rounds(
    event_id: UUID,
    category_id: UUID,
    payload: TournamentRoundsIn,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> list[dict]:
    event = get_authorized_event(db, user, event_id)
    _require_badminton(event)
    try:
        return update_tournament_rounds(db, event, category_id, payload)
    except TournamentRoundValidationError as exc:
        db.rollback()
        raise _validation_error(exc) from exc
