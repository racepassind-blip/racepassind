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
    score_a: int = Field(ge=0)
    score_b: int = Field(ge=0)


class ScoringConfigIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    games_to_win: int = Field(ge=1, le=5)
    points_per_game: int = Field(ge=1)


MatchType = Literal["singles", "doubles"]


class MatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_id: UUID
    entry_a_registration_id: UUID
    entry_b_registration_id: UUID
    court_id: UUID
    round_id: UUID | None = None
    round_label: str = Field(min_length=1, max_length=160)
    duration_minutes: int = Field(default=30, ge=1, le=1440)
    scheduled_time: dt.datetime | None = None
    status: MatchStatus = "scheduled"
    winner: MatchWinner | None = None
    auto_advance: bool = False
    games: list[MatchGameIn] | None = Field(default=None, max_length=9)
    # Team-mode only: which specific players play this match. Ignored for
    # singles/doubles categories. When provided, match_type decides how many
    # players are required per team (1 for singles, 2 for doubles).
    match_type: MatchType | None = None
    player_a_participant_ids: list[UUID] | None = Field(default=None, max_length=2)
    player_b_participant_ids: list[UUID] | None = Field(default=None, max_length=2)

    @field_validator("round_label")
    @classmethod
    def normalize_round_label(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized or any(ord(character) < 32 or ord(character) == 127 for character in normalized):
            raise ValueError("Round label contains unsupported characters")
        return normalized


class MatchResultApprovalIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    approved: bool


BoutStatus = Literal["scheduled", "in_progress", "completed"]
BoutWinner = Literal["player_a", "player_b", "draw"]
TeamMatchWinnerBy = Literal["bouts", "manual"]


class BoutIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    player_a_reg_participant_id: UUID | None = None
    player_b_reg_participant_id: UUID | None = None
    player_a_name: str | None = Field(default=None, max_length=160)
    player_b_name: str | None = Field(default=None, max_length=160)
    court_id: UUID | None = None
    status: BoutStatus = "scheduled"
    winner: BoutWinner | None = None
    score_a: int | None = Field(default=None, ge=0)
    score_b: int | None = Field(default=None, ge=0)
    scheduled_time: dt.datetime | None = None

    @field_validator("player_a_name", "player_b_name", mode="before")
    @classmethod
    def strip_name(cls, value: str | None) -> str | None:
        return value.strip() if isinstance(value, str) else value


class TeamMatchScoringIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    points_for_win: int = Field(default=3, ge=0, le=100)
    points_for_draw: int = Field(default=1, ge=0, le=100)
    points_for_loss: int = Field(default=0, ge=0, le=100)
    winner_by: TeamMatchWinnerBy = "bouts"
