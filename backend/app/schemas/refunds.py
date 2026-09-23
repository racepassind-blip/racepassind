"""Pydantic schemas for the refund management API."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator


class RefundRequestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refund_reason: str = Field(min_length=1, max_length=120)
    participant_comments: str | None = Field(default=None, max_length=1000)

    @field_validator("refund_reason")
    @classmethod
    def normalize_reason(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Refund reason is required")
        return v

    @field_validator("participant_comments")
    @classmethod
    def normalize_comments(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None


class RefundDecisionIn(BaseModel):
    """Organizer approves or rejects a refund request."""
    model_config = ConfigDict(extra="forbid")

    decision: str  # "approve" | "reject"
    approved_amount_paise: int | None = Field(default=None, ge=0)
    organizer_comments: str | None = Field(default=None, max_length=1000)

    @field_validator("decision")
    @classmethod
    def validate_decision(cls, v: str) -> str:
        if v not in ("approve", "reject"):
            raise ValueError("Decision must be 'approve' or 'reject'")
        return v

    @field_validator("organizer_comments")
    @classmethod
    def normalize_comments(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return v.strip() or None


class RefundMarkSentIn(BaseModel):
    """Organizer marks Direct UPI refund as sent with UTR."""
    model_config = ConfigDict(extra="forbid")

    refund_utr: str = Field(min_length=1, max_length=120)
    actual_amount_paise: int | None = Field(default=None, ge=0)
    organizer_comments: str | None = Field(default=None, max_length=1000)
    refund_proof_url: str | None = Field(default=None, max_length=2000)

    @field_validator("refund_utr")
    @classmethod
    def normalize_utr(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("UTR / transaction reference is required")
        return v


class ManualRefundCreateIn(BaseModel):
    """Organizer creates a manual refund record (no registration required).

    is_manual_refund is always True for this flow.
    These records are excluded from earnings/billing calculations.
    If registration_id is provided the refund is linked to that registration
    for tracking purposes but still flagged as organizer-created.
    """
    model_config = ConfigDict(extra="forbid")

    event_id: str = Field(min_length=1)
    registration_id: str | None = Field(default=None)
    participant_name: str = Field(min_length=1, max_length=200)
    participant_contact: str | None = Field(default=None, max_length=200)
    amount_paise: int = Field(gt=0, description="Refund amount in paise")
    refund_reason: str = Field(min_length=1, max_length=120)
    notes: str | None = Field(default=None, max_length=1000)
    # Optional — organizer can enter UTR immediately if already sent
    refund_utr: str | None = Field(default=None, max_length=120)

    @field_validator("participant_name", "refund_reason")
    @classmethod
    def strip_required(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("This field is required")
        return v

    @field_validator("participant_contact", "notes", "refund_utr")
    @classmethod
    def strip_optional(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return v.strip() or None
