from __future__ import annotations

import datetime as dt
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.events import OrganizerEventCreateV1
from app.services.ticket_pdf_service import _event_schedule


def _event_payload(**overrides):
    payload = {
        "organization_id": uuid4(),
        "name": "Weekend Badminton Open",
        "description": "A two-day community tournament.",
        "sport": "badminton",
        "event_date": "2026-10-10",
        "event_end_date": "2026-10-11",
        "location_name": "Community Sports Hall",
        "max_participants": 100,
        "schedule": [
            {"date": "2026-10-10", "time": "08:00", "label": "Check-in"},
            {"date": "2026-10-11", "time": "09:00", "label": "Finals"},
        ],
        "categories": [
            {
                "name": "Open",
                "entry_type": "singles",
                "tickets": [{"name": "Regular", "price_rupees": "500.00", "quantity": 100}],
            }
        ],
    }
    payload.update(overrides)
    return payload


def test_multiday_event_accepts_schedule_items_for_each_event_day():
    event = OrganizerEventCreateV1.model_validate(_event_payload())

    assert event.event_date == dt.date(2026, 10, 10)
    assert event.event_end_date == dt.date(2026, 10, 11)
    assert [item.date for item in event.schedule] == [dt.date(2026, 10, 10), dt.date(2026, 10, 11)]
    assert event.schedule[0].model_dump(mode="json") == {
        "date": "2026-10-10",
        "time": "08:00",
        "label": "Check-in",
    }


def test_event_end_date_cannot_be_before_start_date():
    with pytest.raises(ValidationError, match="event_end_date must be on or after event_date"):
        OrganizerEventCreateV1.model_validate(_event_payload(event_end_date="2026-10-09"))


def test_schedule_date_must_be_inside_event_range():
    with pytest.raises(ValidationError, match="Schedule item dates must fall within the event date range"):
        OrganizerEventCreateV1.model_validate(
            _event_payload(schedule=[{"date": "2026-10-12", "time": "09:00", "label": "Finals"}])
        )


def test_legacy_schedule_without_date_remains_valid():
    event = OrganizerEventCreateV1.model_validate(
        _event_payload(event_end_date=None, schedule=[{"time": "08:00", "label": "Check-in"}])
    )

    assert event.schedule[0].date is None


def test_multiday_ticket_uses_date_range_without_midnight_times():
    event = SimpleNamespace(
        start_date=dt.datetime(2026, 10, 10),
        end_date=dt.datetime(2026, 10, 11),
        date="2026-10-10",
    )

    assert _event_schedule(event) == "10 Oct 2026 – 11 Oct 2026"
