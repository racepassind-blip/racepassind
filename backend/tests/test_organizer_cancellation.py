"""Regression coverage for organizer cancellation, refunds, and waitlist handoff."""
import datetime as dt

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.orm import sessionmaker
from unittest.mock import patch
from sqlalchemy.pool import StaticPool

from app.services.auth_service import utc_now
from app.services.registration_service import cancel_organizer_registration
from app.services.waitlist_service import join
from app.schemas.registrations import WaitlistCreateIn
from db import Base
from models import Refund, EmailLog, CommunicationConfig, OrganizationMember
from tests.test_sport_isolation import make_event, register


@pytest.fixture
def context():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine, autoflush=False) as db:
        event, user, _ = make_event(db, "trekking", quantity=1)
        event.max_participants = 1
        event.waitlist_enabled = True
        db.commit()
        yield db, event, user, register(db, event)
    engine.dispose()


def queued(db, event):
    return join(db, WaitlistCreateIn(
        event_id=event.id, ticket_id=event.tickets[0].id,
        name="Waiting Walker", email="waiting@example.test",
    ))


def _mark_paid(db, event, registration):
    registration.participant_total_paise = 10_000
    registration.total_amount_paise = 10_000
    registration.payment_status = "approved"
    registration.payment.status = "approved"
    event.refund_policy_enabled = True
    event.refund_policy_type = "full_refund"
    event.refund_percentage = 100
    db.commit()


def test_paid_cancellation_creates_one_refund_and_leaves_invitation_manual(context):
    db, event, user, registration = context
    _mark_paid(db, event, registration)
    entry = queued(db, event)

    cancelled, refund, offered = cancel_organizer_registration(
        db, user, event.id, registration.id, reason="Participant cannot attend"
    )

    assert cancelled.status == "cancelled"
    assert cancelled.payment.status == "approved"  # Keep the payment audit trail for refund settlement.
    assert refund is not None and refund.status == "REQUESTED"
    assert refund.requested_refund_amount == 10_000
    assert event.tickets[0].quantity_sold == 0
    assert event.participants == 0
    assert offered is None and entry.status == "waiting"
    assert event.tickets[0].quantity_reserved == 0

    retry, same_refund, no_second_offer = cancel_organizer_registration(
        db, user, event.id, registration.id, reason="Retry after timeout"
    )
    assert retry.status == "cancelled"
    assert same_refund.id == refund.id
    assert no_second_offer is None
    assert db.query(Refund).filter(Refund.registration_id == registration.id).count() == 1


def test_cancellation_is_not_blocked_when_refund_cutoff_has_passed(context):
    db, event, user, registration = context
    _mark_paid(db, event, registration)
    event.refund_cutoff_at = utc_now() - dt.timedelta(minutes=1)
    db.commit()

    cancelled, refund, offered = cancel_organizer_registration(
        db, user, event.id, registration.id, reason="Organizer cancelled the event entry"
    )

    assert cancelled.status == "cancelled"
    assert cancelled.payment.status == "approved"
    assert refund is None and offered is None
    assert db.query(Refund).filter(Refund.registration_id == registration.id).count() == 0
    assert event.tickets[0].quantity_sold == 0


def test_checked_in_registration_cannot_be_cancelled(context):
    db, event, user, registration = context
    registration.status = "checked_in"
    registration.checked_in = True
    db.commit()

    with pytest.raises(ValueError, match="Checked-in"):
        cancel_organizer_registration(db, user, event.id, registration.id, reason="Too late to cancel")


def test_durable_email_retries_failed_send_and_deduplicates_success(context):
    from app.services.cancellation_notifications import recover_notifications, CANCELLATION_JOB
    db, event, user, registration = context
    db.add(CommunicationConfig(channel="EMAIL", enabled=True, configuration={
        "sender_name": "SportPass", "gmail_address": "sender@example.test",
    }))
    db.commit()
    cancel_organizer_registration(db, user, event.id, registration.id, reason="Cannot attend")
    cancel_organizer_registration(db, user, event.id, registration.id, reason="Retry")
    assert db.query(EmailLog).filter_by(reference_type=CANCELLATION_JOB).count() == 1
    factory = sessionmaker(bind=db.get_bind(), autoflush=False)
    # Each worker pass opens fresh sessions, as it does after a process restart.
    with patch("app.services.email_service.gmail_api_configured", return_value=True), patch(
        "app.services.email_service.send_gmail_message", side_effect=RuntimeError("Temporary provider outage")
    ) as send:
        recover_notifications(factory)
        recover_notifications(factory)
        assert send.call_count == 1  # Backoff prevents hot-loop retries.
    db.expire_all()
    job = db.query(EmailLog).filter_by(reference_type=CANCELLATION_JOB).one()
    assert job.status == "queued"
    job.attempted_at = utc_now() - dt.timedelta(minutes=6)
    db.commit()
    with patch("app.services.email_service.gmail_api_configured", return_value=True), patch(
        "app.services.email_service.send_gmail_message"
    ) as send:
        recover_notifications(factory)
        assert send.call_count == 1
        message = send.call_args.args[0]
        plain = next(part for part in message.walk() if part.get_content_type() == "text/plain")
        assert "has been cancelled" in plain.get_payload(decode=True).decode()
        db.expire_all()
        assert job.status == "delivered"
        # Simulate a restart after provider success but before completing the job.
        job.status = "queued"
        job.attempted_at = utc_now() - dt.timedelta(minutes=6)
        db.commit()
        recover_notifications(factory)
        assert send.call_count == 1
        db.expire_all()
        assert job.status == "delivered"


def test_email_job_rolls_back_with_cancellation(context):
    db, event, user, registration = context
    with patch("app.services.registration_service.record_audit", side_effect=RuntimeError("Audit unavailable")):
        with pytest.raises(RuntimeError):
            cancel_organizer_registration(db, user, event.id, registration.id, reason="Cannot attend")
    db.rollback()
    assert registration.status == "confirmed"
    assert db.query(EmailLog).filter_by(reference_type="CANCELLATION_JOB").count() == 0


def test_rate_limited_email_stays_queued_until_capacity_returns(context):
    from app.services.cancellation_notifications import recover_notifications, CANCELLATION_JOB
    from app.services.email_service import EmailLimitStatus
    db, event, user, registration = context
    db.add(CommunicationConfig(channel="EMAIL", enabled=True, configuration={
        "sender_name": "SportPass", "gmail_address": "sender@example.test",
    }))
    db.commit()
    cancel_organizer_registration(db, user, event.id, registration.id, reason="Cannot attend")
    factory = sessionmaker(bind=db.get_bind(), autoflush=False)
    with patch("app.services.email_service.check_email_capacity", return_value=(False, 480, EmailLimitStatus.LIMIT_REACHED)), patch("app.services.email_service.send_gmail_message") as send:
        recover_notifications(factory)
        send.assert_not_called()
    db.expire_all()
    job = db.query(EmailLog).filter_by(reference_type=CANCELLATION_JOB).one()
    assert job.status == "queued"
    job.attempted_at = utc_now() - dt.timedelta(minutes=6)
    db.commit()
    with patch("app.services.email_service.gmail_api_configured", return_value=True), patch("app.services.email_service.send_gmail_message") as send:
        recover_notifications(factory)
        send.assert_called_once()
    db.expire_all()
    assert job.status == "delivered"


def test_refund_organizer_email_recovers_independently(context):
    from app.services.cancellation_notifications import recover_notifications, REFUND_JOB
    db, event, user, registration = context
    _mark_paid(db, event, registration)
    db.add(OrganizationMember(organization_id=event.organization_id, user_id=user.id, member_role="organizer"))
    db.add(CommunicationConfig(channel="EMAIL", enabled=True, configuration={
        "sender_name": "SportPass", "gmail_address": "sender@example.test",
    }))
    db.commit()
    cancel_organizer_registration(db, user, event.id, registration.id, reason="Cannot attend")
    factory = sessionmaker(bind=db.get_bind(), autoflush=False)
    def provider(message):
        if message["To"] == user.email:
            raise RuntimeError("Temporary failure for organizer")
    with patch("app.services.email_service.gmail_api_configured", return_value=True), patch("app.services.email_service.send_gmail_message", side_effect=provider):
        recover_notifications(factory)
    db.expire_all()
    job = db.query(EmailLog).filter_by(reference_type=REFUND_JOB).one()
    assert job.status == "queued"
    job.attempted_at = utc_now() - dt.timedelta(minutes=6)
    db.commit()
    with patch("app.services.email_service.gmail_api_configured", return_value=True), patch("app.services.email_service.send_gmail_message") as send:
        recover_notifications(factory)
        send.assert_called_once()
        assert send.call_args.args[0]["To"] == user.email
    db.expire_all()
    assert job.status == "delivered"
