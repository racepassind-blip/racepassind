from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import Event, EventCategory, Match, TournamentRound


class TournamentRoundValidationError(ValueError):
    pass


def _serialize_round(round_item: TournamentRound) -> dict:
    return {
        "id": str(round_item.id),
        "eventId": str(round_item.event_id),
        "categoryId": str(round_item.category_id),
        "name": round_item.name,
        "position": round_item.position,
        "createdAt": round_item.created_at.isoformat(),
        "updatedAt": round_item.updated_at.isoformat(),
    }


def list_tournament_rounds(db: Session, event: Event, category_id: UUID) -> list[dict]:
    _get_category(db, event, category_id)
    rounds = db.scalars(
        select(TournamentRound)
        .where(TournamentRound.event_id == event.id, TournamentRound.category_id == category_id)
        .order_by(TournamentRound.position, TournamentRound.id)
    ).all()
    return [_serialize_round(round_item) for round_item in rounds]


def update_tournament_rounds(db: Session, event: Event, category_id: UUID, payload) -> list[dict]:
    _get_category(db, event, category_id)
    submitted = payload.rounds
    names = [item.name for item in submitted]
    normalized_names = [name.casefold() for name in names]
    if len(set(normalized_names)) != len(normalized_names):
        raise TournamentRoundValidationError("Round names must be unique within a category")

    existing = {
        round_item.id: round_item
        for round_item in db.scalars(
            select(TournamentRound).where(
                TournamentRound.event_id == event.id,
                TournamentRound.category_id == category_id,
            )
        ).all()
    }
    submitted_ids = [item.id for item in submitted if item.id is not None]
    if len(set(submitted_ids)) != len(submitted_ids):
        raise TournamentRoundValidationError("A round cannot be listed more than once")
    foreign_ids = [round_id for round_id in submitted_ids if round_id not in existing]
    if foreign_ids:
        raise TournamentRoundValidationError("Round does not belong to this category")

    removed_ids = set(existing) - set(submitted_ids)
    if removed_ids and db.scalar(select(Match.id).where(Match.round_id.in_(removed_ids)).limit(1)) is not None:
        raise TournamentRoundValidationError("A round cannot be removed while matches use it")

    reordered_ids = {
        item.id
        for index, item in enumerate(submitted)
        if item.id is not None and existing[item.id].position != index
    }
    if reordered_ids and db.scalar(select(Match.id).where(Match.round_id.in_(reordered_ids)).limit(1)) is not None:
        raise TournamentRoundValidationError("Round order cannot change after matches have been created")

    ordered_rounds: list[TournamentRound] = []
    for index, item in enumerate(submitted):
        round_item = existing.get(item.id) if item.id is not None else TournamentRound(
            event_id=event.id,
            category_id=category_id,
            name=item.name,
            position=0,
        )
        if round_item is None:
            raise TournamentRoundValidationError("Round does not belong to this category")
        round_item.name = item.name
        round_item.position = -(index + 1)
        if item.id is None:
            db.add(round_item)
        ordered_rounds.append(round_item)

    db.flush()
    for round_item in existing.values():
        if round_item.id in removed_ids:
            db.delete(round_item)
    for index, round_item in enumerate(ordered_rounds):
        round_item.position = index
    db.commit()
    return [_serialize_round(round_item) for round_item in ordered_rounds]


def _get_category(db: Session, event: Event, category_id: UUID) -> EventCategory:
    category = db.scalar(select(EventCategory).where(EventCategory.id == category_id, EventCategory.event_id == event.id))
    if category is None:
        raise TournamentRoundValidationError("Category not found for this event")
    return category
