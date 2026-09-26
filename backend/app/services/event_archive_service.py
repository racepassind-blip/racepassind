from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.services.audit_service import record_audit
from models import (
    AllocationHistory,
    BadmintonCategoryScoring,
    Checkin,
    Court,
    CreditTransaction,
    DiscountCode,
    EmailLog,
    Event,
    EventCategory,
    EventCheckpoint,
    EventDocument,
    EventPaymentSettings,
    Match,
    MatchBout,
    OrderItem,
    Payment,
    RaceResult,
    Registration,
    RegistrationParticipant,
    TeamMatchScoring,
    Ticket,
    TournamentRound,
)


def restore_event_record(db: Session, event: Event, actor_user_id: UUID) -> None:
    event.archived_at = None
    record_audit(
        db,
        actor_user_id=actor_user_id,
        action="event_restored",
        resource_type="event",
        resource_id=event.id,
        metadata={"status": event.status},
    )


def delete_archived_event(db: Session, event: Event, actor_user_id: UUID) -> None:
    """
    Permanently delete an archived event and all related records.

    Records are deleted in strict foreign-key dependency order (children before
    parents) using bulk DELETE statements. Bulk deletes do NOT trigger SQLAlchemy
    ORM cascade rules, so every dependent table is handled explicitly here.

    Deleted data:
    - Match bouts, matches, tournament rounds, courts
    - Checkins, allocation history, race results
    - Payments and order items tied to this event's registrations
    - Registration participants and registrations
    - Tickets, categories (and their scoring configs)
    - Checkpoints, payment settings, discount codes, documents

    Preserved data:
    - Email logs are kept for history; their event_id is set to NULL.
    - Orders are left intact (they can span multiple events); only their
      event-specific items/payments are removed.
    """
    record_audit(
        db,
        actor_user_id=actor_user_id,
        action="event_permanently_deleted",
        resource_type="event",
        resource_id=event.id,
        metadata={"archived_at": event.archived_at.isoformat() if event.archived_at else None},
    )

    # Subquery of registration ids for this event.
    reg_ids_subq = select(Registration.id).where(Registration.event_id == event.id)

    # --- Match layer (children of matches, registrations, courts, rounds) ---
    # Match bouts reference matches/courts/registration_participants.
    db.execute(delete(MatchBout).where(MatchBout.event_id == event.id))
    # Matches reference registrations, courts, categories, rounds.
    db.execute(delete(Match).where(Match.event_id == event.id))

    # --- Payment layer (children of registrations/orders) ---
    db.execute(delete(Payment).where(Payment.registration_id.in_(reg_ids_subq)))
    db.execute(delete(OrderItem).where(OrderItem.registration_id.in_(reg_ids_subq)))

    # Credit ledger rows are immutable financial history. Detach nullable
    # foreign keys before deleting the operational event/registration records.
    db.execute(update(CreditTransaction).where(CreditTransaction.registration_id.in_(reg_ids_subq)).values(registration_id=None))
    db.execute(update(CreditTransaction).where(CreditTransaction.event_id == event.id).values(event_id=None))

    # --- Registration children ---
    db.execute(delete(Checkin).where(Checkin.registration_id.in_(reg_ids_subq)))
    db.execute(delete(AllocationHistory).where(AllocationHistory.event_id == event.id))
    db.execute(delete(RegistrationParticipant).where(RegistrationParticipant.registration_id.in_(reg_ids_subq)))
    db.execute(delete(RaceResult).where(RaceResult.event_id == event.id))

    # --- Registrations ---
    db.execute(delete(Registration).where(Registration.event_id == event.id))

    # --- Category/ticket layer (registrations already gone) ---
    db.execute(delete(BadmintonCategoryScoring).where(BadmintonCategoryScoring.event_id == event.id))
    db.execute(delete(TeamMatchScoring).where(TeamMatchScoring.event_id == event.id))
    db.execute(delete(TournamentRound).where(TournamentRound.event_id == event.id))
    db.execute(delete(Ticket).where(Ticket.event_id == event.id))
    db.execute(delete(EventCategory).where(EventCategory.event_id == event.id))
    db.execute(delete(Court).where(Court.event_id == event.id))

    # --- Remaining direct children of the event ---
    db.execute(delete(EventCheckpoint).where(EventCheckpoint.event_id == event.id))
    db.execute(delete(EventPaymentSettings).where(EventPaymentSettings.event_id == event.id))
    db.execute(delete(DiscountCode).where(DiscountCode.event_id == event.id))
    db.execute(delete(EventDocument).where(EventDocument.event_id == event.id))

    # --- Email logs: preserve history, detach from the event ---
    db.execute(update(EmailLog).where(EmailLog.event_id == event.id).values(event_id=None))

    # --- Finally, the event itself ---
    db.execute(delete(Event).where(Event.id == event.id))
