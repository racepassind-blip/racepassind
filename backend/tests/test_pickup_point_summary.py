"""Tests for the organizer pickup-point operational summary.

``pickup_point_summary`` aggregates pickup selections across ALL of an event's
registrations (the registrations table is cursor-paginated, so the summary must
not be derived from a single page). Counts are PER PARTICIPANT, and only the
event's own configured points are returned (event isolation).
"""
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.services.registration_service import pickup_point_summary
from db import Base
from models import (
    Event, EventCategory, Organization, Participant, Registration,
    RegistrationParticipant, Ticket, User,
)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def _event(db, points, *, enabled=True, required=False):
    org = Organization(name="Org", status="active")
    admin = User(name="Admin", email=f"{uuid4()}@t.test", password_hash="x", role="admin", is_active=True)
    db.add_all([org, admin])
    db.flush()
    event = Event(
        organization_id=org.id, name="Trek", description="d", category="trekking",
        location_name="Base", max_participants=100, status="published", distance="trekking",
        rules=[], field_config={"pickup_points": {"enabled": enabled, "required": required, "points": points}},
    )
    db.add(event)
    db.flush()
    category = EventCategory(event_id=event.id, name="Open", distance="12 KM", entry_type="singles")
    db.add(category)
    db.flush()
    ticket = Ticket(event_id=event.id, category_id=category.id, name="Entry", description="", price=0,
                    currency="INR", quantity_total=100, quantity_sold=0, quantity_reserved=0, is_active=True)
    db.add(ticket)
    db.flush()
    return event, admin, ticket, category


def _register(db, event, ticket, category, member_pickups, *, status="confirmed"):
    """Create a registration with one membership per entry in member_pickups."""
    participants = []
    for _ in member_pickups:
        p = Participant(name="P")
        db.add(p)
        participants.append(p)
    db.flush()
    primary_responses = {"pickup_point_id": member_pickups[0]} if member_pickups[0] else {}
    registration = Registration(
        event_id=event.id, participant_id=participants[0].id, ticket_id=ticket.id,
        category_id=category.id, status=status, payment_status="not_required",
        quantity=1, participant_count=len(participants), responses=primary_responses,
        registration_reference=f"SPE-{uuid4().hex[:8].upper()}",
    )
    db.add(registration)
    db.flush()
    for index, (participant, pickup) in enumerate(zip(participants, member_pickups), start=1):
        responses = {"pickup_point_id": pickup} if pickup else {}
        db.add(RegistrationParticipant(
            registration_id=registration.id, participant_id=participant.id,
            participant_index=index, responses=responses,
        ))
    db.flush()
    return registration


POINTS = [{"id": "p1", "name": "Mysuru Palace"}, {"id": "p2", "name": "Hootagalli"}]


def _count(summary, point_id):
    return next(entry["count"] for entry in summary["points"] if entry["id"] == point_id)


def test_summary_counts_participants_not_registrations(db):
    event, admin, ticket, category = _event(db, POINTS)
    # One single registration at p1, one team registration with two members at p1 and p2.
    _register(db, event, ticket, category, ["p1"])
    _register(db, event, ticket, category, ["p1", "p2"])
    db.commit()
    summary = pickup_point_summary(db, admin, event.id)
    assert summary["enabled"] is True
    assert _count(summary, "p1") == 2   # two participants chose p1
    assert _count(summary, "p2") == 1
    assert summary["unassignedParticipants"] == 0


def test_summary_tracks_unassigned_participants(db):
    event, admin, ticket, category = _event(db, POINTS)
    _register(db, event, ticket, category, ["p1"])
    _register(db, event, ticket, category, [None])  # no selection
    db.commit()
    summary = pickup_point_summary(db, admin, event.id)
    assert _count(summary, "p1") == 1
    assert summary["unassignedParticipants"] == 1


def test_summary_excludes_dead_registrations(db):
    event, admin, ticket, category = _event(db, POINTS)
    _register(db, event, ticket, category, ["p1"])
    _register(db, event, ticket, category, ["p1"], status="rejected")
    _register(db, event, ticket, category, ["p2"], status="expired")
    db.commit()
    summary = pickup_point_summary(db, admin, event.id, status_filter="confirmed")
    assert _count(summary, "p1") == 1
    assert _count(summary, "p2") == 0


def test_summary_is_event_isolated(db):
    event_a, admin, ticket_a, category_a = _event(db, POINTS)
    event_b, _, ticket_b, category_b = _event(db, [{"id": "b1", "name": "Hebbal"}])
    _register(db, event_a, ticket_a, category_a, ["p1"])
    _register(db, event_b, ticket_b, category_b, ["b1"])
    db.commit()
    summary_a = pickup_point_summary(db, admin, event_a.id)
    # Event A only ever reports its own points.
    assert {entry["id"] for entry in summary_a["points"]} == {"p1", "p2"}
    assert _count(summary_a, "p1") == 1


def test_summary_empty_when_disabled(db):
    event, admin, ticket, category = _event(db, POINTS, enabled=False)
    _register(db, event, ticket, category, ["p1"])
    db.commit()
    summary = pickup_point_summary(db, admin, event.id)
    assert summary["enabled"] is False
    assert all(entry["count"] == 0 for entry in summary["points"])
