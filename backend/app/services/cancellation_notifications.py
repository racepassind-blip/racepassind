"""Durable cancellation jobs, committed with the cancellation itself.

Only the elected recovery worker delivers these jobs. EmailLog records with
the queue reference types are job markers, not provider delivery attempts.
"""
import datetime as dt
import logging
from uuid import UUID

from sqlalchemy import select

from app.services.auth_service import utc_now
from models import EmailLog, Refund, Registration

logger = logging.getLogger(__name__)
CANCELLATION_JOB = "CANCELLATION_JOB"
REFUND_JOB = "CANCELLATION_REFUND_JOB"


def queue_notifications(db, registration, refund):
    # The registration lock and idempotent cancellation guard ensure one job.
    recipient = (registration.responses or {}).get("email") or (
        registration.participant.email if registration.participant else None
    )
    db.add(EmailLog(
        recipient=recipient or "", subject="Registration cancellation notification",
        email_type="CANCELLATION_JOB", reference_type=CANCELLATION_JOB,
        reference_id=str(registration.id), event_id=registration.event_id, status="queued",
    ))
    if refund is not None and refund.status == "REQUESTED":
        db.add(EmailLog(
            recipient="", subject="Cancellation refund request notification",
            email_type="CANCELLATION_JOB", reference_type=REFUND_JOB,
            reference_id=str(refund.id), event_id=registration.event_id, status="queued",
        ))


def recover_notifications(session_factory):
    """Retry after five minutes; a committed job survives API/worker restarts."""
    from app.services.email_service import (
        send_registration_cancellation_notification, send_refund_requested_notification,
    )
    cutoff = utc_now() - dt.timedelta(minutes=5)
    with session_factory() as db:
        ids = list(db.scalars(select(EmailLog.id).where(
            EmailLog.reference_type.in_((CANCELLATION_JOB, REFUND_JOB)),
            EmailLog.status == "queued",
            (EmailLog.attempted_at.is_(None)) | (EmailLog.attempted_at <= cutoff),
        ).order_by(EmailLog.created_at).limit(50)))
    for job_id in ids:
        with session_factory() as db:
            try:
                job = db.get(EmailLog, job_id)
                job.attempted_at = utc_now()
                db.commit()
                if job.reference_type == CANCELLATION_JOB:
                    registration = db.get(Registration, UUID(job.reference_id))
                    if registration is None or registration.status != "cancelled":
                        job.status = "obsolete"
                        db.commit()
                        continue
                    refund = db.scalar(select(Refund).where(
                        Refund.registration_id == registration.id,
                        Refund.status.in_(("REQUESTED", "APPROVED", "PROCESSING", "REFUND_SENT", "REFUNDED")),
                    ).order_by(Refund.created_at.desc()))
                    result = send_registration_cancellation_notification(db, registration, refund)
                else:
                    refund = db.get(Refund, UUID(job.reference_id))
                    if refund is None or refund.status != "REQUESTED":
                        job.status = "obsolete"
                        db.commit()
                        continue
                    result = send_refund_requested_notification(db, refund, cancellation=True)
                if result.success:
                    job.status = "delivered"
                    job.sent_at = utc_now()
                    job.failure_reason = None
                else:
                    job.failure_reason = result.status
                db.commit()
            except Exception:
                db.rollback()
                logger.exception("Cancellation notification failed job=%s", job_id)
