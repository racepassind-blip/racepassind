from __future__ import annotations

import csv
import datetime as dt
import io
import unittest
import uuid

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

import app.services.registration_service as registration_service
from app.services.registration_service import (
    CsvExportTooLargeError,
    export_organizer_registrations_csv,
    list_organizer_registrations,
)
from db import Base
from models import (
    Event,
    EventCategory,
    Organization,
    OrganizationMember,
    Order,
    OrderItem,
    Participant,
    Payment,
    Registration,
    Ticket,
    User,
)


class OrganizerRegistrationManagementTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)

    def _user_and_org(self, db: Session, name: str) -> tuple[User, Organization]:
        user = User(
            name=name,
            email=f"{name.lower()}@example.test",
            normalized_email=f"{name.lower()}@example.test",
            password_hash="test-hash",
            role="organizer",
            is_active=True,
        )
        organization = Organization(name=f"{name} Events", status="active")
        db.add_all([user, organization])
        db.flush()
        db.add(OrganizationMember(organization_id=organization.id, user_id=user.id, member_role="organizer"))
        db.flush()
        return user, organization

    def _event(self, db: Session, organization: Organization, name: str = "Test 10K") -> tuple[Event, EventCategory, Ticket]:
        event = Event(
            organization=organization,
            name=name,
            description="Test event",
            category="running",
            location_name="Bengaluru",
            country="India",
            max_participants=100,
            status="published",
            start_date=dt.datetime(2026, 10, 10, tzinfo=dt.timezone.utc),
            distance="10 km",
            participants=0,
            rules=[],
        )
        db.add(event)
        db.flush()
        category = EventCategory(event_id=event.id, name="10K Open", distance="10 km", description="Open category")
        db.add(category)
        db.flush()
        ticket = Ticket(
            event_id=event.id,
            category_id=category.id,
            name="Early Bird",
            description="Race entry",
            price=10000,
            currency="INR",
            quantity_total=100,
            quantity_sold=0,
            quantity_reserved=0,
            is_active=True,
        )
        db.add(ticket)
        db.flush()
        return event, category, ticket

    def _registration(
        self,
        db: Session,
        *,
        event: Event,
        category: EventCategory,
        ticket: Ticket,
        index: int,
        status: str = "confirmed",
        payment_status: str = "approved",
        checked_in: bool = False,
        name: str | None = None,
    ) -> Registration:
        participant = Participant(
            name=name or f"Runner {index}",
            email=f"runner{index}@example.test",
            normalized_email=f"runner{index}@example.test",
            phone=f"+91999999{index:04d}",
            normalized_phone=f"91999999{index:04d}",
        )
        db.add(participant)
        db.flush()
        created_at = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc) + dt.timedelta(minutes=index)
        registration = Registration(
            event_id=event.id,
            participant_id=participant.id,
            ticket_id=ticket.id,
            category_id=category.id,
            status=status,
            payment_status=payment_status,
            quantity=1,
            unit_price_paise=10000,
            total_amount_paise=10000,
            registration_reference=f"RP-MGMT-{index:04d}",
            checked_in=checked_in,
            checked_in_at=created_at if checked_in else None,
            created_at=created_at,
            confirmation_token_hash=f"confirmation-hash-{index}",
            claim_code_hash=f"claim-hash-{index}",
            ticket_token_hash=f"ticket-hash-{index}",
        )
        db.add(registration)
        db.flush()
        order = Order(total_amount=100, total_amount_paise=10000, currency="INR", status="paid")
        db.add(order)
        db.flush()
        db.add(OrderItem(order_id=order.id, registration_id=registration.id, price=100))
        db.add(
            Payment(
                order_id=order.id,
                registration_id=registration.id,
                amount=100,
                expected_amount_paise=10000,
                method="manual_upi",
                currency="INR",
                payment_gateway="manual_upi",
                status=payment_status,
                utr_reference=f"UTR-{index}",
            )
        )
        db.flush()
        return registration

    def test_cursor_pagination_is_deterministic_and_scoped(self) -> None:
        with Session(self.engine) as db:
            organizer, organization = self._user_and_org(db, "Owner")
            other_user, other_organization = self._user_and_org(db, "Other")
            event, category, ticket = self._event(db, organization)
            other_event, other_category, other_ticket = self._event(db, other_organization, "Other 10K")
            for index in range(1, 4):
                self._registration(db, event=event, category=category, ticket=ticket, index=index)
            self._registration(db, event=other_event, category=other_category, ticket=other_ticket, index=10)
            db.commit()

            first = list_organizer_registrations(db, organizer, event_id=event.id, status_filter="all", page_size=2)
            self.assertEqual(len(first["items"]), 2)
            self.assertTrue(first["hasMore"])
            second = list_organizer_registrations(
                db,
                organizer,
                event_id=event.id,
                status_filter="all",
                page_size=2,
                cursor=first["nextCursor"],
            )
            self.assertEqual(len(second["items"]), 1)
            self.assertFalse(second["hasMore"])
            self.assertTrue(set(item["id"] for item in first["items"]).isdisjoint(item["id"] for item in second["items"]))
            self.assertEqual(list_organizer_registrations(db, other_user, event_id=event.id, status_filter="all")["items"], [])

    def test_filters_separate_payment_registration_and_checkin_state(self) -> None:
        with Session(self.engine) as db:
            organizer, organization = self._user_and_org(db, "FilterOwner")
            event, category, ticket = self._event(db, organization)
            self._registration(db, event=event, category=category, ticket=ticket, index=1, status="confirmed", payment_status="approved", checked_in=True)
            self._registration(db, event=event, category=category, ticket=ticket, index=2, status="rejected", payment_status="rejected")
            db.commit()

            checked_in = list_organizer_registrations(db, organizer, event_id=event.id, status_filter="all", check_in_status="checked_in")
            self.assertEqual([item["registrationReference"] for item in checked_in["items"]], ["RP-MGMT-0001"])
            rejected = list_organizer_registrations(db, organizer, event_id=event.id, status_filter="all", payment_status="rejected")
            self.assertEqual([item["registrationReference"] for item in rejected["items"]], ["RP-MGMT-0002"])
            by_email = list_organizer_registrations(db, organizer, event_id=event.id, status_filter="all", email_search="runner1@")
            self.assertEqual([item["registrationReference"] for item in by_email["items"]], ["RP-MGMT-0001"])

    def test_csv_has_exact_minimized_columns_and_formula_protection(self) -> None:
        with Session(self.engine) as db:
            organizer, organization = self._user_and_org(db, "CsvOwner")
            event, category, ticket = self._event(db, organization)
            self._registration(db, event=event, category=category, ticket=ticket, index=1, name="=Injected Name")
            db.commit()

            content = export_organizer_registrations_csv(db, organizer, event_id=event.id, status_filter="all")
            rows = list(csv.reader(io.StringIO(content)))
            self.assertEqual(rows[0], [
                "Registration reference", "Participant name", "Email", "Phone", "Race category", "Ticket",
                "Amount", "Payment status", "Registration status", "UTR", "Registration date", "Check-in status",
            ])
            self.assertEqual(rows[1][1], "'=Injected Name")
            self.assertEqual(rows[1][4], "10K Open")
            self.assertNotIn("confirmation-hash", content)
            self.assertNotIn("claim-hash", content)
            self.assertNotIn("ticket-hash", content)
            self.assertNotIn("internal", content.lower())

    def test_csv_requires_event_ownership_and_enforces_row_limit(self) -> None:
        with Session(self.engine) as db:
            organizer, organization = self._user_and_org(db, "CsvOwnerTwo")
            other_user, other_organization = self._user_and_org(db, "CsvOther")
            event, category, ticket = self._event(db, organization)
            other_event, other_category, other_ticket = self._event(db, other_organization, "Private 10K")
            self._registration(db, event=event, category=category, ticket=ticket, index=1)
            self._registration(db, event=other_event, category=other_category, ticket=other_ticket, index=2)
            db.commit()

            with self.assertRaises(ValueError):
                export_organizer_registrations_csv(db, organizer, event_id=other_event.id, status_filter="all")

            original_limit = registration_service._MAX_CSV_EXPORT_ROWS
            registration_service._MAX_CSV_EXPORT_ROWS = 1
            try:
                self._registration(db, event=event, category=category, ticket=ticket, index=3)
                db.commit()
                with self.assertRaises(CsvExportTooLargeError):
                    export_organizer_registrations_csv(db, organizer, event_id=event.id, status_filter="all")
            finally:
                registration_service._MAX_CSV_EXPORT_ROWS = original_limit
            self.assertIsNotNone(other_user)


if __name__ == "__main__":
    unittest.main()
