from __future__ import annotations

import unittest
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.api.v1.events import create_event, update_tournament_format
from app.api.v1.matches import post_match
from app.schemas.events import OrganizerEventCreateV1, TournamentFormatIn
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
            games=[{"game_number": number, "score_a": 10 if winner == "entry_b" else 21,
                "score_b": 21 if winner == "entry_b" else 10} for number in (1, 2)] if status == "completed" else None,
        )

    def _completed_opening_match(self, left, right, winner="entry_a") -> dict:
        return match_service.create_match(
            self.db,
            self.user,
            self.event,
            self._payload(left, right, status="completed", winner=winner).model_copy(update={"auto_advance": False}),
        )

    def _later_payload(self, left, right, round_item=None) -> MatchIn:
        target = round_item or self.final
        return self._payload(left, right).model_copy(update={
            "round_id": target.id,
            "round_label": target.name,
            "auto_advance": False,
        })

    def test_knockout_loser_cannot_be_created_in_next_round(self) -> None:
        self._completed_opening_match(self.entries[0], self.entries[1], winner="entry_a")
        with self.assertRaisesRegex(match_service.MatchValidationError, "lost an earlier knockout match"):
            match_service.create_match(
                self.db, self.user, self.event, self._later_payload(self.entries[1], self.entries[0])
            )

    def test_knockout_loser_cannot_skip_into_round_three(self) -> None:
        championship = TournamentRound(
            event_id=self.event.id,
            category_id=self.event.categories[0].id,
            name="Championship",
            position=2,
        )
        self.db.add(championship)
        self.db.commit()
        self._completed_opening_match(self.entries[0], self.entries[1], winner="entry_a")
        self._completed_opening_match(self.entries[2], self.entries[3], winner="entry_a")
        middle = match_service.create_match(
            self.db, self.user, self.event, self._later_payload(self.entries[0], self.entries[2])
        )
        completed_middle = MatchIn.model_validate({
            **self._later_payload(self.entries[0], self.entries[2]).model_dump(),
            "status": "completed",
            "winner": "entry_b",
            "games": [
                {"game_number": 1, "score_a": 10, "score_b": 21},
                {"game_number": 2, "score_a": 12, "score_b": 21},
            ],
        })
        match_service.update_match(
            self.db,
            self.user,
            self.event,
            UUID(middle["id"]),
            completed_middle,
        )
        with self.assertRaisesRegex(match_service.MatchValidationError, "lost an earlier knockout match"):
            match_service.create_match(
                self.db, self.user, self.event, self._later_payload(self.entries[1], self.entries[2], championship)
            )

    def test_knockout_previous_round_winners_can_be_created_in_next_round(self) -> None:
        self._completed_opening_match(self.entries[0], self.entries[1], winner="entry_a")
        self._completed_opening_match(self.entries[2], self.entries[3], winner="entry_a")
        created = match_service.create_match(
            self.db, self.user, self.event, self._later_payload(self.entries[0], self.entries[2])
        )
        self.assertEqual(created["entryA"]["registrationId"], str(self.entries[0].id))
        self.assertEqual(created["entryB"]["registrationId"], str(self.entries[2].id))

    def test_knockout_missing_previous_match_is_not_a_bye(self) -> None:
        self._completed_opening_match(self.entries[0], self.entries[1], winner="entry_a")
        with self.assertRaisesRegex(match_service.MatchValidationError, "missing matches are not byes"):
            match_service.create_match(
                self.db, self.user, self.event, self._later_payload(self.entries[0], self.entries[2])
            )

    def test_league_entries_are_not_subject_to_knockout_eligibility(self) -> None:
        self._set_format("league")
        self._completed_opening_match(self.entries[0], self.entries[1], winner="entry_a")
        created = match_service.create_match(
            self.db, self.user, self.event, self._later_payload(self.entries[1], self.entries[2])
        )
        self.assertEqual(created["roundId"], str(self.final.id))

    def test_direct_api_cannot_insert_an_eliminated_entry(self) -> None:
        self._completed_opening_match(self.entries[0], self.entries[1], winner="entry_a")
        with self.assertRaises(HTTPException) as raised:
            post_match(
                self.event.id,
                self._later_payload(self.entries[1], self.entries[0]),
                user=self.user,
                _=None,
                db=self.db,
            )
        self.assertEqual(raised.exception.status_code, 422)
        self.assertIn("lost an earlier knockout match", raised.exception.detail)

    def test_direct_api_cannot_bypass_knockout_round_with_missing_round_id(self) -> None:
        self._completed_opening_match(self.entries[0], self.entries[1], winner="entry_a")
        payload = self._later_payload(self.entries[1], self.entries[0]).model_copy(
            update={"round_id": None, "round_label": "Final"}
        )
        with self.assertRaises(HTTPException) as raised:
            post_match(
                self.event.id,
                payload,
                user=self.user,
                _=None,
                db=self.db,
            )
        self.assertEqual(raised.exception.status_code, 422)
        self.assertIn("configured knockout round is required", raised.exception.detail)

    def test_update_cannot_replace_a_qualified_entry_with_a_loser(self) -> None:
        self._completed_opening_match(self.entries[0], self.entries[1], winner="entry_a")
        self._completed_opening_match(self.entries[2], self.entries[3], winner="entry_a")
        final = match_service.create_match(
            self.db, self.user, self.event, self._later_payload(self.entries[0], self.entries[2])
        )
        with self.assertRaisesRegex(match_service.MatchValidationError, "lost an earlier knockout match"):
            match_service.update_match(
                self.db,
                self.user,
                self.event,
                UUID(final["id"]),
                self._later_payload(self.entries[1], self.entries[2]),
            )

    def test_scheduling_conflicts_and_adjacent_matches(self) -> None:
        import datetime as dt
        start = dt.datetime(2026, 10, 10, 10, tzinfo=dt.timezone.utc)
        first_payload = self._payload(self.entries[0], self.entries[1]).model_copy(update={"scheduled_time": start, "duration_minutes": 60})
        first = match_service.create_match(self.db, self.user, self.event, first_payload)
        overlapping = self._payload(self.entries[2], self.entries[3]).model_copy(update={"scheduled_time": start + dt.timedelta(minutes=30)})
        with self.assertRaisesRegex(match_service.MatchValidationError, "Court"):
            match_service.create_match(self.db, self.user, self.event, overlapping)
        self.db.rollback()
        adjacent = overlapping.model_copy(update={"scheduled_time": start + dt.timedelta(minutes=60)})
        match_service.create_match(self.db, self.user, self.event, adjacent)
        self.assertEqual([], match_service.scheduling_conflicts(self.db, self.event, first_payload, UUID(first["id"])))
        second_court = Court(event_id=self.event.id, name="Court 2")
        self.db.add(second_court)
        self.db.commit()
        player_overlap = first_payload.model_copy(update={"court_id": second_court.id})
        with self.assertRaisesRegex(match_service.MatchValidationError, "player/team"):
            match_service.create_match(self.db, self.user, self.event, player_overlap)
        self.db.rollback()
        with self.assertRaisesRegex(match_service.MatchValidationError, "Scheduling conflict"):
            match_service.update_match(self.db, self.user, self.event, UUID(first["id"]), first_payload.model_copy(update={"duration_minutes": 90}))
        self.db.rollback()

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

    def _set_format(self, tournament_format: str) -> None:
        update_tournament_format(self.event.id, TournamentFormatIn(tournament_format=tournament_format),
            user=self.user, _=None, db=self.db)

    def _assert_no_advancement(self) -> None:
        matches = list(self.db.scalars(select(Match).where(Match.event_id == self.event.id)).all())
        self.assertEqual(len(matches), 2)
        for match in matches:
            self.assertEqual(match.status, "completed")
            self.assertIsNone(match.next_match_id)
            self.assertIsNone(match.next_match_slot)
            self.assertEqual(match.round_id, self.semifinal.id)

    def test_league_ignores_old_auto_advance_flags(self) -> None:
        self._set_format("league")
        for offset in (0, 2):
            match_service.create_match(self.db, self.user, self.event,
                self._payload(self.entries[offset], self.entries[offset + 1], status="completed", winner="entry_a"))
        self._assert_no_advancement()

    def test_switch_to_league_before_completion_and_back_to_knockout(self) -> None:
        self._set_format("knockout")
        first = match_service.create_match(self.db, self.user, self.event,
            self._payload(self.entries[0], self.entries[1], status="completed", winner="entry_a"))
        second = match_service.create_match(self.db, self.user, self.event,
            self._payload(self.entries[2], self.entries[3]))
        self._set_format("league")
        completed = self._payload(self.entries[2], self.entries[3], status="completed", winner="entry_b")
        match_service.update_match(self.db, self.user, self.event, UUID(second["id"]), completed)
        self._assert_no_advancement()
        self._set_format("knockout")
        match_service.update_match(self.db, self.user, self.event, UUID(second["id"]), completed)
        finals = list(self.db.scalars(select(Match).where(Match.round_id == self.final.id)).all())
        self.assertEqual(len(finals), 1)
        self.assertEqual(finals[0].entry_a_registration_id, self.entries[0].id)
        self.assertEqual(finals[0].entry_b_registration_id, self.entries[3].id)
        self.assertEqual(self.db.get(Match, UUID(first["id"])).next_match_id, finals[0].id)

    def test_knockout_with_disabled_feeder_does_not_advance(self) -> None:
        self._set_format("knockout")
        for offset in (0, 2):
            payload = self._payload(self.entries[offset], self.entries[offset + 1], status="completed", winner="entry_a")
            # One disabled feeder must also stop its enabled partner advancing.
            payload = payload.model_copy(update={"auto_advance": offset != 0})
            match_service.create_match(self.db, self.user, self.event, payload)
        self._assert_no_advancement()

    def test_league_does_not_link_winners_to_existing_next_match(self) -> None:
        self._set_format("league")
        destination = match_service.create_match(self.db, self.user, self.event,
            self._payload(self.entries[0], self.entries[2]).model_copy(update={
                "round_id": self.final.id, "round_label": self.final.name,
            }))
        for offset in (0, 2):
            source = match_service.create_match(self.db, self.user, self.event,
                self._payload(self.entries[offset], self.entries[offset + 1], status="completed", winner="entry_a"))
            self.assertIsNone(source["nextMatchId"])
            self.assertIsNone(self.db.get(Match, UUID(source["id"])).next_match_slot)
        finals = list(self.db.scalars(select(Match).where(Match.round_id == self.final.id)).all())
        self.assertEqual(len(finals), 1)
        self.assertEqual(finals[0].id, UUID(destination["id"]))
        self.assertEqual(finals[0].entry_a_registration_id, self.entries[0].id)
        self.assertEqual(finals[0].entry_b_registration_id, self.entries[2].id)
        self.assertEqual(finals[0].status, "scheduled")

    def test_knockout_without_next_round_does_not_advance(self) -> None:
        self.db.delete(self.final)
        self.db.commit()
        for offset in (0, 2):
            match_service.create_match(self.db, self.user, self.event,
                self._payload(self.entries[offset], self.entries[offset + 1], status="completed", winner="entry_a"))
        self._assert_no_advancement()

    def test_legacy_event_without_format_keeps_knockout_advancement(self) -> None:
        self.event.field_config = {key: value for key, value in self.event.field_config.items() if key != "sport_config"}
        self.db.commit()
        self.test_pair_completion_creates_one_next_round_match_and_retry_is_idempotent()

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
        edited_values["games"] = [{"game_number": number, "score_a": 21, "score_b": 12} for number in (1, 2)]
        edited = MatchIn.model_validate(edited_values)
        updated = match_service.update_match(self.db, self.user, self.event, match_id, edited)
        self.assertFalse(updated["resultApproved"])
        self.assertEqual(match_service.list_public_match_results(self.db, self.event.id), [])


if __name__ == "__main__":
    unittest.main()
