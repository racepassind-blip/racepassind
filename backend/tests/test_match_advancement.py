from __future__ import annotations

import unittest
from uuid import UUID, uuid4

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.api.v1.events import create_event
from app.schemas.events import OrganizerEventCreateV1
from app.schemas.matches import MatchIn
from app.schemas.registrations import RegistrationCreateIn
from app.services import match_service
from app.services.registration_service import create_guest_registration
from db import Base
from models import Court, Event, Match, Organization, TournamentRound, User


class MatchAdvancementTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        organization = Organization(name="Bracket Club", status="active", allow_direct_upi=True)
        self.user = User(
            name="Organizer",
            email=f"{uuid4()}@example.test",
            password_hash="test",
            role="admin",
            is_active=True,
        )
        self.db.add_all([organization, self.user])
        self.db.flush()
        created = create_event(
            OrganizerEventCreateV1.model_validate(
                {
                    "organization_id": organization.id,
                    "name": "Automatic bracket test",
                    "description": "Test event",
                    "sport": "badminton",
                    "event_date": "2026-10-10",
                    "location_name": "Sports hall",
                    "max_participants": 16,
                    "field_config": {
                        "fields": [
                            {"id": "full_name", "label": "Full name", "type": "text", "required": True},
                            {"id": "email", "label": "Email", "type": "email", "required": True},
                        ]
                    },
                    "categories": [
                        {
                            "name": "Open",
                            "tickets": [{"name": "Entry", "price_rupees": "0", "quantity": 16}],
                        }
                    ],
                }
            ),
            user=self.user,
            db=self.db,
            storage=None,
        )
        self.event = self.db.get(Event, UUID(created["id"]))
        self.event.status = "published"
        self.event.features_unlocked = True
        self.court = Court(event_id=self.event.id, name="Court 1")
        self.semifinal = TournamentRound(
            event_id=self.event.id,
            category_id=self.event.categories[0].id,
            name="Semifinal",
            position=0,
        )
        self.final = TournamentRound(
            event_id=self.event.id,
            category_id=self.event.categories[0].id,
            name="Final",
            position=1,
        )
        self.db.add_all([self.court, self.semifinal, self.final])
        self.db.commit()
        self.entries = [self._register(f"Player {index}") for index in range(1, 5)]

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()

    def _register(self, name: str):
        registration = create_guest_registration(
            self.db,
            RegistrationCreateIn(
                event_id=self.event.id,
                ticket_id=self.event.categories[0].tickets[0].id,
                full_name=name,
                email=f"{uuid4()}@example.test",
            ),
            idempotency_key=str(uuid4()),
        )[0]
        return registration

    def _payload(self, left, right, *, status="scheduled", winner=None) -> MatchIn:
        return MatchIn(
            category_id=self.event.categories[0].id,
            entry_a_registration_id=left.id,
            entry_b_registration_id=right.id,
            court_id=self.court.id,
            round_id=self.semifinal.id,
            round_label=self.semifinal.name,
            status=status,
            winner=winner,
            auto_advance=True,
            games=[{"game_number": 1, "score_a": 21, "score_b": 10}] if status == "completed" else None,
        )

    def test_pair_completion_creates_one_next_round_match_and_retry_is_idempotent(self) -> None:
        first = match_service.create_match(
            self.db, self.user, self.event, self._payload(self.entries[0], self.entries[1])
        )
        second = match_service.create_match(
            self.db, self.user, self.event, self._payload(self.entries[2], self.entries[3])
        )

        match_service.update_match(
            self.db,
            self.user,
            self.event,
            UUID(first["id"]),
            self._payload(self.entries[0], self.entries[1], status="completed", winner="entry_a"),
        )
        self.assertEqual(self.db.scalar(select(Match).where(Match.round_id == self.final.id)), None)

        completed_second = match_service.update_match(
            self.db,
            self.user,
            self.event,
            UUID(second["id"]),
            self._payload(self.entries[2], self.entries[3], status="completed", winner="entry_b"),
        )
        final_matches = list(self.db.scalars(select(Match).where(Match.round_id == self.final.id)).all())
        self.assertEqual(len(final_matches), 1)
        final_match = final_matches[0]
        self.assertEqual(final_match.entry_a_registration_id, self.entries[0].id)
        self.assertEqual(final_match.entry_b_registration_id, self.entries[3].id)
        self.assertEqual(final_match.bracket_position, 0)
        self.assertEqual(completed_second["nextMatchId"], str(final_match.id))

        match_service.update_match(
            self.db,
            self.user,
            self.event,
            UUID(second["id"]),
            self._payload(self.entries[2], self.entries[3], status="completed", winner="entry_b"),
        )
        self.assertEqual(len(list(self.db.scalars(select(Match).where(Match.round_id == self.final.id)).all())), 1)

    def test_advanced_winner_cannot_be_changed_while_next_match_exists(self) -> None:
        first = match_service.create_match(
            self.db, self.user, self.event, self._payload(self.entries[0], self.entries[1], status="completed", winner="entry_a")
        )
        match_service.create_match(
            self.db, self.user, self.event, self._payload(self.entries[2], self.entries[3], status="completed", winner="entry_a")
        )

        with self.assertRaisesRegex(match_service.MatchValidationError, "already advanced"):
            match_service.update_match(
                self.db,
                self.user,
                self.event,
                UUID(first["id"]),
                self._payload(self.entries[0], self.entries[1], status="completed", winner="entry_b"),
            )

    def test_public_results_require_approval_and_result_edits_unpublish(self) -> None:
        payload = self._payload(
            self.entries[0], self.entries[1], status="completed", winner="entry_a"
        ).model_copy(update={"auto_advance": False})
        created = match_service.create_match(self.db, self.user, self.event, payload)
        match_id = UUID(created["id"])

        self.assertEqual(match_service.list_public_match_results(self.db, self.event.id), [])
        approved = match_service.set_match_result_approval(
            self.db,
            self.event,
            match_id,
            approved=True,
            approved_by=self.user.id,
        )
        self.assertTrue(approved["resultApproved"])
        public = match_service.list_public_match_results(self.db, self.event.id)
        self.assertEqual(len(public), 1)
        self.assertEqual(public[0]["finalStatus"], "Final")
        self.assertEqual(public[0]["court"]["name"], "Court 1")

        edited_values = payload.model_dump()
        edited_values["games"] = [{"game_number": 1, "score_a": 21, "score_b": 12}]
        edited = MatchIn.model_validate(edited_values)
        updated = match_service.update_match(self.db, self.user, self.event, match_id, edited)
        self.assertFalse(updated["resultApproved"])
        self.assertEqual(match_service.list_public_match_results(self.db, self.event.id), [])


if __name__ == "__main__":
    unittest.main()
