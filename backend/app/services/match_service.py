from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.services.organizer_visibility_service import confirmed_registration_condition, get_event_visibility
from models import BadmintonCategoryScoring, Court, Event, EventCategory, Match, Registration, RegistrationParticipant, Ticket, TournamentRound


class MatchValidationError(ValueError):
    pass


DEFAULT_GAMES_TO_WIN = 2
DEFAULT_POINTS_PER_GAME = 21


def _scoring_config(db: Session, event: Event, category_id: UUID, *, create: bool = False) -> BadmintonCategoryScoring | None:
    config = db.scalar(
        select(BadmintonCategoryScoring).where(
            BadmintonCategoryScoring.event_id == event.id,
            BadmintonCategoryScoring.category_id == category_id,
        )
    )
    if config is None and create:
        config = BadmintonCategoryScoring(
            event_id=event.id,
            category_id=category_id,
            games_to_win=DEFAULT_GAMES_TO_WIN,
            points_per_game=DEFAULT_POINTS_PER_GAME,
        )
        db.add(config)
        db.flush()
    return config


def list_scoring_configs(db: Session, event: Event) -> list[dict]:
    categories = db.scalars(select(EventCategory).where(EventCategory.event_id == event.id).order_by(EventCategory.name, EventCategory.id)).all()
    configs = {
        config.category_id: config
        for config in db.scalars(select(BadmintonCategoryScoring).where(BadmintonCategoryScoring.event_id == event.id)).all()
    }
    return [
        {
            "categoryId": str(category.id),
            "categoryName": category.name,
            "gamesToWin": configs[category.id].games_to_win if category.id in configs else DEFAULT_GAMES_TO_WIN,
            "pointsPerGame": configs[category.id].points_per_game if category.id in configs else DEFAULT_POINTS_PER_GAME,
        }
        for category in categories
    ]


def update_scoring_config(db: Session, event: Event, category_id: UUID, payload) -> dict:
    category = db.scalar(select(EventCategory).where(EventCategory.id == category_id, EventCategory.event_id == event.id))
    if category is None:
        raise MatchValidationError("Category not found for this event")
    config = _scoring_config(db, event, category.id, create=True)
    config.games_to_win = payload.games_to_win
    config.points_per_game = payload.points_per_game
    db.commit()
    return {
        "categoryId": str(category.id),
        "categoryName": category.name,
        "gamesToWin": config.games_to_win,
        "pointsPerGame": config.points_per_game,
    }


def _normalize_games(games, games_to_win: int) -> list[dict[str, int]] | None:
    if games is None:
        return None
    max_games = games_to_win * 2 - 1
    if len(games) > max_games:
        raise MatchValidationError(f"A match can contain at most {max_games} games")
    game_numbers = [game.game_number for game in games]
    if any(game_number > max_games for game_number in game_numbers):
        raise MatchValidationError(f"Game numbers must be between 1 and {max_games}")
    if len(set(game_numbers)) != len(game_numbers):
        raise MatchValidationError("Game numbers must be unique")
    return [
        {"game_number": game.game_number, "score_a": game.score_a, "score_b": game.score_b}
        for game in sorted(games, key=lambda item: item.game_number)
    ]


def _eligible_registrations(db: Session, user, event: Event, category_id: UUID) -> list[Registration]:
    visibility = get_event_visibility(db, user, event.id)
    visible_ids = visibility["visibleConfirmedRegistrationIds"]
    registrations = db.scalars(
        select(Registration)
        .join(Ticket, Ticket.id == Registration.ticket_id)
        .options(
            joinedload(Registration.participant),
            joinedload(Registration.participant_memberships).joinedload(RegistrationParticipant.participant),
            joinedload(Registration.ticket).joinedload(Ticket.category),
        )
        .where(
            Registration.event_id == event.id,
            Registration.category_id == category_id,
            Ticket.event_id == event.id,
            Ticket.category_id == category_id,
            confirmed_registration_condition(),
        )
        .order_by(Registration.created_at, Registration.id)
    ).unique().all()
    return [registration for registration in registrations if registration.id in visible_ids]


def list_match_entries(db: Session, user, event: Event, category_id: UUID) -> list[dict]:
    category = db.scalar(select(EventCategory).where(EventCategory.id == category_id, EventCategory.event_id == event.id))
    if category is None:
        raise MatchValidationError("Category not found for this event")
    return [_serialize_entry(registration) for registration in _eligible_registrations(db, user, event, category.id)]


def _validate_match_context(db: Session, user, event: Event, payload) -> tuple[EventCategory, Court, Registration, Registration]:
    category = db.scalar(select(EventCategory).where(EventCategory.id == payload.category_id, EventCategory.event_id == event.id))
    court = db.scalar(select(Court).where(Court.id == payload.court_id, Court.event_id == event.id))
    if category is None or court is None:
        raise MatchValidationError("Category or court not found for this event")
    if payload.entry_a_registration_id == payload.entry_b_registration_id:
        raise MatchValidationError("A match must have two different entries")

    registrations = {
        registration.id: registration
        for registration in _eligible_registrations(db, user, event, category.id)
        if registration.id in {payload.entry_a_registration_id, payload.entry_b_registration_id}
    }
    if len(registrations) != 2:
        raise MatchValidationError("Selected registration is not confirmed, visible, or in this category")
    if payload.status == "completed" and payload.winner is None:
        raise MatchValidationError("Completed matches require an explicit winner")
    if payload.status != "completed" and payload.winner is not None:
        raise MatchValidationError("Only completed matches may have a winner")
    return category, court, registrations[payload.entry_a_registration_id], registrations[payload.entry_b_registration_id]


def _validate_match_round(db: Session, event: Event, category: EventCategory, round_id: UUID | None) -> TournamentRound | None:
    if round_id is None:
        return None
    round_item = db.scalar(
        select(TournamentRound).where(
            TournamentRound.id == round_id,
            TournamentRound.event_id == event.id,
            TournamentRound.category_id == category.id,
        )
    )
    if round_item is None:
        raise MatchValidationError("Round not found for this category")
    return round_item


def _serialize_entry(registration: Registration) -> dict:
    participant = registration.participant
    member_names = [member.participant.name for member in registration.participant_memberships] or [participant.name]
    team_name = participant.team_name
    display_name = team_name or " / ".join(member_names)
    return {
        "registrationId": str(registration.id),
        "registrationReference": registration.registration_reference,
        "participantName": participant.name,
        "participantNames": member_names,
        "participantCount": registration.participant_count,
        "teamName": team_name,
        "displayName": display_name,
        "ticketName": registration.ticket.name,
        "categoryId": str(registration.category_id) if registration.category_id else None,
    }


def serialize_match(match: Match) -> dict:
    return {
        "id": str(match.id),
        "eventId": str(match.event_id),
        "category": {"id": str(match.category.id), "name": match.category.name},
        "entryA": _serialize_entry(match.entry_a_registration),
        "entryB": _serialize_entry(match.entry_b_registration),
        "court": {"id": str(match.court.id), "name": match.court.name},
        "roundId": str(match.round_id) if match.round_id else None,
        "round": {
            "id": str(match.round.id),
            "name": match.round.name,
            "position": match.round.position,
        } if match.round else None,
        "roundLabel": match.round.name if match.round else match.round_label,
        "scheduledTime": match.scheduled_time.isoformat() if match.scheduled_time else None,
        "status": match.status,
        "winner": match.winner,
        "gamesToWin": match.games_to_win,
        "pointsPerGame": match.points_per_game,
        "games": [
            {"gameNumber": game["game_number"], "scoreA": game["score_a"], "scoreB": game["score_b"]}
            for game in (match.games or [])
        ],
        "createdAt": match.created_at.isoformat(),
        "updatedAt": match.updated_at.isoformat(),
    }


def _match_query(event_id: UUID):
    return (
        select(Match)
        .options(
            joinedload(Match.category),
            joinedload(Match.court),
            joinedload(Match.round),
            joinedload(Match.entry_a_registration).joinedload(Registration.participant),
            joinedload(Match.entry_a_registration).joinedload(Registration.participant_memberships).joinedload(RegistrationParticipant.participant),
            joinedload(Match.entry_a_registration).joinedload(Registration.ticket),
            joinedload(Match.entry_b_registration).joinedload(Registration.participant),
            joinedload(Match.entry_b_registration).joinedload(Registration.participant_memberships).joinedload(RegistrationParticipant.participant),
            joinedload(Match.entry_b_registration).joinedload(Registration.ticket),
        )
        .where(Match.event_id == event_id)
    )


def list_matches(db: Session, event_id: UUID, category_id: UUID | None = None, status: str | None = None) -> list[dict]:
    query = _match_query(event_id)
    if category_id is not None:
        query = query.where(Match.category_id == category_id)
    if status is not None:
        query = query.where(Match.status == status)
    matches = db.scalars(
        query.outerjoin(TournamentRound, Match.round_id == TournamentRound.id).order_by(
            Match.category_id,
            TournamentRound.position.nulls_last(),
            Match.scheduled_time,
            Match.created_at,
            Match.id,
        )
    ).unique().all()
    return [serialize_match(match) for match in matches]


def create_match(db: Session, user, event: Event, payload) -> dict:
    category, court, entry_a, entry_b = _validate_match_context(db, user, event, payload)
    round_item = _validate_match_round(db, event, category, payload.round_id)
    config = _scoring_config(db, event, category.id, create=True)
    games = _normalize_games(payload.games, config.games_to_win)
    match = Match(
        event_id=event.id,
        category_id=category.id,
        entry_a_registration_id=entry_a.id,
        entry_b_registration_id=entry_b.id,
        court_id=court.id,
        round_id=round_item.id if round_item else None,
        round_label=round_item.name if round_item else payload.round_label,
        scheduled_time=payload.scheduled_time,
        status=payload.status,
        winner=payload.winner,
        games_to_win=config.games_to_win,
        points_per_game=config.points_per_game,
        games=games or [],
    )
    db.add(match)
    db.commit()
    return _get_serialized_match(db, event.id, match.id)


def update_match(db: Session, user, event: Event, match_id: UUID, payload) -> dict:
    match = db.scalar(_match_query(event.id).where(Match.id == match_id))
    if match is None:
        raise MatchValidationError("Match not found")
    category, court, entry_a, entry_b = _validate_match_context(db, user, event, payload)
    round_item = _validate_match_round(db, event, category, payload.round_id)
    has_scores = bool(match.games)
    if match.category_id != category.id and (has_scores or match.status == "completed"):
        raise MatchValidationError("A scored or completed match cannot change category")
    config = _scoring_config(db, event, category.id, create=True)
    if match.category_id != category.id:
        match.games_to_win = config.games_to_win
        match.points_per_game = config.points_per_game
        match.games = []
    normalized_games = _normalize_games(payload.games, match.games_to_win)
    if normalized_games is not None:
        match.games = normalized_games
    match.category_id = category.id
    match.entry_a_registration_id = entry_a.id
    match.entry_b_registration_id = entry_b.id
    match.court_id = court.id
    match.round_id = round_item.id if round_item else None
    match.round_label = round_item.name if round_item else payload.round_label
    match.scheduled_time = payload.scheduled_time
    match.status = payload.status
    match.winner = payload.winner
    db.commit()
    return _get_serialized_match(db, event.id, match.id)


def delete_match(db: Session, event_id: UUID, match_id: UUID) -> None:
    match = db.scalar(select(Match).where(Match.id == match_id, Match.event_id == event_id))
    if match is None:
        raise MatchValidationError("Match not found")
    db.delete(match)
    db.commit()


def list_public_match_results(db: Session, event_id: UUID, category_id: UUID | None = None, status: str | None = None) -> list[dict]:
    query = (
        select(Match)
        .options(
            joinedload(Match.category),
            joinedload(Match.court),
            joinedload(Match.round),
            joinedload(Match.entry_a_registration).joinedload(Registration.participant),
            joinedload(Match.entry_a_registration).joinedload(Registration.participant_memberships).joinedload(RegistrationParticipant.participant),
            joinedload(Match.entry_b_registration).joinedload(Registration.participant),
            joinedload(Match.entry_b_registration).joinedload(Registration.participant_memberships).joinedload(RegistrationParticipant.participant),
        )
        .where(Match.event_id == event_id)
    )
    if category_id is not None:
        query = query.where(Match.category_id == category_id)
    if status is not None:
        query = query.where(Match.status == status)
    matches = db.scalars(
        query.outerjoin(TournamentRound, Match.round_id == TournamentRound.id).order_by(
            Match.category_id,
            TournamentRound.position.nulls_last(),
            Match.round_label,
            Match.scheduled_time,
            Match.created_at,
            Match.id,
        )
    ).unique().all()
    return [
        _serialize_public_match(match)
        for match in matches
        if _is_publicly_eligible(match.entry_a_registration) and _is_publicly_eligible(match.entry_b_registration)
    ]


def _is_publicly_eligible(registration: Registration) -> bool:
    return registration.payment_status in {"approved", "not_required"} and registration.status in {"confirmed", "checked_in"}


def _serialize_public_match(match: Match) -> dict:
    def public_entry(registration: Registration) -> dict:
        names = [member.participant.name for member in registration.participant_memberships] or [registration.participant.name]
        return {"displayName": registration.participant.team_name or " / ".join(names)}

    return {
        "id": str(match.id),
        "category": {"id": str(match.category.id), "name": match.category.name},
        "roundId": str(match.round_id) if match.round_id else None,
        "round": {
            "id": str(match.round.id),
            "name": match.round.name,
            "position": match.round.position,
        } if match.round else None,
        "roundLabel": match.round.name if match.round else match.round_label,
        "court": {"name": match.court.name},
        "scheduledTime": match.scheduled_time.isoformat() if match.scheduled_time else None,
        "status": match.status,
        "winner": match.winner,
        "entryA": public_entry(match.entry_a_registration),
        "entryB": public_entry(match.entry_b_registration),
        "gamesToWin": match.games_to_win,
        "pointsPerGame": match.points_per_game,
        "games": [
            {"gameNumber": game["game_number"], "scoreA": game["score_a"], "scoreB": game["score_b"]}
            for game in (match.games or [])
        ],
    }


def _get_serialized_match(db: Session, event_id: UUID, match_id: UUID) -> dict:
    match = db.scalar(_match_query(event_id).where(Match.id == match_id))
    if match is None:
        raise MatchValidationError("Match not found after save")
    return serialize_match(match)
