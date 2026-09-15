from __future__ import annotations

import datetime as dt
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


MatchStatus = Literal["scheduled", "in_progress", "completed"]
MatchWinner = Literal["entry_a", "entry_b"]


class MatchGameIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    game_number: int = Field(ge=1, le=9)
    score_a: int = Field(ge=0, le=30)
    score_b: int = Field(ge=0, le=30)


class ScoringConfigIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    games_to_win: int = Field(ge=1, le=5)
    points_per_game: int = Field(ge=1, le=30)


class MatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_id: UUID
    entry_a_registration_id: UUID
    entry_b_registration_id: UUID
    court_id: UUID
    round_id: UUID | None = None
    round_label: str = Field(min_length=1, max_length=160)
    scheduled_time: dt.datetime | None = None
    status: MatchStatus = "scheduled"
    winner: MatchWinner | None = None
    games: list[MatchGameIn] | None = Field(default=None, max_length=9)

    @field_validator("round_label")
    @classmethod
    def normalize_round_label(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized or any(ord(character) < 32 or ord(character) == 127 for character in normalized):
            raise ValueError("Round label contains unsupported characters")
        return normalized
