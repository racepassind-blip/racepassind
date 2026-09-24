"""Race-time result service — isolated from match/tournament logic.

Responsibilities:
  - Parse HH:MM:SS ↔ timedelta
  - Parse distance strings ("5 KM", "500 M", "21.1 KM") → metres (float)
  - Calculate pace (running) and average speed (cycling)
  - Bulk-upsert a result set for an event (draft mode)
  - Publish / revert-to-draft a result set
  - Build organizer and public response dicts
  - Re-rank Finished participants by lowest finish_time within each category
"""
from __future__ import annotations

import datetime as dt
import re
import uuid
from typing import TYPE_CHECKING

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

if TYPE_CHECKING:
    pass

from app.schemas.race_results import (
    OrganizerRaceResultEntry,
    OrganizerRaceResultsOut,
    PublicRaceCategoryResults,
    PublicRaceResultEntry,
    PublicRaceResultsOut,
    RaceResultBulkSaveIn,
)
from models import Event, EventCategory, Participant, RaceResult, Registration

# ---------------------------------------------------------------------------
# Time helpers
# ---------------------------------------------------------------------------

def hhmmss_to_timedelta(s: str) -> dt.timedelta:
    """Convert "HH:MM:SS" to a timedelta.  Raises ValueError on bad input."""
    parts = s.strip().split(":")
    if len(parts) != 3:
        raise ValueError(f"Expected HH:MM:SS, got: {s!r}")
    h, m, sec = int(parts[0]), int(parts[1]), int(parts[2])
    return dt.timedelta(hours=h, minutes=m, seconds=sec)


def timedelta_to_hhmmss(td: dt.timedelta) -> str:
    """Convert a timedelta to "HH:MM:SS"."""
    total = int(td.total_seconds())
    h, remainder = divmod(total, 3600)
    m, s = divmod(remainder, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


# ---------------------------------------------------------------------------
# Distance helpers
# ---------------------------------------------------------------------------

_DIST_RE = re.compile(r"^\s*([\d.]+)\s*(km|m)\s*$", re.IGNORECASE)


def parse_distance_to_metres(distance: str | None) -> float | None:
    """Parse a distance string like "5 KM", "500 M", "21.1 KM" → metres.

    Returns None if the string is absent or unparseable.
    """
    if not distance:
        return None
    m = _DIST_RE.match(distance)
    if not m:
        return None
    value, unit = float(m.group(1)), m.group(2).upper()
    return value * 1000.0 if unit == "KM" else value


def is_cycling_sport(sport: str) -> bool:
    return sport.strip().lower() == "cycling"


# ---------------------------------------------------------------------------
# Calculation helpers
# ---------------------------------------------------------------------------

def calc_pace_seconds_per_km(total_seconds: float, distance_metres: float) -> int | None:
    """Running pace: seconds per km.  Returns None if inputs are invalid."""
    if distance_metres <= 0 or total_seconds <= 0:
        return None
    distance_km = distance_metres / 1000.0
    return round(total_seconds / distance_km)


def calc_speed_kmh_x100(total_seconds: float, distance_metres: float) -> int | None:
    """Cycling speed × 100 to keep integer storage (e.g. 3500 = 35.00 km/h)."""
    if distance_metres <= 0 or total_seconds <= 0:
        return None
    distance_km = distance_metres / 1000.0
    hours = total_seconds / 3600.0
    speed_kmh = distance_km / hours
    return round(speed_kmh * 100)


def format_pace(pace_seconds_per_km: int | None) -> str | None:
    """Format pace as "M:SS /km"."""
    if pace_seconds_per_km is None:
        return None
    m, s = divmod(pace_seconds_per_km, 60)
    return f"{m}:{s:02d} /km"


def format_speed(speed_kmh_x100: int | None) -> str | None:
    """Format speed as "35.00 km/h"."""
    if speed_kmh_x100 is None:
        return None
    return f"{speed_kmh_x100 / 100:.2f} km/h"


# ---------------------------------------------------------------------------
# Re-ranking
# ---------------------------------------------------------------------------

def _rerank(results: list[RaceResult]) -> None:
    """Assign rank within category, sorted by finish_time ascending.

    Only Finished entries with a finish_time receive a rank.
    All other statuses (DNS, DNF, DSQ) get rank = None.
    Mutates the objects in-place — caller must commit.
    """
    # Group by category_id (None is its own group)
    by_cat: dict[uuid.UUID | None, list[RaceResult]] = {}
    for r in results:
        by_cat.setdefault(r.category_id, []).append(r)

    for entries in by_cat.values():
        finished = sorted(
            [e for e in entries if e.result_status == "Finished" and e.finish_time is not None],
            key=lambda e: e.finish_time,  # type: ignore[arg-type]
        )
        for pos, entry in enumerate(finished, start=1):
            entry.rank = pos
        for entry in entries:
            if entry.result_status != "Finished" or entry.finish_time is None:
                entry.rank = None


# ---------------------------------------------------------------------------
# Core service functions
# ---------------------------------------------------------------------------

def _load_categories(db: Session, event_id: uuid.UUID) -> dict[uuid.UUID, EventCategory]:
    cats = db.scalars(select(EventCategory).where(EventCategory.event_id == event_id)).all()
    return {c.id: c for c in cats}


def bulk_save_draft(
    db: Session,
    event: Event,
    payload: RaceResultBulkSaveIn,
) -> OrganizerRaceResultsOut:
    """Replace draft rows for this event, optionally scoped to one category.

    If payload.category_id is set, only rows for that category are deleted and
    reinserted — all other categories are left untouched.
    If payload.category_id is None, all rows for the event are replaced.
    """
    sport = event.category.strip().lower()
    cats = _load_categories(db, event.id)

    # Delete only the scoped category's rows (or all if no scope)
    delete_query = select(RaceResult).where(RaceResult.event_id == event.id)
    if payload.category_id is not None:
        delete_query = delete_query.where(RaceResult.category_id == payload.category_id)
    existing = db.scalars(delete_query).all()
    for row in existing:
        db.delete(row)
    db.flush()

    new_rows: list[RaceResult] = []

    for entry in payload.entries:
        # Resolve participant_id
        participant_id: uuid.UUID | None = None
        registration_id: uuid.UUID | None = entry.registration_id
        bib_number: int | None = None

        if entry.registration_id:
            reg = db.get(
                Registration,
                entry.registration_id,
                options=[selectinload(Registration.participant)],
            )
            if reg is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Registration {entry.registration_id} not found",
                )
            participant_id = reg.participant_id
            bib_number = reg.allocation_number
        elif entry.participant_id:
            participant_id = entry.participant_id
        else:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Each entry must have registration_id or participant_id",
            )

        # Parse finish time
        finish_td: dt.timedelta | None = None
        pace: int | None = None
        speed: int | None = None

        if entry.result_status == "Finished":
            if not entry.finish_time_hhmmss:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="finish_time_hhmmss is required for Finished entries",
                )
            finish_td = hhmmss_to_timedelta(entry.finish_time_hhmmss)
            total_seconds = finish_td.total_seconds()

            # Determine category distance for pace/speed
            cat = cats.get(entry.category_id) if entry.category_id else None
            dist_m = parse_distance_to_metres(cat.distance if cat else None)

            if dist_m is not None:
                if is_cycling_sport(sport):
                    speed = calc_speed_kmh_x100(total_seconds, dist_m)
                else:
                    pace = calc_pace_seconds_per_km(total_seconds, dist_m)

        row = RaceResult(
            event_id=event.id,
            participant_id=participant_id,
            registration_id=registration_id,
            category_id=entry.category_id,
            result_status=entry.result_status,
            result_set_status="draft",
            finish_time=finish_td,
            pace_seconds_per_km=pace,
            speed_kmh_x100=speed,
            rank=None,
        )
        db.add(row)
        new_rows.append(row)

    db.flush()
    _rerank(new_rows)
    db.commit()
    for r in new_rows:
        db.refresh(r)

    return _build_organizer_out(db, event, new_rows, cats)


def publish_results(db: Session, event: Event, category_id: uuid.UUID | None = None) -> OrganizerRaceResultsOut:
    """Flip rows to published, scoped to one category or all."""
    query = select(RaceResult).where(RaceResult.event_id == event.id)
    if category_id is not None:
        query = query.where(RaceResult.category_id == category_id)
    rows = db.scalars(query).all()
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No results to publish. Save a draft first.",
        )
    for row in rows:
        row.result_set_status = "published"
    db.commit()
    # Return full event results (all categories) so the editor stays in sync
    all_rows = db.scalars(select(RaceResult).where(RaceResult.event_id == event.id)).all()
    cats = _load_categories(db, event.id)
    return _build_organizer_out(db, event, list(all_rows), cats)


def unpublish_results(db: Session, event: Event, category_id: uuid.UUID | None = None) -> OrganizerRaceResultsOut:
    """Revert rows back to draft, scoped to one category or all."""
    query = select(RaceResult).where(RaceResult.event_id == event.id)
    if category_id is not None:
        query = query.where(RaceResult.category_id == category_id)
    rows = db.scalars(query).all()
    for row in rows:
        row.result_set_status = "draft"
    db.commit()
    all_rows = db.scalars(select(RaceResult).where(RaceResult.event_id == event.id)).all()
    cats = _load_categories(db, event.id)
    return _build_organizer_out(db, event, list(all_rows), cats)


def get_organizer_results(db: Session, event: Event) -> OrganizerRaceResultsOut:
    """Load all rows (any status) for the organizer editor."""
    rows = db.scalars(
        select(RaceResult)
        .options(
            selectinload(RaceResult.participant),
            selectinload(RaceResult.registration),
            selectinload(RaceResult.category),
        )
        .where(RaceResult.event_id == event.id)
        .order_by(RaceResult.category_id, RaceResult.rank, RaceResult.created_at)
    ).all()
    cats = _load_categories(db, event.id)
    return _build_organizer_out(db, event, list(rows), cats)


def get_public_results(db: Session, event_id: uuid.UUID) -> PublicRaceResultsOut:
    """Load only published rows for the public results page."""
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    rows = db.scalars(
        select(RaceResult)
        .options(
            selectinload(RaceResult.participant),
            selectinload(RaceResult.registration),
            selectinload(RaceResult.category),
        )
        .where(
            RaceResult.event_id == event_id,
            RaceResult.result_set_status == "published",
        )
        .order_by(RaceResult.category_id, RaceResult.rank, RaceResult.result_status)
    ).all()

    cats = _load_categories(db, event_id)
    sport = event.category.strip().lower()

    # Determine overall result_set_status: published if ANY row is published
    overall_status = "published" if rows else "draft"

    # Group by category
    by_cat: dict[uuid.UUID | None, list[RaceResult]] = {}
    for r in rows:
        by_cat.setdefault(r.category_id, []).append(r)

    cat_results: list[PublicRaceCategoryResults] = []

    # Emit in category creation order; add uncategorised last
    ordered_cat_ids: list[uuid.UUID | None] = [c.id for c in sorted(cats.values(), key=lambda c: c.created_at)]
    if None in by_cat:
        ordered_cat_ids.append(None)

    for cat_id in ordered_cat_ids:
        if cat_id not in by_cat:
            continue
        cat_rows = by_cat[cat_id]
        cat = cats.get(cat_id) if cat_id else None
        cat_name = cat.name if cat else "General"
        distance_str = cat.distance if cat else None

        entries: list[PublicRaceResultEntry] = []
        for r in cat_rows:
            p_name = r.participant.name if r.participant else "Unknown"
            bib = r.registration.allocation_number if r.registration else None
            ft = timedelta_to_hhmmss(r.finish_time) if r.finish_time else None

            pace_disp = format_pace(r.pace_seconds_per_km) if not is_cycling_sport(sport) else None
            speed_disp = format_speed(r.speed_kmh_x100) if is_cycling_sport(sport) else None

            entries.append(
                PublicRaceResultEntry(
                    rank=r.rank,
                    participant_name=p_name,
                    bib_number=bib,
                    result_status=r.result_status,  # type: ignore[arg-type]
                    finish_time_hhmmss=ft,
                    pace_display=pace_disp,
                    speed_display=speed_disp,
                )
            )

        cat_results.append(
            PublicRaceCategoryResults(
                category_id=cat_id,
                category_name=cat_name,
                distance=distance_str,
                participant_count=len(cat_rows),
                entries=entries,
            )
        )

    return PublicRaceResultsOut(
        event_id=event_id,
        event_name=event.name,
        sport=sport,
        result_set_status=overall_status,  # type: ignore[arg-type]
        categories=cat_results,
    )


# ---------------------------------------------------------------------------
# Internal builder helpers
# ---------------------------------------------------------------------------

def _build_organizer_out(
    db: Session,
    event: Event,
    rows: list[RaceResult],
    cats: dict[uuid.UUID, EventCategory],
) -> OrganizerRaceResultsOut:
    sport = event.category.strip().lower()

    # Per-category publish status
    cat_status: dict[str, str] = {}
    by_cat: dict[str | None, list[RaceResult]] = {}
    for r in rows:
        key = str(r.category_id) if r.category_id else "__none__"
        by_cat.setdefault(key, []).append(r)
    for key, cat_rows in by_cat.items():
        if cat_rows and all(r.result_set_status == "published" for r in cat_rows):
            cat_status[key] = "published"
        else:
            cat_status[key] = "draft"

    # Overall: published only if ALL rows are published
    if rows and all(r.result_set_status == "published" for r in rows):
        overall: str = "published"
    else:
        overall = "draft"

    entries: list[OrganizerRaceResultEntry] = []
    for r in rows:
        participant = r.participant if r.participant else db.get(Participant, r.participant_id)
        p_name = participant.name if participant else "Unknown"
        bib: int | None = None
        if r.registration:
            bib = r.registration.allocation_number
        elif r.registration_id:
            reg = db.get(Registration, r.registration_id)
            bib = reg.allocation_number if reg else None

        cat = cats.get(r.category_id) if r.category_id else None
        ft = timedelta_to_hhmmss(r.finish_time) if r.finish_time else None

        entries.append(
            OrganizerRaceResultEntry(
                id=r.id,
                registration_id=r.registration_id,
                participant_id=r.participant_id,
                participant_name=p_name,
                bib_number=bib,
                category_id=r.category_id,
                category_name=cat.name if cat else None,
                result_status=r.result_status,  # type: ignore[arg-type]
                finish_time_hhmmss=ft,
                rank=r.rank,
                pace_seconds_per_km=r.pace_seconds_per_km,
                speed_kmh_x100=r.speed_kmh_x100,
            )
        )

    return OrganizerRaceResultsOut(
        event_id=event.id,
        event_name=event.name,
        sport=sport,
        result_set_status=overall,  # type: ignore[arg-type]
        category_statuses=cat_status,  # type: ignore[arg-type]
        entries=entries,
    )
