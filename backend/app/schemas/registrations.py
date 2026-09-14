from __future__ import annotations

import datetime as dt
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services.payment_service import normalize_payment_reference


class RegistrationCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: UUID
    ticket_id: UUID
    full_name: str | None = Field(default=None, max_length=160)
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=32)
    date_of_birth: dt.date | None = None
    gender: str | None = Field(default=None, max_length=40)
    jersey_size: str | None = Field(default=None, max_length=20)
    emergency_contact: str | None = Field(default=None, max_length=160)
    team_name: str | None = Field(default=None, max_length=160)
    responses: dict[str, Any] = Field(default_factory=dict)
    selections: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def require_contact(self) -> "RegistrationCreateIn":
        full_name = self.full_name or self.responses.get("full_name")
        if not isinstance(full_name, str) or not full_name.strip():
            raise ValueError("Full name is required")
        email = self.email or self.responses.get("email")
        phone = self.phone or self.responses.get("phone")
        if not (isinstance(email, str) and email.strip()) and not (isinstance(phone, str) and phone.strip()):
            raise ValueError("At least one of email or phone is required")
        return self


class RiderRegistrationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ticket_id: UUID
    responses: dict[str, Any] = Field(default_factory=dict)
    selections: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def require_contact(self) -> "RiderRegistrationIn":
        full_name = self.responses.get("full_name")
        if not isinstance(full_name, str) or not full_name.strip():
            raise ValueError("Full name is required")
        email = self.responses.get("email")
        phone = self.responses.get("phone")
        if not (isinstance(email, str) and email.strip()) and not (isinstance(phone, str) and phone.strip()):
            raise ValueError("At least one of email or phone is required")
        return self


class BatchRegistrationCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: UUID
    riders: list[RiderRegistrationIn] = Field(min_length=1, max_length=10)


class ManualRegistrationCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: UUID
    ticket_id: UUID
    responses: dict[str, Any] = Field(default_factory=dict)
    selections: dict[str, Any] = Field(default_factory=dict)
    payment_received: bool = False
    received_amount_paise: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_payment(self) -> "ManualRegistrationCreateIn":
        if not self.payment_received and self.received_amount_paise is not None:
            raise ValueError("Received payment amount requires payment to be marked received")
        return self


class PaymentReferenceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirmation_token: str = Field(min_length=20, max_length=200)
    utr_reference: str | None = Field(default=None, max_length=120)

    @field_validator("confirmation_token")
    @classmethod
    def normalize_confirmation_token(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Confirmation token is required")
        return normalized

    @field_validator("utr_reference", mode="before")
    @classmethod
    def validate_utr_reference(cls, value: str | None) -> str | None:
        return normalize_payment_reference(value)


class ConfirmationLookupIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirmation_token: str = Field(min_length=20, max_length=200)

    @field_validator("confirmation_token")
    @classmethod
    def normalize_confirmation_token(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Confirmation token is required")
        return normalized


class PaymentDecisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(default=None, max_length=1000)

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        if any(ord(character) < 32 or ord(character) == 127 for character in normalized):
            raise ValueError("Decision reason contains unsupported characters")
        return normalized


class ClaimRegistrationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    registration_reference: str = Field(min_length=4, max_length=40)
    claim_code: str = Field(min_length=6, max_length=32)

    @field_validator("registration_reference")
    @classmethod
    def normalize_registration_reference(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not normalized:
            raise ValueError("Registration reference is required")
        return normalized

    @field_validator("claim_code")
    @classmethod
    def normalize_claim_code(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not normalized or not normalized.isalnum():
            raise ValueError("Claim code is invalid")
        return normalized
