from __future__ import annotations

import datetime as dt

from app.sports import get_adapter

from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, joinedload

from app.services.organizer_visibility_service import confirmed_registration_condition, get_event_visibility
from models import BadmintonCategoryScoring, Court, Event, EventCategory, Match, MatchBout, Registration, RegistrationParticipant, TeamMatchScoring, Ticket, TournamentRound


class MatchValidationError(ValueError):
    pass


def _policy(event):
    return get_adapter(event.category).tournament


def _validate_policy(call, *args):
    try:
        return call(*args)
    except ValueError as exc:
        raise MatchValidationError(str(exc)) from exc


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
            games_to_win=_policy(event).games_to_win,
            points_per_game=_policy(event).points_per_game,
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
            "gamesToWin": configs[category.id].games_to_win if category.id in configs else _policy(event).games_to_win,
            "pointsPerGame": configs[category.id].points_per_game if category.id in configs else _policy(event).points_per_game,
        }
        for category in categories
    ]


def update_scoring_config(db: Session, event: Event, category_id: UUID, payload) -> dict:
    category = db.scalar(select(EventCategory).where(EventCategory.id == category_id, EventCategory.event_id == event.id))
    if category is None:
        raise MatchValidationError("Category not found for this event")
    _validate_policy(_policy(event).validate_config, payload.games_to_win, payload.points_per_game)
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
    _validate_policy(_policy(event).validate_match, payload)
    return category, court, registrations[payload.entry_a_registration_id], registrations[payload.entry_b_registration_id]


def _validate_match_round(db: Session, event: Event, category: EventCategory, round_id: UUID | None) -> TournamentRound | None:
    if round_id is None:
        # Once a Knockout event has configured rounds, every match must name the
        # round it belongs to. Allowing a missing round here would bypass the
        # eligibility checks for later rounds (including eliminated entries).
        if _current_tournament_format(db, event) == "knockout" and db.scalar(
            select(TournamentRound.id).where(
                TournamentRound.event_id == event.id,
                TournamentRound.category_id == category.id,
            ).limit(1)
        ) is not None:
            raise MatchValidationError("A configured knockout round is required for this match")
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
        "bracketPosition": match.bracket_position,
        "autoAdvance": match.auto_advance,
        "nextMatchId": str(match.next_match_id) if match.next_match_id else None,
        "nextMatchSlot": match.next_match_slot,
        "scheduledTime": match.scheduled_time.isoformat() if match.scheduled_time else None,
        "durationMinutes": match.duration_minutes,
        "status": match.status,
        "winner": match.winner,
        "winnerBy": match.winner_by,
        "resultApproved": match.result_approved_at is not None,
        "resultApprovedAt": match.result_approved_at.isoformat() if match.result_approved_at else None,
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


def _next_bracket_position(db: Session, round_item: TournamentRound | None) -> int | None:
    """Allocate a stable position while serializing creates for one round."""
    if round_item is None:
        return None
    db.scalar(select(TournamentRound.id).where(TournamentRound.id == round_item.id).with_for_update())
    current = db.scalar(select(func.max(Match.bracket_position)).where(Match.round_id == round_item.id))
    return (current if current is not None else -1) + 1


def _winner_registration_id(match: Match) -> UUID | None:
    if match.winner == "entry_a":
        return match.entry_a_registration_id
    if match.winner == "entry_b":
        return match.entry_b_registration_id
    return None


def _current_tournament_format(db: Session, event: Event) -> str:
    field_config = db.scalar(select(Event.field_config).where(Event.id == event.id))
    return ((field_config or {}).get("sport_config") or {}).get("tournament_format", "knockout")


def _validate_knockout_eligibility(
    db: Session,
    event: Event,
    category: EventCategory,
    round_item: TournamentRound | None,
    entry_ids: set[UUID],
    *,
    match_id: UUID | None = None,
) -> None:
    """Protect later configured rounds from invalid manual placements.

    Automatic advancement writes its destination directly after validating both
    feeder winners, so it does not need to manufacture a manual-placement reason.
    """
    if round_item is None or _current_tournament_format(db, event) != "knockout":
        return

    previous_round = db.scalar(
        select(TournamentRound)
        .where(
            TournamentRound.event_id == event.id,
            TournamentRound.category_id == category.id,
            TournamentRound.position < round_item.position,
        )
        .order_by(TournamentRound.position.desc())
        .limit(1)
    )
    if previous_round is None:
        return  # The first configured round is open to confirmed entries.

    for entry_id in entry_ids:
        lost_earlier = db.scalar(
            select(Match.id)
            .join(TournamentRound, TournamentRound.id == Match.round_id)
            .where(
                Match.event_id == event.id,
                Match.category_id == category.id,
                TournamentRound.position < round_item.position,
                Match.status == "completed",
                (
                    ((Match.entry_a_registration_id == entry_id) & (Match.winner == "entry_b"))
                    | ((Match.entry_b_registration_id == entry_id) & (Match.winner == "entry_a"))
                ),
            )
            .limit(1)
        )
        if lost_earlier is not None:
            raise MatchValidationError(
                f"An entry that lost an earlier knockout match cannot be placed in {round_item.name}"
            )

        # Editing an existing placement is valid unless an earlier loss was found.
        if match_id is not None and db.scalar(
            select(Match.id).where(
                Match.id == match_id,
                Match.round_id == round_item.id,
                (Match.entry_a_registration_id == entry_id) | (Match.entry_b_registration_id == entry_id),
            )
        ) is not None:
            continue

        won_previous = db.scalar(
            select(Match.id).where(
                Match.event_id == event.id,
                Match.category_id == category.id,
                Match.round_id == previous_round.id,
                Match.status == "completed",
                (
                    ((Match.entry_a_registration_id == entry_id) & (Match.winner == "entry_a"))
                    | ((Match.entry_b_registration_id == entry_id) & (Match.winner == "entry_b"))
                ),
            ).limit(1)
        )
        if won_previous is None:
            raise MatchValidationError(
                f"An entry must win a completed match in {previous_round.name} before being placed in {round_item.name}; missing matches are not byes"
            )


def _link_sources_to_destination(db: Session, sources: list[Match], destination: Match) -> None:
    """Link a paired set of source matches to the matching destination slots."""
    expected = {
        destination.entry_a_registration_id: "entry_a",
        destination.entry_b_registration_id: "entry_b",
    }
    for source in sources:
        winner_id = _winner_registration_id(source)
        slot = expected.get(winner_id)
        if slot is None:
            raise MatchValidationError("The existing next-round match contains different entries")
        source.next_match_id = destination.id
        source.next_match_slot = slot


def _advance_completed_match(db: Session, event: Event, match: Match) -> None:
    """Create/link the next-round match after both feeder matches finish.

    The configured round row is locked so simultaneous completion requests for
    the paired matches cannot create duplicate next-round matches.
    """
    if (
        match.status != "completed"
        or not match.auto_advance
        or _winner_registration_id(match) is None
        or match.round_id is None
        or match.bracket_position is None
    ):
        return

    # Categories inherit the event format. Read the persisted configuration so
    # old auto_advance flags (or a cached Event) cannot override League setup.
    if _current_tournament_format(db, event) != "knockout":
        return

    # An already-linked completion is an idempotent retry.
    if match.next_match_id is not None:
        return

    current_round = db.scalar(
        select(TournamentRound).where(TournamentRound.id == match.round_id).with_for_update()
    )
    if current_round is None:
        return

    next_round = db.scalar(
        select(TournamentRound)
        .where(
            TournamentRound.event_id == event.id,
            TournamentRound.category_id == match.category_id,
            TournamentRound.position > current_round.position,
        )
        .order_by(TournamentRound.position)
        .limit(1)
    )
    if next_round is None:
        return  # This is the final.

    pair_start = match.bracket_position - (match.bracket_position % 2)
    sources = list(
        db.scalars(
            select(Match)
            .where(
                Match.event_id == event.id,
                Match.category_id == match.category_id,
                Match.round_id == match.round_id,
                Match.bracket_position.in_([pair_start, pair_start + 1]),
            )
            .order_by(Match.bracket_position)
        ).all()
    )
    if len(sources) != 2 or any(
        not source.auto_advance or source.status != "completed" or _winner_registration_id(source) is None
        for source in sources
    ):
        return

    linked_ids = {source.next_match_id for source in sources if source.next_match_id is not None}
    if len(linked_ids) > 1:
        raise MatchValidationError("Paired matches point to different next-round matches")
    if linked_ids:
        destination = db.get(Match, linked_ids.pop())
        if destination is None:
            raise MatchValidationError("Next-round match could not be found")
        _link_sources_to_destination(db, sources, destination)
        return

    target_position = pair_start // 2
    destination = db.scalar(
        select(Match).where(
            Match.round_id == next_round.id,
            Match.bracket_position == target_position,
        )
    )
    winners = [_winner_registration_id(source) for source in sources]
    if winners[0] == winners[1]:
        raise MatchValidationError("The same entry cannot advance from both matches in a bracket pair")
    if destination is None:
        destination = Match(
            event_id=event.id,
            category_id=match.category_id,
            entry_a_registration_id=winners[0],
            entry_b_registration_id=winners[1],
            court_id=sources[0].court_id,
            round_id=next_round.id,
            round_label=next_round.name,
            bracket_position=target_position,
            scheduled_time=None,
            status="scheduled",
            winner=None,
            games_to_win=sources[0].games_to_win,
            points_per_game=sources[0].points_per_game,
            games=[],
            auto_advance=True,
        )
        db.add(destination)
        db.flush()

    _link_sources_to_destination(db, sources, destination)


def _utc(value: dt.datetime) -> dt.datetime:
    return value.replace(tzinfo=dt.timezone.utc) if value.tzinfo is None else value.astimezone(dt.timezone.utc)


def scheduling_conflicts(db: Session, event: Event, payload, match_id: UUID | None = None) -> list[str]:
    if payload.scheduled_time is None:
        return []
    start = _utc(payload.scheduled_time)
    end = start + dt.timedelta(minutes=payload.duration_minutes)
    entry_ids = {payload.entry_a_registration_id, payload.entry_b_registration_id}
    registrations = db.scalars(select(Registration).where(Registration.event_id == event.id, Registration.id.in_(entry_ids))).all()

    def players(registration, selected):
        members = registration.participant_memberships
        if selected:
            return {member.participant_id for member in members if str(member.id) in {str(value) for value in selected}}
        return {member.participant_id for member in members} or {registration.participant_id}

    player_ids = set()
    for registration in registrations:
        selected = payload.player_a_participant_ids if registration.id == payload.entry_a_registration_id else payload.player_b_participant_ids
        player_ids.update(players(registration, selected))
    conflicts = []
    for other in db.execute(_match_query(event.id).where(Match.scheduled_time.is_not(None))).unique().scalars():
        if other.id == match_id:
            continue
        other_start = _utc(other.scheduled_time)
        if start >= other_start + dt.timedelta(minutes=other.duration_minutes) or other_start >= end:
            continue
        reasons = []
        if other.court_id == payload.court_id:
            reasons.append(f"Court {other.court.name} is already booked")
        if entry_ids & {other.entry_a_registration_id, other.entry_b_registration_id}:
            reasons.append("A selected player/team is already scheduled")
        elif player_ids & (players(other.entry_a_registration, other.player_a_participant_ids) | players(other.entry_b_registration, other.player_b_participant_ids)):
            reasons.append("A selected player is already scheduled")
        if reasons:
            conflicts.append(f"{'; '.join(reasons)}: {other.round_label} ({other_start.isoformat()}).")
    return conflicts


def _protect_schedule(db: Session, event: Event, payload, match_id: UUID | None = None) -> None:
    # Serialize scheduling writes for this event, including concurrent creates.
    db.execute(select(Event.id).where(Event.id == event.id).with_for_update()).all()
    conflicts = scheduling_conflicts(db, event, payload, match_id)
    if conflicts:
        raise MatchValidationError("Scheduling conflict: " + " ".join(conflicts))


def create_match(db: Session, user, event: Event, payload) -> dict:
    category, court, entry_a, entry_b = _validate_match_context(db, user, event, payload)
    round_item = _validate_match_round(db, event, category, payload.round_id)
    _validate_knockout_eligibility(db, event, category, round_item, {entry_a.id, entry_b.id})
    match_type, player_a_ids, player_b_ids = _validate_policy(_policy(event).select_players, category, entry_a, entry_b, payload)
    _protect_schedule(db, event, payload)
    config = _scoring_config(db, event, category.id, create=True)
    games = _validate_policy(_policy(event).normalize_games, payload.games, config.games_to_win)
    if event.category == "badminton" and category.entry_type in {"singles", "doubles"} and payload.status == "completed":
        _validate_policy(_policy(event).validate_score_winner, games, config.games_to_win, config.points_per_game, payload.winner)
    match = Match(
        event_id=event.id,
        category_id=category.id,
        entry_a_registration_id=entry_a.id,
        entry_b_registration_id=entry_b.id,
        court_id=court.id,
        round_id=round_item.id if round_item else None,
        round_label=round_item.name if round_item else payload.round_label,
        bracket_position=_next_bracket_position(db, round_item),
        auto_advance=payload.auto_advance,
        scheduled_time=payload.scheduled_time,
        duration_minutes=payload.duration_minutes,
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
    db.flush()
    _advance_completed_match(db, event, match)
    db.commit()
    return _get_serialized_match(db, event.id, match.id)


def update_match(db: Session, user, event: Event, match_id: UUID, payload) -> dict:
    match = db.scalar(_match_query(event.id).where(Match.id == match_id))
    if match is None:
        raise MatchValidationError("Match not found")
    previous_public_result = (
        match.category_id,
        match.entry_a_registration_id,
        match.entry_b_registration_id,
        match.court_id,
        match.round_id,
        match.round_label,
        match.scheduled_time,
        match.status,
        match.winner,
        tuple((game["game_number"], game["score_a"], game["score_b"]) for game in (match.games or [])),
    )
    original_round_id = match.round_id
    if match.next_match_id is not None and (
        payload.status != match.status
        or payload.winner != match.winner
        or payload.category_id != match.category_id
        or payload.entry_a_registration_id != match.entry_a_registration_id
        or payload.entry_b_registration_id != match.entry_b_registration_id
        or payload.round_id != match.round_id
        or payload.auto_advance != match.auto_advance
    ):
        raise MatchValidationError(
            "This winner has already advanced; delete the next-round match before changing participants, round, or result"
        )
    category, court, entry_a, entry_b = _validate_match_context(db, user, event, payload)
    round_item = _validate_match_round(db, event, category, payload.round_id)
    _validate_knockout_eligibility(db, event, category, round_item, {entry_a.id, entry_b.id}, match_id=match.id)
    has_scores = bool(match.games)
    if match.category_id != category.id and (has_scores or match.status == "completed"):
        raise MatchValidationError("A scored or completed match cannot change category")
    config = _scoring_config(db, event, category.id, create=True)
    if match.category_id != category.id:
        match.games_to_win = config.games_to_win
        match.points_per_game = config.points_per_game
        match.games = []
    match_type, player_a_ids, player_b_ids = _validate_policy(_policy(event).select_players, category, entry_a, entry_b, payload)
    _protect_schedule(db, event, payload, match_id)
    normalized_games = _validate_policy(_policy(event).normalize_games, payload.games, match.games_to_win)
    if event.category == "badminton" and category.entry_type in {"singles", "doubles"} and payload.status == "completed":
        _validate_policy(_policy(event).validate_score_winner,
            normalized_games if normalized_games is not None else match.games,
            match.games_to_win, match.points_per_game, payload.winner)
    if normalized_games is not None:
        match.games = normalized_games
    match.category_id = category.id
    match.entry_a_registration_id = entry_a.id
    match.entry_b_registration_id = entry_b.id
    match.court_id = court.id
    match.round_id = round_item.id if round_item else None
    match.round_label = round_item.name if round_item else payload.round_label
    if original_round_id != match.round_id:
        match.bracket_position = None
        db.flush()
        match.bracket_position = _next_bracket_position(db, round_item)
    match.duration_minutes = payload.duration_minutes
    match.scheduled_time = payload.scheduled_time
    match.status = payload.status
    match.winner = payload.winner
    match.auto_advance = payload.auto_advance
    match.match_type = match_type
    match.player_a_participant_ids = player_a_ids
    match.player_b_participant_ids = player_b_ids
    current_public_result = (
        match.category_id,
        match.entry_a_registration_id,
        match.entry_b_registration_id,
        match.court_id,
        match.round_id,
        match.round_label,
        match.scheduled_time,
        match.status,
        match.winner,
        tuple((game["game_number"], game["score_a"], game["score_b"]) for game in (match.games or [])),
    )
    if previous_public_result != current_public_result:
        match.result_approved_at = None
        match.result_approved_by = None
    db.flush()
    _advance_completed_match(db, event, match)
    db.commit()
    return _get_serialized_match(db, event.id, match.id)


def delete_match(db: Session, event_id: UUID, match_id: UUID) -> None:
    match = db.scalar(select(Match).where(Match.id == match_id, Match.event_id == event_id))
    if match is None:
        raise MatchValidationError("Match not found")
    if match.next_match_id is not None:
        raise MatchValidationError("Delete the next-round match before deleting this feeder match")
    db.execute(
        update(Match)
        .where(Match.next_match_id == match.id)
        .values(next_match_id=None, next_match_slot=None)
    )
    db.delete(match)
    db.commit()


def set_match_result_approval(
    db: Session,
    event: Event,
    match_id: UUID,
    *,
    approved: bool,
    approved_by: UUID,
) -> dict:
    match = db.scalar(
        select(Match)
        .where(Match.id == match_id, Match.event_id == event.id)
        .with_for_update()
    )
    if match is None:
        raise MatchValidationError("Match not found")
    if approved:
        if match.status != "completed" or _winner_registration_id(match) is None:
            raise MatchValidationError("Only a completed match with a winner can be approved")
        if not match.games:
            raise MatchValidationError("Record the match score before approving the result")
        match.result_approved_at = dt.datetime.now(dt.timezone.utc)
        match.result_approved_by = approved_by
    else:
        match.result_approved_at = None
        match.result_approved_by = None
    db.commit()
    return _get_serialized_match(db, event.id, match.id)


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
        .where(
            Match.event_id == event_id,
            Match.status == "completed",
            Match.result_approved_at.is_not(None),
        )
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
        "durationMinutes": match.duration_minutes,
        "status": match.status,
        "resultApproved": True,
        "approvedAt": match.result_approved_at.isoformat() if match.result_approved_at else None,
        "finalStatus": "Final",
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
    event = db.get(Event, match.event_id)
    match.winner = _policy(event).bout_winner(bouts)


# ---------------------------------------------------------------------------
# Team match scoring config
# ---------------------------------------------------------------------------



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
            points_for_win=_policy(event).points_for_win,
            points_for_draw=_policy(event).points_for_draw,
            points_for_loss=_policy(event).points_for_loss,
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

def compute_standings(db: Session, event_id: UUID, category_id: UUID, *, approved_only: bool = False) -> list[dict]:
    """Return team standings or badminton singles/doubles League standings."""
    category = db.scalar(select(EventCategory).where(EventCategory.id == category_id))
    if category is None or category.event_id != event_id:
        raise MatchValidationError("Category not found for this event")
    event = db.get(Event, event_id)
    is_team = category.entry_type == "team"
    if not is_team:
        if event.category != "badminton" or category.entry_type not in {"singles", "doubles"}:
            raise MatchValidationError("Standings are not available for this category")
        if ((event.field_config or {}).get("sport_config") or {}).get("tournament_format") != "league":
            return []

    # Load scoring config (use defaults if not set)
    config = db.scalar(
        select(TeamMatchScoring).where(
            TeamMatchScoring.event_id == event_id,
            TeamMatchScoring.category_id == category_id,
        )
    )
    policy = _policy(event)

    # Load all completed matches
    matches_query = (
        select(Match)
        .options(
            joinedload(Match.entry_a_registration).joinedload(Registration.participant),
            joinedload(Match.entry_b_registration).joinedload(Registration.participant),
        )
        .where(
            Match.event_id == event_id,
            Match.category_id == category_id,
            Match.status == "completed",
        )
    )
    if approved_only:
        matches_query = matches_query.where(Match.result_approved_at.is_not(None))
    if not is_team:
        # Badminton has no draws: incomplete result records do not affect rank.
        matches_query = matches_query.where(Match.winner.in_(["entry_a", "entry_b"]))
    matches = db.scalars(matches_query).unique().all()

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
                "points": 0,
            }
            if not is_team:
                names = [member.participant.name for member in reg.participant_memberships] or [reg.participant.name]
                stats[rid]["displayName"] = " / ".join(names)
        return stats[rid]

    for match in matches:
        entry_a = match.entry_a_registration
        entry_b = match.entry_b_registration
        sa = _ensure(entry_a)
        sb = _ensure(entry_b)
        sa["matchesPlayed"] += 1
        sb["matchesPlayed"] += 1

        points_a, points_b = (
            policy.standings_points(match.winner, config) if is_team
            else (2, 0) if match.winner == "entry_a" else (0, 2)
        )
        sa["points"] += points_a
        sb["points"] += points_b
        if match.winner == "entry_a":
            sa["wins"] += 1
            sb["losses"] += 1
        elif match.winner == "entry_b":
            sb["wins"] += 1
            sa["losses"] += 1
        else:
            sa["draws"] += 1
            sb["draws"] += 1

    if not is_team:
        return sorted(stats.values(), key=lambda r: (-r["points"], -r["wins"], r["displayName"].casefold(), r["registrationId"]))
    # Preserve the existing team ordering.
    return sorted(stats.values(), key=lambda r: -r["points"])
