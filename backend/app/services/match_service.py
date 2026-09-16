from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.services.organizer_visibility_service import confirmed_registration_condition, get_event_visibility
from models import BadmintonCategoryScoring, Court, Event, EventCategory, Match, MatchBout, Registration, RegistrationParticipant, TeamMatchScoring, Ticket, TournamentRound


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
    memberships = list(registration.participant_memberships)
    member_names = [member.participant.name for member in memberships] or [participant.name]
    # Roster of {id, name} so the organizer can pick specific players for team matches.
    members = [
        {"regParticipantId": str(member.id), "name": member.participant.name}
        for member in memberships
    ]
    team_name = participant.team_name
    display_name = team_name or " / ".join(member_names)
    return {
        "registrationId": str(registration.id),
        "registrationReference": registration.registration_reference,
        "participantName": participant.name,
        "participantNames": member_names,
        "members": members,
        "participantCount": registration.participant_count,
        "teamName": team_name,
        "displayName": display_name,
        "ticketName": registration.ticket.name,
        "categoryId": str(registration.category_id) if registration.category_id else None,
    }


def _selected_players(registration: Registration, participant_ids: list[str] | None) -> list[dict] | None:
    """Map selected registration_participant ids to {id, name} preserving order."""
    if not participant_ids:
        return None
    by_id = {str(rp.id): rp for rp in registration.participant_memberships}
    players: list[dict] = []
    for pid in participant_ids:
        rp = by_id.get(str(pid))
        if rp is not None:
            players.append({"regParticipantId": str(rp.id), "name": rp.participant.name})
    return players or None


def serialize_match(match: Match, *, include_bouts: bool = False) -> dict:
    players_a = _selected_players(match.entry_a_registration, match.player_a_participant_ids)
    players_b = _selected_players(match.entry_b_registration, match.player_b_participant_ids)
    result = {
        "id": str(match.id),
        "eventId": str(match.event_id),
        "category": {"id": str(match.category.id), "name": match.category.name, "entryType": match.category.entry_type},
        "entryA": _serialize_entry(match.entry_a_registration),
        "entryB": _serialize_entry(match.entry_b_registration),
        "matchType": match.match_type,
        "playersA": players_a,
        "playersB": players_b,
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
        "winnerBy": match.winner_by,
        "gamesToWin": match.games_to_win,
        "pointsPerGame": match.points_per_game,
        "games": [
            {"gameNumber": game["game_number"], "scoreA": game["score_a"], "scoreB": game["score_b"]}
            for game in (match.games or [])
        ],
        "createdAt": match.created_at.isoformat(),
        "updatedAt": match.updated_at.isoformat(),
    }
    if include_bouts:
        result["bouts"] = [_serialize_bout(b) for b in (match.bouts or [])]
    return result


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


def _resolve_team_player_selection(
    category: EventCategory,
    entry_a: Registration,
    entry_b: Registration,
    payload,
) -> tuple[str | None, list[str] | None, list[str] | None]:
    """Validate and normalize per-match player selection for team categories.

    Returns (match_type, player_a_ids, player_b_ids). For non-team categories this
    is a no-op that returns (None, None, None), leaving existing behaviour intact.
    """
    if category.entry_type != "team":
        # Not a team category — ignore any player-selection input entirely.
        return None, None, None

    match_type = payload.match_type
    if match_type is None:
        # Team category but organizer scheduled a plain team-vs-team match without
        # picking players — allowed, keeps backward compatibility.
        if payload.player_a_participant_ids or payload.player_b_participant_ids:
            raise MatchValidationError("Select a match type (singles or doubles) before choosing players")
        return None, None, None

    required = 1 if match_type == "singles" else 2
    a_ids = [str(pid) for pid in (payload.player_a_participant_ids or [])]
    b_ids = [str(pid) for pid in (payload.player_b_participant_ids or [])]
    if len(a_ids) != required or len(b_ids) != required:
        label = "1 player" if required == 1 else "2 players"
        raise MatchValidationError(f"{match_type.capitalize()} matches require exactly {label} from each team")
    if len(set(a_ids)) != len(a_ids) or len(set(b_ids)) != len(b_ids):
        raise MatchValidationError("A player cannot be selected twice in the same match")

    entry_a_member_ids = {str(rp.id) for rp in entry_a.participant_memberships}
    entry_b_member_ids = {str(rp.id) for rp in entry_b.participant_memberships}
    if not set(a_ids).issubset(entry_a_member_ids):
        raise MatchValidationError("Selected players for team A must belong to team A")
    if not set(b_ids).issubset(entry_b_member_ids):
        raise MatchValidationError("Selected players for team B must belong to team B")
    return match_type, a_ids, b_ids


def create_match(db: Session, user, event: Event, payload) -> dict:
    category, court, entry_a, entry_b = _validate_match_context(db, user, event, payload)
    round_item = _validate_match_round(db, event, category, payload.round_id)
    match_type, player_a_ids, player_b_ids = _resolve_team_player_selection(category, entry_a, entry_b, payload)
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
        match_type=match_type,
        player_a_participant_ids=player_a_ids,
        player_b_participant_ids=player_b_ids,
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
    match_type, player_a_ids, player_b_ids = _resolve_team_player_selection(category, entry_a, entry_b, payload)
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
    match.match_type = match_type
    match.player_a_participant_ids = player_a_ids
    match.player_b_participant_ids = player_b_ids
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


# ---------------------------------------------------------------------------
# Bout serialisation helpers
# ---------------------------------------------------------------------------

def _serialize_bout(bout: MatchBout) -> dict:
    return {
        "id": str(bout.id),
        "matchId": str(bout.match_id),
        "eventId": str(bout.event_id),
        "courtId": str(bout.court_id) if bout.court_id else None,
        "court": {"id": str(bout.court.id), "name": bout.court.name} if bout.court else None,
        "playerARegParticipantId": str(bout.player_a_reg_participant_id) if bout.player_a_reg_participant_id else None,
        "playerBRegParticipantId": str(bout.player_b_reg_participant_id) if bout.player_b_reg_participant_id else None,
        "playerAName": bout.player_a_name,
        "playerBName": bout.player_b_name,
        "status": bout.status,
        "winner": bout.winner,
        "scoreA": bout.score_a,
        "scoreB": bout.score_b,
        "scheduledTime": bout.scheduled_time.isoformat() if bout.scheduled_time else None,
        "createdAt": bout.created_at.isoformat(),
        "updatedAt": bout.updated_at.isoformat(),
    }


def _bout_query(match_id: UUID):
    return (
        select(MatchBout)
        .options(
            joinedload(MatchBout.court),
            joinedload(MatchBout.player_a),
            joinedload(MatchBout.player_b),
        )
        .where(MatchBout.match_id == match_id)
        .order_by(MatchBout.scheduled_time, MatchBout.created_at, MatchBout.id)
    )


def _get_match_for_event(db: Session, event_id: UUID, match_id: UUID) -> Match:
    match = db.scalar(select(Match).where(Match.id == match_id, Match.event_id == event_id))
    if match is None:
        raise MatchValidationError("Match not found")
    return match


def _validate_bout_players(
    db: Session,
    match: Match,
    player_a_rp_id: UUID | None,
    player_b_rp_id: UUID | None,
) -> None:
    """Validate that player participant IDs belong to the correct entry registration."""
    if player_a_rp_id is None and player_b_rp_id is None:
        return
    entry_a_rp_ids = {rp.id for rp in match.entry_a_registration.participant_memberships}
    entry_b_rp_ids = {rp.id for rp in match.entry_b_registration.participant_memberships}
    if player_a_rp_id is not None and player_a_rp_id not in entry_a_rp_ids:
        raise MatchValidationError("Player A must be a member of Entry A")
    if player_b_rp_id is not None and player_b_rp_id not in entry_b_rp_ids:
        raise MatchValidationError("Player B must be a member of Entry B")


# ---------------------------------------------------------------------------
# Bout CRUD
# ---------------------------------------------------------------------------

def list_bouts(db: Session, event_id: UUID, match_id: UUID) -> list[dict]:
    _get_match_for_event(db, event_id, match_id)
    bouts = db.scalars(_bout_query(match_id)).unique().all()
    return [_serialize_bout(b) for b in bouts]


def create_bout(db: Session, event_id: UUID, match_id: UUID, payload) -> dict:
    match = db.scalar(
        select(Match)
        .options(
            joinedload(Match.entry_a_registration).joinedload(Registration.participant_memberships),
            joinedload(Match.entry_b_registration).joinedload(Registration.participant_memberships),
        )
        .where(Match.id == match_id, Match.event_id == event_id)
    )
    if match is None:
        raise MatchValidationError("Match not found")
    _validate_bout_players(db, match, payload.player_a_reg_participant_id, payload.player_b_reg_participant_id)

    # Resolve display names from RegistrationParticipant if IDs provided but names not
    player_a_name = payload.player_a_name
    player_b_name = payload.player_b_name
    if payload.player_a_reg_participant_id and not player_a_name:
        rp = db.get(RegistrationParticipant, payload.player_a_reg_participant_id)
        player_a_name = rp.participant.name if rp and rp.participant else None
    if payload.player_b_reg_participant_id and not player_b_name:
        rp = db.get(RegistrationParticipant, payload.player_b_reg_participant_id)
        player_b_name = rp.participant.name if rp and rp.participant else None

    bout = MatchBout(
        match_id=match_id,
        event_id=event_id,
        court_id=payload.court_id,
        player_a_reg_participant_id=payload.player_a_reg_participant_id,
        player_b_reg_participant_id=payload.player_b_reg_participant_id,
        player_a_name=player_a_name,
        player_b_name=player_b_name,
        status=payload.status,
        winner=payload.winner,
        score_a=payload.score_a,
        score_b=payload.score_b,
        scheduled_time=payload.scheduled_time,
    )
    db.add(bout)
    db.flush()
    if payload.status == "completed" and match.winner_by in (None, "bouts"):
        _recompute_match_winner(db, match)
    db.commit()
    db.refresh(bout)
    return _serialize_bout(bout)


def update_bout(db: Session, event_id: UUID, match_id: UUID, bout_id: UUID, payload) -> dict:
    match = db.scalar(
        select(Match)
        .options(
            joinedload(Match.entry_a_registration).joinedload(Registration.participant_memberships),
            joinedload(Match.entry_b_registration).joinedload(Registration.participant_memberships),
        )
        .where(Match.id == match_id, Match.event_id == event_id)
    )
    if match is None:
        raise MatchValidationError("Match not found")
    bout = db.scalar(select(MatchBout).where(MatchBout.id == bout_id, MatchBout.match_id == match_id))
    if bout is None:
        raise MatchValidationError("Bout not found")
    _validate_bout_players(db, match, payload.player_a_reg_participant_id, payload.player_b_reg_participant_id)

    bout.court_id = payload.court_id
    bout.player_a_reg_participant_id = payload.player_a_reg_participant_id
    bout.player_b_reg_participant_id = payload.player_b_reg_participant_id
    if payload.player_a_name is not None:
        bout.player_a_name = payload.player_a_name
    if payload.player_b_name is not None:
        bout.player_b_name = payload.player_b_name
    bout.status = payload.status
    bout.winner = payload.winner
    bout.score_a = payload.score_a
    bout.score_b = payload.score_b
    bout.scheduled_time = payload.scheduled_time

    if match.winner_by in (None, "bouts"):
        _recompute_match_winner(db, match)
    db.commit()
    db.refresh(bout)
    return _serialize_bout(bout)


def delete_bout(db: Session, event_id: UUID, match_id: UUID, bout_id: UUID) -> None:
    match = _get_match_for_event(db, event_id, match_id)
    bout = db.scalar(select(MatchBout).where(MatchBout.id == bout_id, MatchBout.match_id == match_id))
    if bout is None:
        raise MatchValidationError("Bout not found")
    db.delete(bout)
    db.flush()
    if match.winner_by in (None, "bouts"):
        _recompute_match_winner(db, match)
    db.commit()


# ---------------------------------------------------------------------------
# Auto-compute match winner from bout majority
# ---------------------------------------------------------------------------

def _recompute_match_winner(db: Session, match: Match) -> None:
    """Update match.winner based on completed bout results (majority wins)."""
    bouts = db.scalars(
        select(MatchBout).where(MatchBout.match_id == match.id, MatchBout.status == "completed")
    ).all()
    wins_a = sum(1 for b in bouts if b.winner == "player_a")
    wins_b = sum(1 for b in bouts if b.winner == "player_b")
    if wins_a > wins_b:
        match.winner = "entry_a"
    elif wins_b > wins_a:
        match.winner = "entry_b"
    else:
        match.winner = None  # tie — organiser can set manually


# ---------------------------------------------------------------------------
# Team match scoring config
# ---------------------------------------------------------------------------

DEFAULT_POINTS_FOR_WIN = 3
DEFAULT_POINTS_FOR_DRAW = 1
DEFAULT_POINTS_FOR_LOSS = 0


def _team_scoring_config(db: Session, event: Event, category_id: UUID, *, create: bool = False) -> TeamMatchScoring | None:
    config = db.scalar(
        select(TeamMatchScoring).where(
            TeamMatchScoring.event_id == event.id,
            TeamMatchScoring.category_id == category_id,
        )
    )
    if config is None and create:
        config = TeamMatchScoring(
            event_id=event.id,
            category_id=category_id,
        )
        db.add(config)
        db.flush()
    return config


def get_team_scoring(db: Session, event: Event, category_id: UUID) -> dict:
    config = _team_scoring_config(db, event, category_id, create=True)
    assert config is not None
    db.commit()
    return _serialize_team_scoring(config)


def update_team_scoring(db: Session, event: Event, category_id: UUID, payload) -> dict:
    category = db.scalar(select(EventCategory).where(EventCategory.id == category_id, EventCategory.event_id == event.id))
    if category is None:
        raise MatchValidationError("Category not found for this event")
    if category.entry_type != "team":
        raise MatchValidationError("Team scoring config is only available for team-format categories")
    config = _team_scoring_config(db, event, category_id, create=True)
    assert config is not None
    config.points_for_win = payload.points_for_win
    config.points_for_draw = payload.points_for_draw
    config.points_for_loss = payload.points_for_loss
    config.winner_by = payload.winner_by
    db.commit()
    db.refresh(config)
    return _serialize_team_scoring(config)


def _serialize_team_scoring(config: TeamMatchScoring) -> dict:
    return {
        "id": str(config.id),
        "categoryId": str(config.category_id),
        "pointsForWin": config.points_for_win,
        "pointsForDraw": config.points_for_draw,
        "pointsForLoss": config.points_for_loss,
        "winnerBy": config.winner_by,
        "updatedAt": config.updated_at.isoformat(),
    }


# ---------------------------------------------------------------------------
# Standings computation
# ---------------------------------------------------------------------------

def compute_standings(db: Session, event_id: UUID, category_id: UUID) -> list[dict]:
    """Return sorted standings for a team category."""
    category = db.scalar(select(EventCategory).where(EventCategory.id == category_id))
    if category is None or category.event_id != event_id:
        raise MatchValidationError("Category not found for this event")
    if category.entry_type != "team":
        raise MatchValidationError("Standings are only available for team-format categories")

    # Load scoring config (use defaults if not set)
    config = db.scalar(
        select(TeamMatchScoring).where(
            TeamMatchScoring.event_id == event_id,
            TeamMatchScoring.category_id == category_id,
        )
    )
    pts_win = config.points_for_win if config else DEFAULT_POINTS_FOR_WIN
    pts_draw = config.points_for_draw if config else DEFAULT_POINTS_FOR_DRAW
    pts_loss = config.points_for_loss if config else DEFAULT_POINTS_FOR_LOSS

    # Load all completed matches
    matches = db.scalars(
        select(Match)
        .options(
            joinedload(Match.entry_a_registration).joinedload(Registration.participant),
            joinedload(Match.entry_b_registration).joinedload(Registration.participant),
            joinedload(Match.bouts),
        )
        .where(
            Match.event_id == event_id,
            Match.category_id == category_id,
            Match.status == "completed",
        )
    ).unique().all()

    # Accumulate stats per registration_id
    stats: dict[str, dict] = {}

    def _ensure(reg) -> dict:
        rid = str(reg.id)
        if rid not in stats:
            stats[rid] = {
                "registrationId": rid,
                "teamName": reg.participant.team_name or reg.participant.name,
                "captainName": reg.participant.name,
                "matchesPlayed": 0,
                "wins": 0,
                "draws": 0,
                "losses": 0,
                "boutsWon": 0,
                "boutsLost": 0,
                "points": 0,
            }
        return stats[rid]

    for match in matches:
        entry_a = match.entry_a_registration
        entry_b = match.entry_b_registration
        sa = _ensure(entry_a)
        sb = _ensure(entry_b)
        sa["matchesPlayed"] += 1
        sb["matchesPlayed"] += 1

        if match.winner == "entry_a":
            sa["wins"] += 1
            sa["points"] += pts_win
            sb["losses"] += 1
            sb["points"] += pts_loss
        elif match.winner == "entry_b":
            sb["wins"] += 1
            sb["points"] += pts_win
            sa["losses"] += 1
            sa["points"] += pts_loss
        else:
            sa["draws"] += 1
            sa["points"] += pts_draw
            sb["draws"] += 1
            sb["points"] += pts_draw

        # Bouts
        for bout in match.bouts:
            if bout.status != "completed":
                continue
            if bout.winner == "player_a":
                sa["boutsWon"] += 1
                sb["boutsLost"] += 1
            elif bout.winner == "player_b":
                sb["boutsWon"] += 1
                sa["boutsLost"] += 1

    # Sort: points DESC, boutsWon DESC, boutsLost ASC
    return sorted(
        stats.values(),
        key=lambda r: (-r["points"], -r["boutsWon"], r["boutsLost"]),
    )
