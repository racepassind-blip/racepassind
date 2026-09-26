"""Race-time results API router."""
from __future__ import annotations

from app.sports import get_adapter

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_authorized_event, require_csrf, require_roles
from app.schemas.race_results import (
    OrganizerRaceResultsOut,
    PublicRaceResultsOut,
    RaceResultBulkSaveIn,
)
from app.services.race_result_service import (
    bulk_save_draft,
    get_organizer_results,
    get_public_results,
    publish_results,
    unpublish_results,
)
from db import get_db
from models import User

router = APIRouter()

# ---------------------------------------------------------------------------
# Organizer routes
# ---------------------------------------------------------------------------


@router.get(
    "/organizer/events/{event_id}/race-results",
    response_model=OrganizerRaceResultsOut,
    response_model_by_alias=True,
)
def organizer_get_race_results(
    event_id: UUID,
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
) -> OrganizerRaceResultsOut:
    event = get_authorized_event(db, user, event_id)
    return get_organizer_results(db, event)


@router.post(
    "/organizer/events/{event_id}/race-results",
    response_model=OrganizerRaceResultsOut,
    response_model_by_alias=True,
)
def organizer_save_race_results(
    event_id: UUID,
    payload: RaceResultBulkSaveIn,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> OrganizerRaceResultsOut:
    event = get_authorized_event(db, user, event_id)
    _require_race_event(event.category)
    return bulk_save_draft(db, event, payload)


@router.post(
    "/organizer/events/{event_id}/race-results/publish",
    response_model=OrganizerRaceResultsOut,
    response_model_by_alias=True,
)
def organizer_publish_race_results(
    event_id: UUID,
    category_id: UUID | None = None,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> OrganizerRaceResultsOut:
    event = get_authorized_event(db, user, event_id)
    _require_race_event(event.category)
    return publish_results(db, event, category_id=category_id)


@router.post(
    "/organizer/events/{event_id}/race-results/unpublish",
    response_model=OrganizerRaceResultsOut,
    response_model_by_alias=True,
)
def organizer_unpublish_race_results(
    event_id: UUID,
    category_id: UUID | None = None,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> OrganizerRaceResultsOut:
    event = get_authorized_event(db, user, event_id)
    _require_race_event(event.category)
    return unpublish_results(db, event, category_id=category_id)


# ---------------------------------------------------------------------------
# Public route
# ---------------------------------------------------------------------------


@router.get(
    "/events/{event_id}/race-results",
    response_model=PublicRaceResultsOut,
    response_model_by_alias=True,
)
def public_get_race_results(
    event_id: UUID,
    db: Session = Depends(get_db),
) -> PublicRaceResultsOut:
    return get_public_results(db, event_id)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _require_race_event(category: str) -> None:
    sport = category.strip().lower()
    if get_adapter(sport).result_type != "race_time":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Race-time results are not available for '{sport}'.",
        )
