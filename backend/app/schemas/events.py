from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services.payment_service import normalize_upi_id
from app.services.registration_config_service import normalize_addon_config, normalize_field_config, normalize_team_field_config, is_team_field_config


class TicketCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=1000)
    price_rupees: Decimal = Field(ge=Decimal("0"), max_digits=10, decimal_places=2)
    quantity: int = Field(gt=0, le=1000000)
    sale_start: dt.datetime | None = None
    sale_end: dt.datetime | None = None
    max_per_user: int = Field(default=1, ge=1, le=10)


class RaceCategoryCreateIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    distance: str | None = Field(default=None, max_length=80)
    description: str = Field(default="", max_length=1000)
    age_min: int | None = Field(default=None, ge=0, le=120)
    age_max: int | None = Field(default=None, ge=0, le=120)
    gender: str | None = Field(default=None, max_length=40)
    entry_type: Literal["singles", "doubles", "team"] = "singles"
    participants_per_entry: int = Field(default=1, ge=1, le=50)
    # Team-only: flexible size range (min 2, max 50)
    team_size_min: int | None = Field(default=None, ge=2, le=50)
    team_size_max: int | None = Field(default=None, ge=2, le=50)
    tickets: list[TicketCreateIn] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def validate_entry_format(self):
        if self.entry_type == "singles":
            self.participants_per_entry = 1
            self.team_size_min = None
            self.team_size_max = None
        elif self.entry_type == "doubles":
            self.participants_per_entry = 2
            self.team_size_min = None
            self.team_size_max = None
        else:  # team
            if self.team_size_min is None or self.team_size_max is None:
                raise ValueError("Team categories require team_size_min and team_size_max")
            if self.team_size_min > self.team_size_max:
                raise ValueError("team_size_min must be less than or equal to team_size_max")
            # Keep participants_per_entry in sync (= min) for legacy compatibility
            self.participants_per_entry = self.team_size_min
        return self


class EventScheduleItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    time: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=240)


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
    whatsapp_group_url: str | None = Field(default=None, max_length=2000)
    max_participants: int = Field(gt=0, le=1000000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    rules: list[str] = Field(default_factory=list, max_length=50)
    schedule: list[EventScheduleItem] = Field(default_factory=list, max_length=50)
    field_config: dict[str, Any] = Field(default_factory=lambda: normalize_field_config(None))
    addon_config: dict[str, Any] = Field(default_factory=lambda: normalize_addon_config(None))
    payment_collection_method: Literal["DIRECT_UPI", "PAYMENT_GATEWAY"] = Field(default="DIRECT_UPI")
    categories: list[RaceCategoryCreateIn] = Field(min_length=1, max_length=20)

    @field_validator("field_config")
    @classmethod
    def validate_field_config(cls, value: dict[str, Any]) -> dict[str, Any]:
        if is_team_field_config(value):
            return normalize_team_field_config(value)
        return normalize_field_config(value)

    @field_validator("addon_config")
    @classmethod
    def validate_addon_config(cls, value: dict[str, Any]) -> dict[str, Any]:
        return normalize_addon_config(value)

    @model_validator(mode="after")
    def validate_category_distances(self):
        is_badminton = self.sport.strip().lower() == "badminton"
        for category in self.categories:
            normalized_distance = category.distance.strip() if category.distance else None
            if not is_badminton and not normalized_distance:
                raise ValueError("Distance is required for non-badminton events")
            category.distance = normalized_distance if not is_badminton else None
        return self

    @model_validator(mode="after")
    def validate_coordinates(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude and longitude must be provided together")
        return self


class OrganizerTicketUpdateIn(BaseModel):
    id: UUID | None = None
    name: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=1000)
    price_rupees: Decimal = Field(ge=Decimal("0"), max_digits=10, decimal_places=2)
    quantity: int = Field(gt=0, le=1000000)
    sale_start: dt.datetime | None = None
    sale_end: dt.datetime | None = None
    max_per_user: int = Field(default=1, ge=1, le=10)


class OrganizerCategoryUpdateIn(BaseModel):
    id: UUID | None = None
    name: str = Field(min_length=2, max_length=120)
    distance: str | None = Field(default=None, max_length=80)
    description: str = Field(default="", max_length=1000)
    age_min: int | None = Field(default=None, ge=0, le=120)
    age_max: int | None = Field(default=None, ge=0, le=120)
    gender: str | None = Field(default=None, max_length=40)
    entry_type: Literal["singles", "doubles", "team"] = "singles"
    participants_per_entry: int = Field(default=1, ge=1, le=50)
    # Team-only: flexible size range (min 2, max 50)
    team_size_min: int | None = Field(default=None, ge=2, le=50)
    team_size_max: int | None = Field(default=None, ge=2, le=50)
    tickets: list[OrganizerTicketUpdateIn] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def validate_entry_format(self):
        if self.entry_type == "singles":
            self.participants_per_entry = 1
            self.team_size_min = None
            self.team_size_max = None
        elif self.entry_type == "doubles":
            self.participants_per_entry = 2
            self.team_size_min = None
            self.team_size_max = None
        else:  # team
            if self.team_size_min is None or self.team_size_max is None:
                raise ValueError("Team categories require team_size_min and team_size_max")
            if self.team_size_min > self.team_size_max:
                raise ValueError("team_size_min must be less than or equal to team_size_max")
            # Keep participants_per_entry in sync (= min) for legacy compatibility
            self.participants_per_entry = self.team_size_min
        return self


class OrganizerEventUpdateV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=200)
    description: str = Field(min_length=1, max_length=10000)
    sport: str = Field(min_length=2, max_length=40)
    event_date: dt.date
    location_name: str = Field(min_length=2, max_length=240)
    address: str | None = Field(default=None, max_length=500)
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=120)
    country: str = Field(default="India", min_length=2, max_length=120)
    banner_url: str | None = Field(default=None, max_length=2000)
    whatsapp_group_url: str | None = Field(default=None, max_length=2000)
    max_participants: int = Field(gt=0, le=1000000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    rules: list[str] = Field(default_factory=list, max_length=50)
    schedule: list[EventScheduleItem] = Field(default_factory=list, max_length=50)
    registration_open: dt.datetime | None = None
    registration_close: dt.datetime | None = None
    field_config: dict[str, Any] = Field(default_factory=lambda: normalize_field_config(None))
    addon_config: dict[str, Any] = Field(default_factory=lambda: normalize_addon_config(None))
    payment_collection_method: Literal["DIRECT_UPI", "PAYMENT_GATEWAY"] | None = None
    categories: list[OrganizerCategoryUpdateIn] = Field(min_length=1, max_length=20)

    @field_validator("field_config")
    @classmethod
    def validate_field_config(cls, value: dict[str, Any]) -> dict[str, Any]:
        if is_team_field_config(value):
            return normalize_team_field_config(value)
        return normalize_field_config(value)

    @field_validator("addon_config")
    @classmethod
    def validate_addon_config(cls, value: dict[str, Any]) -> dict[str, Any]:
        return normalize_addon_config(value)

    @model_validator(mode="after")
    def validate_category_distances(self):
        is_badminton = self.sport.strip().lower() == "badminton"
        for category in self.categories:
            normalized_distance = category.distance.strip() if category.distance else None
            if not is_badminton and not normalized_distance:
                raise ValueError("Distance is required for non-badminton events")
            category.distance = normalized_distance if not is_badminton else None
        return self

    @model_validator(mode="after")
    def validate_coordinates(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude and longitude must be provided together")
        return self


class RegistrationStatusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["open", "closed"]


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
