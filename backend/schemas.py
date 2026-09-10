from __future__ import annotations

import datetime as dt
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class TicketTierOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    price: int
    description: str
    available: int


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    date: str
    location: str
    category: str
    image: str
    description: str
    distance: str
    participants: int
    maxParticipants: int
    organizer: str
    rules: list[str]
    tiers: list[TicketTierOut]


class OrganizerTicketIn(BaseModel):
    name: str
    price: int
    quantity: int
    saleStart: dt.datetime | None = None
    saleEnd: dt.datetime | None = None


class OrganizerEventCreateIn(BaseModel):
    name: str
    description: str = ""
    category: str
    location: str
    eventDate: dt.date
    bannerUrl: str | None = None
    distance: str = "TBD"
    maxParticipants: int = 1000
    rules: list[str] = []
    tickets: list[OrganizerTicketIn]
