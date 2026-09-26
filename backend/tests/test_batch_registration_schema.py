from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.registrations import BatchRegistrationCreateIn


def entry(ticket_id, members=1):
    return {
        "ticket_id": ticket_id,
        "email": "participant@example.com",
        "participants": [
            {"responses": {"full_name": f"Participant {index}"}}
            for index in range(members)
        ],
    }


def test_multi_category_order_with_15_entries_and_24_participants():
    entries = [
        entry(ticket_id, members)
        for ticket_id, members in [(uuid4(), size) for size in [1, 1, 2, 2, 2]]
        for _ in range(3)
    ]
    payload = BatchRegistrationCreateIn(event_id=uuid4(), entries=entries)
    assert len(payload.effective_entries) == 15
    assert sum(len(item.participants) for item in payload.effective_entries) == 24


@pytest.mark.parametrize("field", ["entries", "riders"])
def test_limit_applies_per_ticket_type(field):
    def item(ticket_id):
        if field == "entries":
            return entry(ticket_id)
        return {
            "ticket_id": ticket_id,
            "responses": {"full_name": "Participant", "email": "participant@example.com"},
        }

    first, second = uuid4(), uuid4()
    items = [item(first) for _ in range(10)] + [item(second) for _ in range(5)]
    payload = BatchRegistrationCreateIn(event_id=uuid4(), **{field: items})
    assert len(payload.effective_entries) == 15
    with pytest.raises(ValidationError, match="At most 10 entries per ticket type"):
        BatchRegistrationCreateIn(event_id=uuid4(), **{field: [item(first) for _ in range(11)]})


def test_empty_batch_is_rejected():
    with pytest.raises(ValidationError):
        BatchRegistrationCreateIn(event_id=uuid4(), entries=[])


@pytest.mark.parametrize("field", ["entries", "riders"])
@pytest.mark.parametrize("count", [16, 20])
def test_transaction_limit_rejects_oversized_orders(field, count):
    items = [
        entry(uuid4()) if field == "entries" else {
            "ticket_id": uuid4(),
            "responses": {"full_name": "Participant", "email": "participant@example.com"},
        }
        for _ in range(count)
    ]
    with pytest.raises(ValidationError, match="at most 15 items"):
        BatchRegistrationCreateIn(event_id=uuid4(), **{field: items})
