"""Pydantic schemas for the allocation number module.

This module provides schemas for the generalized allocation number feature
that works across all sports (running, cycling, badminton, etc.).
"""

from __future__ import annotations

import datetime as dt
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.services.audit_service import safe_audit_metadata


class AllocationStatus(str):
    """Enum for allocation status values."""

    UNASSIGNED = "unassigned"
    DRAFT = "draft"
    PUBLISHED = "published"


class RegistrationAllocation(BaseModel):
    """Allocation info for a single registration."""

    allocation_number: int | None = None
    allocation_status: str = "unassigned"
    allocation_assigned_at: dt.datetime | None = None
    allocation_updated_at: dt.datetime | None = None


class RegistrationWithAllocation(BaseModel):
    """Registration with allocation details and participant info."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    registration_reference: str
    status: str
    participant_name: str
    participant_email: str | None = None
    participant_phone: str | None = None
    category_name: str | None = None
    ticket_name: str
    team_name: str | None = None
    gender: str | None = None
    age: int | None = None
    allocation_number: int | None = None
    allocation_status: str = "unassigned"
    allocation_assigned_at: dt.datetime | None = None
    allocation_updated_at: dt.datetime | None = None
    created_at: dt.datetime


class AllocationAssignment(BaseModel):
    """A single explicit registration -> number assignment."""

    registration_id: UUID
    allocation_number: int = Field(ge=1)


class AllocationBatchRequest(BaseModel):
    """Request to allocate numbers for a batch of registrations.

    The frontend builds an explicit, ordered list of assignments after
    previewing (and optionally reordering) the filtered participants. This
    keeps the batch scoped exactly to what the organizer saw in the preview,
    rather than silently processing every unassigned registration.
    """

    assignments: list[AllocationAssignment] = Field(default_factory=list, max_length=100000)


class AllocationBatchResult(BaseModel):
    """Result of a batch allocation operation."""

    total_processed: int
    assigned: int
    skipped: int
    errors: list[str]


class IndividualAllocationUpdate(BaseModel):
    """Request to update a single registration's allocation."""

    allocation_number: int = Field(ge=1)
    notify_participant: bool = False


class AllocationHistoryEntry(BaseModel):
    """History entry for an allocation change."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    registration_id: UUID
    registration_reference: str
    old_number: int | None
    new_number: int | None
    changed_by_user_id: UUID
    changed_by_user_name: str | None
    changed_at: dt.datetime


class AllocationSummary(BaseModel):
    """Summary of allocation status per category."""

    category_id: UUID
    category_name: str
    total_registrations: int
    unassigned: int
    draft: int
    published: int


class PublishRequest(BaseModel):
    """Request to publish allocations."""

    notify_participants: bool = False


class PublishResult(BaseModel):
    """Result of the publish operation."""

    total_published: int
    previous_published_count: int
    notify_sent: bool


class EditNumberRequest(BaseModel):
    """Request to edit a number after publish."""

    new_number: int = Field(ge=1)
    notify_participant: bool = False


class SportAllocationConfig(BaseModel):
    """Allocation configuration for a sport."""

    number_enabled: bool
    number_label: str
    scope: str  # "individual" or "team_member"


# Export models for schema registration
__all__ = [
    "RegistrationAllocation",
    "RegistrationWithAllocation",
    "AllocationAssignment",
    "AllocationBatchRequest",
    "AllocationBatchResult",
    "IndividualAllocationUpdate",
    "AllocationHistoryEntry",
    "AllocationSummary",
    "PublishRequest",
    "PublishResult",
    "EditNumberRequest",
    "SportAllocationConfig",
]
