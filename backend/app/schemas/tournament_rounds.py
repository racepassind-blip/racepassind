from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TournamentRoundIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID | None = None
    name: str = Field(min_length=1, max_length=160)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized or any(ord(character) < 32 or ord(character) == 127 for character in normalized):
            raise ValueError("Round name contains unsupported characters")
        return normalized


class TournamentRoundsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rounds: list[TournamentRoundIn] = Field(max_length=32)
