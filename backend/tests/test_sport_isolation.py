"""Cross-sport regression coverage using real schemas, services and SQLite storage."""
from dataclasses import FrozenInstanceError, replace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.sports.base import SportAdapter
from app.sports.registry import SportAdapterRegistry, get_adapter, registry
from app.sports import running, cycling
from app.api.deps import require_tournament_capable
from app.api.v1.events import create_event, update_event, update_tournament_format, _event_response
from app.schemas.events import OrganizerEventCreateV1, OrganizerEventUpdateV1, TournamentFormatIn
from app.schemas.matches import MatchIn, ScoringConfigIn
from app.schemas.race_results import RaceResultBulkSaveIn
from app.schemas.registrations import RegistrationCreateIn
from app.services.registration_service import create_guest_registration
from app.services import match_service, race_result_service
from db import Base
from models import Event, Organization, User, Court, Match, Participant, RegistrationParticipant, TeamMatchScoring


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def make_event(db, sport, quantity=10, sport_config=None):
    organization = Organization(name="Isolation test", status="active", allow_direct_upi=True)
    user = User(name="Admin", email=f"{uuid4()}@example.test", password_hash="test", role="admin", is_active=True)
    db.add_all([organization, user])
    db.flush()
    payload = dict(organization_id=organization.id, name="Sport isolation event",
        description="Test event", sport=sport, event_date="2026-10-10",
        location_name="Sports hall", max_participants=100,
        field_config={"fields": [
            {"id": "full_name", "label": "Full name", "type": "text", "required": True},
            {"id": "email", "label": "Email", "type": "email", "required": True}]},
        sport_config=sport_config or {},
        categories=[dict(name="Open", distance="5 KM" if get_adapter(sport).supports_distance else None,
            tickets=[dict(name="Regular", price_rupees="0", quantity=quantity)])])
    out = create_event(OrganizerEventCreateV1.model_validate(payload), user=user, db=db, storage=None)
    event = db.get(Event, UUID(out["id"]))
    event.status = "published"
    event.features_unlocked = True
    db.commit()
    return event, user, payload


def register(db, event, name="Player"):
    return create_guest_registration(db, RegistrationCreateIn(
        event_id=event.id, ticket_id=event.categories[0].tickets[0].id,
        full_name=name, email=f"{uuid4()}@example.test"), idempotency_key=str(uuid4()))[0]


@pytest.mark.parametrize("sport", ["badminton", "table_tennis", "running", "cycling", "hiking", "tennis", "squash", "triathlon", "swimming", "walkathon", "obstacle_course"])
def test_adapter_contract_and_event_registration_roundtrip(db, sport):
    adapter = get_adapter(sport)
    assert isinstance(adapter, SportAdapter)
    assert adapter.number_label
    with pytest.raises(FrozenInstanceError):
        adapter.key = "changed"
    event, user, payload = make_event(db, sport)
    registration = register(db, event)
    assert registration.event_id == event.id
    assert registration.status == "confirmed"
    assert event.categories[0].tickets[0].quantity_sold == 1
    # Update validation and organizer serialization work without a new config column.
    payload.pop("organization_id")
    payload["categories"][0]["id"] = event.categories[0].id
    payload["categories"][0]["tickets"][0]["id"] = event.categories[0].tickets[0].id
    payload["name"] = "Edited isolation event"
    updated = update_event(event.id, OrganizerEventUpdateV1.model_validate(payload), user=user, db=db, storage=None)
    assert updated["name"] == "Edited isolation event"
    db.expire_all()
    assert _event_response(db.get(Event, event.id))["sport"] == sport


@pytest.mark.parametrize("alias,key", [("Table Tennis", "table_tennis"), ("table-tennis", "table_tennis"), (" Trekking ", "hiking")])
def test_legacy_aliases(alias, key):
    assert get_adapter(alias) is get_adapter(key)


def test_register_new_adapter_does_not_modify_existing_policies():
    local = SportAdapterRegistry()
    local.register(get_adapter("badminton"))
    before = local.get_adapter("badminton")
    custom = SportAdapter(key="new_sport", distance_required=False, team_tournament=False)
    local.register(custom, "new-sport-alias")
    assert local.get_adapter("new sport alias") is custom
    assert local.get_adapter("badminton") is before
    assert local.get_adapter("unknown").key == "legacy"
    with pytest.raises(ValueError):
        local.register(custom)


def test_old_unknown_events_still_serialize(db):
    event, _, _ = make_event(db, "legacy_activity")
    assert _event_response(event)["sport"] == "legacy_activity"
    assert get_adapter(None).result_type == "none"


def test_cricket_setup_round_trips_and_isolated_from_race_logic(db):
    config = {
        "tournament_format": "league_knockout",
        "ball_type": "leather",
        "overs_per_innings": 20,
        "minimum_players": 11,
        "maximum_players": 15,
    }
    event, user, payload = make_event(db, "cricket", sport_config=config)
    assert get_adapter("cricket").supports_distance is False
    assert get_adapter("cricket").supports_tournament is True
    assert get_adapter("cricket").result_type == "none"
    assert _event_response(event)["sportConfig"] == config
    payload.pop("organization_id")
    payload["categories"][0]["id"] = event.categories[0].id
    payload["categories"][0]["tickets"][0]["id"] = event.categories[0].tickets[0].id
    payload["sport_config"] = {**config, "overs_per_innings": 10}
    updated = update_event(event.id, OrganizerEventUpdateV1.model_validate(payload), user=user, db=db, storage=None)
    assert updated["sportConfig"]["overs_per_innings"] == 10
    payload.pop("sport_config")
    updated = update_event(event.id, OrganizerEventUpdateV1.model_validate(payload), user=user, db=db, storage=None)
    assert updated["sportConfig"] == {**config, "overs_per_innings": 10}
    assert get_adapter("cricket") is not get_adapter("badminton")


@pytest.mark.parametrize("invalid", [
    {"overs_per_innings": 0},
    {"minimum_players": 0},
    {"minimum_players": 16, "maximum_players": 15},
])
def test_cricket_setup_validation(invalid):
    with pytest.raises(ValueError):
        OrganizerEventCreateV1.model_validate({
            "organization_id": uuid4(), "name": "Cricket", "description": "Test", "sport": "cricket",
            "event_date": "2026-10-10", "location_name": "Ground", "max_participants": 100,
            "sport_config": invalid,
            "categories": [{"name": "Open", "tickets": [{"name": "Entry", "price_rupees": 0, "quantity": 1}]}],
        })


def test_badminton_config_changes_do_not_change_table_tennis(db):
    badminton, _, _ = make_event(db, "badminton")
    table, _, _ = make_event(db, "table-tennis")
    match_service.update_scoring_config(db, badminton, badminton.categories[0].id,
        ScoringConfigIn(games_to_win=3, points_per_game=15))
    assert match_service.list_scoring_configs(db, table)[0]["pointsPerGame"] == 11
    assert match_service.list_scoring_configs(db, table)[0]["gamesToWin"] == 2
    # Legacy persisted table-tennis settings are authoritative, even if they used 21.
    match_service.update_scoring_config(db, table, table.categories[0].id,
        ScoringConfigIn(games_to_win=2, points_per_game=21))
    db.expire_all()
    assert match_service.list_scoring_configs(db, table)[0]["pointsPerGame"] == 21
    assert match_service.list_scoring_configs(db, badminton)[0]["pointsPerGame"] == 15


@pytest.mark.parametrize("tournament_format", ["league", "knockout"])
@pytest.mark.parametrize("submitted_config", [None, {}, {"tournament_format": "knockout"}, {"tournament_format": "league"}])
def test_badminton_format_survives_general_edits(db, tournament_format, submitted_config):
    event, user, payload = make_event(db, "badminton")
    update_tournament_format(event.id, TournamentFormatIn(tournament_format=tournament_format),
        user=user, _=None, db=db)
    payload.pop("organization_id")
    payload.pop("sport_config")
    if submitted_config is not None:
        payload["sport_config"] = submitted_config
    payload.update(name="Renamed tournament", description="Updated description",
        location_name="New venue", event_date="2026-10-11", max_participants=120,
        registration_open="2026-09-01T00:00:00", registration_close="2026-10-09T00:00:00")
    payload["categories"][0].update(id=event.categories[0].id, name="Updated category")
    payload["categories"][0]["tickets"][0]["id"] = event.categories[0].tickets[0].id
    updated = update_event(event.id, OrganizerEventUpdateV1.model_validate(payload),
        user=user, db=db, storage=None)
    assert updated["name"] == "Renamed tournament"
    db.refresh(event)
    assert event.location_name == "New venue"
    assert event.description == "Updated description"
    assert event.start_date.date().isoformat() == "2026-10-11"
    assert event.max_participants == 120
    assert event.registration_close.date().isoformat() == "2026-10-09"
    assert event.categories[0].name == "Updated category"
    assert event.field_config["sport_config"]["tournament_format"] == tournament_format
    assert _event_response(event)["sportConfig"]["tournament_format"] == tournament_format


@pytest.mark.parametrize("sport", ["badminton", "cricket"])
def test_general_edit_preserves_omitted_legacy_sport_config(db, sport):
    event, user, payload = make_event(db, sport)
    # Older events may not have a sport_config key at all.
    event.field_config = {key: value for key, value in event.field_config.items() if key != "sport_config"}
    db.commit()
    payload.pop("organization_id")
    payload.pop("sport_config")
    payload["categories"][0]["id"] = event.categories[0].id
    payload["categories"][0]["tickets"][0]["id"] = event.categories[0].tickets[0].id
    updated = update_event(event.id, OrganizerEventUpdateV1.model_validate(payload), user=user, db=db, storage=None)
    assert updated["sportConfig"] == {}


@pytest.mark.parametrize("entry_type", ["singles", "doubles"])
def test_badminton_league_standings_and_public_visibility(db, entry_type):
    import datetime as dt
    from fastapi import HTTPException
    from app.api.v1.public_events import get_public_standings

    event, _, _ = make_event(db, "badminton", sport_config={"tournament_format": "league"})
    category = event.categories[0]
    entries = [register(db, event, name) for name in ("Zara", "Asha", "Meera")]
    category.entry_type = entry_type
    if entry_type == "doubles":
        for entry in entries:
            partner = Participant(name=f"{entry.participant.name} partner")
            index = max((member.participant_index for member in entry.participant_memberships), default=-1) + 1
            entry.participant_memberships.append(RegistrationParticipant(participant=partner, participant_index=index))
            entry.participant_count = 2
    court = Court(event_id=event.id, name="Court")
    db.add(court)
    db.flush()

    def result(a, b, status, winner, approved=False):
        match = Match(event_id=event.id, category_id=category.id, court_id=court.id,
            entry_a_registration_id=entries[a].id, entry_b_registration_id=entries[b].id,
            round_label="League", status=status, winner=winner,
            result_approved_at=dt.datetime.now(dt.timezone.utc) if approved else None)
        db.add(match)
        return match

    result(0, 2, "completed", "entry_a", approved=True)
    second = result(1, 2, "completed", "entry_a")
    result(0, 1, "scheduled", None)
    result(0, 1, "in_progress", None)
    result(0, 1, "completed", None)  # No recorded winner is not a league result.
    db.commit()
    rows = match_service.compute_standings(db, event.id, category.id)
    assert len(rows) == 3  # One row per registered pair, never per member.
    assert [row["registrationId"] for row in rows] == [str(entries[i].id) for i in (1, 0, 2)]
    assert [(r["matchesPlayed"], r["wins"], r["losses"], r["points"]) for r in rows] == [(1, 1, 0, 2), (1, 1, 0, 2), (2, 0, 2, 0)]
    assert rows[0]["displayName"] == ("Asha / Asha partner" if entry_type == "doubles" else "Asha")
    public = get_public_standings(str(event.id), str(category.id), db=db)
    assert len(public) == 2
    assert sum(row["points"] for row in public) == 2
    second.result_approved_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    assert get_public_standings(str(event.id), str(category.id), db=db) == rows
    second.result_approved_at = None
    db.commit()
    assert len(get_public_standings(str(event.id), str(category.id), db=db)) == 2
    event.status = "draft"
    db.commit()
    with pytest.raises(HTTPException) as exc:
        get_public_standings(str(event.id), str(category.id), db=db)
    assert exc.value.status_code == 404
    event.field_config = {**event.field_config, "sport_config": {"tournament_format": "knockout"}}
    db.commit()
    assert match_service.compute_standings(db, event.id, category.id) == []


def test_team_standings_keep_configured_points_and_draws(db):
    event, _, _ = make_event(db, "badminton")
    entries = [register(db, event, name) for name in ("Team A", "Team B")]
    category = event.categories[0]
    category.entry_type = "team"
    court = Court(event_id=event.id, name="Court")
    db.add(court)
    db.flush()
    db.add(TeamMatchScoring(event_id=event.id, category_id=category.id,
        points_for_win=5, points_for_draw=2, points_for_loss=1))
    for winner in ("entry_a", None):
        db.add(Match(event_id=event.id, category_id=category.id, court_id=court.id,
            entry_a_registration_id=entries[0].id, entry_b_registration_id=entries[1].id,
            round_label="League", status="completed", winner=winner))
    db.commit()
    rows = match_service.compute_standings(db, event.id, category.id)
    assert [(r["points"], r["wins"], r["draws"], r["losses"]) for r in rows] == [(7, 1, 1, 0), (3, 0, 1, 1)]
    assert "displayName" not in rows[0]  # Existing team response stays unchanged.


def test_badminton_tournament_format_round_trips(db):
    event, user, _ = make_event(db, "badminton", sport_config={"tournament_format": "league"})
    assert _event_response(event)["sportConfig"] == {"tournament_format": "league"}
    result = update_tournament_format(
        event.id,
        TournamentFormatIn(tournament_format="knockout"),
        user=user,
        _=None,
        db=db,
    )
    assert result == {"sportConfig": {"tournament_format": "knockout"}}
    db.refresh(event)
    assert event.field_config["sport_config"]["tournament_format"] == "knockout"


@pytest.mark.parametrize("sport,other,metric,expected", [
    ("running", cycling, "pace_seconds_per_km", 360),
    ("cycling", running, "speed_kmh_x100", 1000),
])
def test_race_save_publish_public_does_not_invoke_other_sport(db, monkeypatch, sport, other, metric, expected):
    def forbidden(*args):
        raise AssertionError("Invoked the other sport calculation")
    monkeypatch.setattr(other, "calc_speed_kmh_x100" if other is cycling else "calc_pace_seconds_per_km", forbidden)
    monkeypatch.setattr(other, "format_speed" if other is cycling else "format_pace", forbidden)
    event, _, _ = make_event(db, sport)
    registration = register(db, event)
    out = race_result_service.bulk_save_draft(db, event, RaceResultBulkSaveIn.model_validate({"entries": [{
        "registration_id": registration.id, "category_id": event.categories[0].id,
        "finish_time_hhmmss": "00:30:00", "result_status": "Finished"}]}))
    assert getattr(out.entries[0], metric) == expected
    assert race_result_service.get_public_results(db, event.id).categories == []
    race_result_service.publish_results(db, event)
    public = race_result_service.get_public_results(db, event.id).categories[0].entries[0]
    assert public.rank == 1
    assert (public.pace_display, public.speed_display) == (("6:00 /km", None) if sport == "running" else (None, "10.00 km/h"))


def test_running_registration_never_calls_badminton_validation(db, monkeypatch):
    class RejectBadminton(SportAdapter):
        def validate_registration(self, category, count):
            raise ValueError("Badminton-only rule")
    monkeypatch.setitem(registry._adapters, "badminton", RejectBadminton(key="badminton", distance_required=False))
    event, _, _ = make_event(db, "running")
    assert register(db, event).status == "confirmed"
    event, _, _ = make_event(db, "badminton")
    with pytest.raises(ValueError, match="Badminton-only"):
        register(db, event)


@pytest.mark.parametrize("entry_type", ["singles", "doubles"])
@pytest.mark.parametrize("operation", ["create", "update"])
@pytest.mark.parametrize("scores,winner,error", [
    ([(21, 10), (21, 12)], "entry_a", None),
    ([(21, 10), (21, 12)], "entry_b", "Selected winner"),
    ([(21, 10), (12, 21), (21, 15)], "entry_a", None),
    ([(21, 10), (12, 21), (15, 21)], "entry_b", None),
    ([(21, 10)], "entry_a", "must win 2 games"),
    ([(21, 10), (10, 21)], "entry_a", "must win 2 games"),
    ([], "entry_a", "must win 2 games"),
    ([(21, 21), (21, 10)], "entry_a", "finished, untied"),
    ([(10, 5), (21, 12)], "entry_a", "finished, untied"),
    ([(31, 10), (21, 12)], "entry_a", "must not exceed 30"),
])
def test_badminton_completion_matches_scores(db, entry_type, operation, scores, winner, error):
    event, user, _ = make_event(db, "badminton")
    a, b = register(db, event, "Alice"), register(db, event, "Bob")
    event.categories[0].entry_type = entry_type
    court = Court(event_id=event.id, name="Court")
    db.add(court)
    db.commit()
    payload = MatchIn(category_id=event.categories[0].id, court_id=court.id,
        entry_a_registration_id=a.id, entry_b_registration_id=b.id, round_label="Final")
    match_id = None
    if operation == "update":
        match_id = UUID(match_service.create_match(db, user, event, payload)["id"])
    completed = MatchIn.model_validate({**payload.model_dump(), "status": "completed", "winner": winner,
        "games": [dict(game_number=i, score_a=sa, score_b=sb) for i, (sa, sb) in enumerate(scores, 1)]})

    def save():
        if match_id is not None:
            return match_service.update_match(db, user, event, match_id, completed)
        return match_service.create_match(db, user, event, completed)

    if error:
        with pytest.raises(match_service.MatchValidationError, match=error):
            save()
        db.rollback()
        if match_id is not None:
            assert db.get(Match, match_id).status == "scheduled"
            assert db.get(Match, match_id).winner is None
    else:
        assert save()["winner"] == winner


def test_badminton_completion_uses_saved_scores_and_match_config_snapshot(db):
    event, user, _ = make_event(db, "badminton", sport_config={"tournament_format": "league"})
    a, b = register(db, event, "Alice"), register(db, event, "Bob")
    category_id = event.categories[0].id
    match_service.update_scoring_config(db, event, category_id, ScoringConfigIn(games_to_win=1, points_per_game=15))
    court = Court(event_id=event.id, name="Court")
    db.add(court)
    db.commit()
    payload = MatchIn(category_id=category_id, court_id=court.id,
        entry_a_registration_id=a.id, entry_b_registration_id=b.id, round_label="League",
        status="in_progress", games=[dict(game_number=1, score_a=10, score_b=10)])
    created = match_service.create_match(db, user, event, payload)  # Tied live scores remain valid.
    match_id = UUID(created["id"])
    payload = MatchIn.model_validate({**payload.model_dump(), "games": [dict(game_number=1, score_a=15, score_b=10)]})
    match_service.update_match(db, user, event, match_id, payload)
    match_service.update_scoring_config(db, event, category_id, ScoringConfigIn(games_to_win=3, points_per_game=21))
    completed = payload.model_copy(update={"games": None, "status": "completed", "winner": "entry_b"})
    with pytest.raises(match_service.MatchValidationError, match="Selected winner"):
        match_service.update_match(db, user, event, match_id, completed)
    db.rollback()
    result = match_service.update_match(db, user, event, match_id, completed.model_copy(update={"winner": "entry_a"}))
    assert result["winner"] == "entry_a"
    assert result["gamesToWin"] == 1
    assert result["pointsPerGame"] == 15


@pytest.mark.parametrize("sport,points", [("badminton", 21), ("table_tennis", 11)])
def test_tournament_registration_fixture_score_public_flow(db, sport, points):
    event, user, _ = make_event(db, sport)
    a, b = register(db, event, "Alice"), register(db, event, "Bob")
    require_tournament_capable(event, db)
    court = Court(event_id=event.id, name="Court 1")
    db.add(court)
    db.commit()
    payload = MatchIn(category_id=event.categories[0].id, court_id=court.id,
        entry_a_registration_id=a.id, entry_b_registration_id=b.id, round_label="Final",
        status="completed", winner="entry_a", games=[dict(game_number=number, score_a=points, score_b=5) for number in (1, 2)])
    out = match_service.create_match(db, user, event, payload)
    assert out["pointsPerGame"] == points
    assert out["winner"] == "entry_a"
    match_service.set_match_result_approval(
        db,
        event,
        UUID(out["id"]),
        approved=True,
        approved_by=user.id,
    )
    public = match_service.list_public_match_results(db, event.id)
    assert public[0]["games"][0]["scoreA"] == points
    # Existing match snapshots stay fixed when category defaults are changed.
    match_service.update_scoring_config(db, event, event.categories[0].id, ScoringConfigIn(games_to_win=3, points_per_game=15))
    assert match_service.list_matches(db, event.id)[0]["pointsPerGame"] == points


def test_trekking_seat_limit(db):
    event, _, _ = make_event(db, "hiking", quantity=1)
    assert register(db, event).payment_status == "not_required"
    with pytest.raises(ValueError, match="sold out"):
        register(db, event)


def test_sport_specific_score_limit_is_not_a_shared_schema_limit():
    from app.schemas.matches import MatchGameIn
    games = [MatchGameIn(game_number=1, score_a=32, score_b=30)]
    assert get_adapter("table_tennis").tournament.normalize_games(games, 2)[0]["score_a"] == 32
    with pytest.raises(ValueError, match="must not exceed"):
        get_adapter("badminton").tournament.normalize_games(games, 2)


def test_trekking_manual_payment_confirmation_and_capacity(db):
    from app.services.registration_service import decide_registration_payment
    from models import EventPaymentSettings
    event, user, _ = make_event(db, "trekking", quantity=1)
    event.organization.credit_deduction_mode = "MANUAL_EVENT_SETTLEMENT"
    ticket = event.categories[0].tickets[0]
    ticket.price = 10000
    event.payment_settings = EventPaymentSettings(method="manual_upi", upi_id="test@bank", payee_name="Test organizer", is_active=True)
    db.commit()
    registration = register(db, event)
    assert registration.status == "awaiting_payment"
    assert ticket.quantity_reserved == 1
    assert ticket.available == 0
    decide_registration_payment(db, user, event.id, registration.id, decision="approve")
    db.refresh(registration)
    assert registration.status == "confirmed"
    assert registration.payment_status == "approved"
    assert registration.payment.status == "approved"
    assert ticket.quantity_sold == 1
    assert ticket.quantity_reserved == 0


def test_new_adapter_flows_through_event_api_and_registration(db, monkeypatch):
    custom = SportAdapter(key="test_new_sport", distance_required=False, supports_distance=False, team_tournament=False)
    monkeypatch.setattr(registry, "_adapters", registry._adapters.copy())
    registry.register(custom)
    before = get_adapter("badminton")
    event, _, _ = make_event(db, custom.key)
    assert register(db, event).status == "confirmed"
    assert get_adapter("badminton") is before
    assert event.categories[0].distance is None


def test_changing_badminton_default_policy_does_not_change_other_sports(monkeypatch):
    before = get_adapter("table_tennis")
    changed = replace(get_adapter("badminton"), tournament=replace(get_adapter("badminton").tournament, points_per_game=15))
    monkeypatch.setitem(registry._adapters, "badminton", changed)
    assert get_adapter("badminton").tournament.points_per_game == 15
    assert get_adapter("table_tennis") is before
    assert before.tournament.points_per_game == 11
    assert get_adapter("running").race_metrics(300, 1000) == (300, None)
