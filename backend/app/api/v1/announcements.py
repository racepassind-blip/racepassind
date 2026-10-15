from __future__ import annotations

import datetime as dt
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.api.deps import require_csrf, require_roles
from app.services.announcement_service import broadcast_announcement_email, create_announcement, delete_draft, get_organizer_announcement, get_public_announcement, list_organizer_announcements, list_participant_announcements, list_public_announcements, update_announcement
from db import get_db
from models import User

router = APIRouter()


class AnnouncementCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    body: str = Field(min_length=1, max_length=10_000)
    status: str = Field(default="DRAFT", max_length=20)
    scheduled_for: dt.datetime | None = None
    is_pinned: bool = False

    @field_validator("status")
    @classmethod
    def normalize_status(cls, value: str) -> str:
        return value.strip().upper()


class AnnouncementUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    body: str | None = Field(default=None, min_length=1, max_length=10_000)
    status: str | None = Field(default=None, max_length=20)
    scheduled_for: dt.datetime | None = None
    is_pinned: bool | None = None

    @field_validator("status")
    @classmethod
    def normalize_status(cls, value: str | None) -> str | None:
        return value.strip().upper() if value else value


@router.get("/events/{event_id}/announcements")
def public_announcements(event_id: UUID, page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100), db: Session = Depends(get_db)) -> dict:
    try:
        return list_public_announcements(db, event_id, page=page, page_size=page_size)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/events/{event_id}/announcements/{announcement_id}")
def public_announcement(event_id: UUID, announcement_id: UUID, db: Session = Depends(get_db)) -> dict:
    try:
        return get_public_announcement(db, event_id, announcement_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/participant/announcements")
def participant_announcements(limit: int = Query(default=12, ge=1, le=50), user: User = Depends(require_roles("participant", "user")), db: Session = Depends(get_db)) -> dict:
    return list_participant_announcements(db, user, limit=limit)


@router.get("/organizer/events/{event_id}/announcements")
def organizer_announcements(event_id: UUID, user: User = Depends(require_roles("organizer", "admin")), db: Session = Depends(get_db)) -> list[dict]:
    try:
        return list_organizer_announcements(db, user, event_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/organizer/events/{event_id}/announcements/{announcement_id}")
def organizer_announcement(event_id: UUID, announcement_id: UUID, user: User = Depends(require_roles("organizer", "admin")), db: Session = Depends(get_db)) -> dict:
    try:
        return get_organizer_announcement(db, user, event_id, announcement_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/organizer/events/{event_id}/announcements", status_code=status.HTTP_201_CREATED)
def create_organizer_announcement(event_id: UUID, payload: AnnouncementCreateIn, user: User = Depends(require_roles("organizer", "admin")), _: None = Depends(require_csrf), db: Session = Depends(get_db)) -> dict:
    try:
        result = create_announcement(db, user, event_id, title=payload.title, body=payload.body, status=payload.status, scheduled_for=payload.scheduled_for, is_pinned=payload.is_pinned)
        db.commit()
        return result
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/organizer/events/{event_id}/announcements/{announcement_id}")
def update_organizer_announcement(event_id: UUID, announcement_id: UUID, payload: AnnouncementUpdateIn, user: User = Depends(require_roles("organizer", "admin")), _: None = Depends(require_csrf), db: Session = Depends(get_db)) -> dict:
    try:
        result = update_announcement(db, user, event_id, announcement_id, title=payload.title, body=payload.body, status=payload.status, scheduled_for=payload.scheduled_for, is_pinned=payload.is_pinned)
        db.commit()
        return result
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.put("/organizer/events/{event_id}/announcements/{announcement_id}")
def replace_organizer_announcement(event_id: UUID, announcement_id: UUID, payload: AnnouncementUpdateIn, user: User = Depends(require_roles("organizer", "admin")), _: None = Depends(require_csrf), db: Session = Depends(get_db)) -> dict:
    return update_organizer_announcement(event_id, announcement_id, payload, user, _, db)


@router.delete("/organizer/events/{event_id}/announcements/{announcement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_organizer_draft(event_id: UUID, announcement_id: UUID, user: User = Depends(require_roles("organizer", "admin")), _: None = Depends(require_csrf), db: Session = Depends(get_db)) -> None:
    try:
        delete_draft(db, user, event_id, announcement_id)
        db.commit()
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/organizer/events/{event_id}/announcements/{announcement_id}/broadcast-email")
def broadcast_organizer_announcement(event_id: UUID, announcement_id: UUID, user: User = Depends(require_roles("organizer", "admin")), _: None = Depends(require_csrf), db: Session = Depends(get_db)) -> dict:
    try:
        result = broadcast_announcement_email(db, user, event_id, announcement_id)
        db.commit()
        return result
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
