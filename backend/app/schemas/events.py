from __future__ import annotations

import datetime as dt
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.services.payment_service import normalize_upi_id


class TicketCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=1000)
    price_rupees: Decimal = Field(gt=Decimal("0"), max_digits=10, decimal_places=2)
    quantity: int = Field(gt=0, le=1000000)
    sale_start: dt.datetime | None = None
    sale_end: dt.datetime | None = None
    max_per_user: int = Field(default=1, ge=1, le=10)


class RaceCategoryCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    distance: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=1000)
    age_min: int | None = Field(default=None, ge=0, le=120)
    age_max: int | None = Field(default=None, ge=0, le=120)
    gender: str | None = Field(default=None, max_length=40)
    tickets: list[TicketCreateIn] = Field(min_length=1, max_length=20)


class OrganizerEventCreateV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    organization_id: UUID
    name: str = Field(min_length=2, max_length=200)
    description: str = Field(min_length=1, max_length=10000)
    sport: str = Field(min_length=2, max_length=40)
    event_date: dt.date
    registration_open: dt.datetime | None = None
    registration_close: dt.datetime | None = None
    location_name: str = Field(min_length=2, max_length=240)
    address: str | None = Field(default=None, max_length=500)
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=120)
    country: str = Field(default="India", min_length=2, max_length=120)
    banner_url: str | None = Field(default=None, max_length=2000)
    max_participants: int = Field(gt=0, le=1000000)
    rules: list[str] = Field(default_factory=list, max_length=50)
    categories: list[RaceCategoryCreateIn] = Field(min_length=1, max_length=20)


class PaymentSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    upi_id: str = Field(min_length=5, max_length=255)
    payee_name: str = Field(min_length=2, max_length=120)
    instructions: str = Field(min_length=2, max_length=2000)

    @field_validator("upi_id")
    @classmethod
    def validate_upi_id(cls, value: str) -> str:
        return normalize_upi_id(value)

    @field_validator("payee_name", "instructions")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized or any(ord(character) < 32 or ord(character) == 127 for character in normalized):
            raise ValueError("Payment text contains unsupported characters")
        return normalized


def rupees_to_paise(value: Decimal) -> int:
    paise = value * 100
    result = int(paise)
    if Decimal(result) != paise:
        raise ValueError("Price must have no more than two decimal places")
    return result
