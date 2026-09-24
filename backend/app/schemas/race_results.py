"""Pydantic schemas for race-time results (running / cycling events).

Organizer side:
  - RaceResultEntryIn  — create/update a single participant result
  - RaceResultBulkSaveIn — save the full result set for an event (upsert all rows)
  - RaceResultPublishIn  — publish or revert to draft

Public side:
  - PublicRaceResultEntry  — one row in the public results table
  - PublicRaceCategoryResults — one category tab on the public results page
  - PublicRaceResultsOut  — full payload returned by GET /events/{id}/race-results
"""
from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, alias_generators, field_validator


# ---------------------------------------------------------------------------
# Shared literals
# ---------------------------------------------------------------------------

ResultStatus = Literal["Finished", "DNS", "DNF", "DSQ"]
ResultSetStatus = Literal["draft", "published"]


# ---------------------------------------------------------------------------
# Organizer input schemas  (accept camelCase from the frontend)
# ---------------------------------------------------------------------------

class _CamelIn(BaseModel):
    """Base for all inbound schemas — accepts both camelCase and snake_case."""
    model_config = ConfigDict(
        alias_generator=alias_generators.to_camel,
        populate_by_name=True,
    )


class RaceResultEntryIn(_CamelIn):
    """One participant's result row submitted from the organizer editor."""

    registration_id: UUID | None = None
    participant_id: UUID | None = None
    category_id: UUID | None = None
    result_status: ResultStatus = "Finished"
    finish_time_hhmmss: str | None = None

    @field_validator("finish_time_hhmmss")
    @classmethod
    def validate_time_format(cls, v: str | None) -> str | None:
        if v is None:
            return v
        parts = v.strip().split(":")
        if len(parts) != 3:
            raise ValueError("finish_time_hhmmss must be HH:MM:SS")
        try:
            h, m, s = int(parts[0]), int(parts[1]), int(parts[2])
        except ValueError:
            raise ValueError("finish_time_hhmmss must be HH:MM:SS with integer parts")
        if not (0 <= h < 100 and 0 <= m < 60 and 0 <= s < 60):
            raise ValueError("finish_time_hhmmss out of range")
        return f"{h:02d}:{m:02d}:{s:02d}"


class RaceResultBulkSaveIn(_CamelIn):
    """Full result set for one event — replaces rows for the specified category (or all)."""

    entries: list[RaceResultEntryIn]
    # When set, only rows for this category are replaced; other categories untouched.
    category_id: UUID | None = None


# ---------------------------------------------------------------------------
# Organizer output schemas (editor view)
# ---------------------------------------------------------------------------

class _CamelOut(BaseModel):
    """Base for all outbound schemas — serializes as camelCase."""
    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=alias_generators.to_camel,
        populate_by_name=True,
    )


class OrganizerRaceResultEntry(_CamelOut):
    """One row shown in the organizer result editor."""

    id: UUID
    registration_id: UUID | None
    participant_id: UUID
    participant_name: str
    bib_number: int | None
    category_id: UUID | None
    category_name: str | None
    result_status: ResultStatus
    finish_time_hhmmss: str | None
    rank: int | None
    pace_seconds_per_km: int | None
    speed_kmh_x100: int | None


class OrganizerRaceResultsOut(_CamelOut):
    """Full response for the organizer results editor page."""

    event_id: UUID
    event_name: str
    sport: str
    result_set_status: ResultSetStatus
    category_statuses: dict[str, ResultSetStatus]
    entries: list[OrganizerRaceResultEntry]


# ---------------------------------------------------------------------------
# Public output schemas
# ---------------------------------------------------------------------------

class PublicRaceResultEntry(_CamelOut):
    """One row in the public results table."""

    rank: int | None
    participant_name: str
    bib_number: int | None
    result_status: ResultStatus
    finish_time_hhmmss: str | None
    pace_display: str | None
    speed_display: str | None


class PublicRaceCategoryResults(_CamelOut):
    """One category tab on the public results page."""

    category_id: UUID | None
    category_name: str
    distance: str | None          # e.g. "5 KM", "21.1 KM"
    participant_count: int
    entries: list[PublicRaceResultEntry]


class PublicRaceResultsOut(_CamelOut):
    """Full payload returned by GET /events/{id}/race-results."""

    event_id: UUID
    event_name: str
    sport: str
    result_set_status: ResultSetStatus
    categories: list[PublicRaceCategoryResults]
