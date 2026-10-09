"""Recover provider confirmations and durable ticket notifications without a browser.

Run inside the API process; a PostgreSQL advisory lock elects one sweep across
replicas. Never initiates refunds or retries ambiguous email delivery attempts.
"""
import logging
from threading import Event as StopEvent, Thread
from uuid import UUID

from sqlalchemy import select, text, and_, or_

from app.config import get_settings
from app.services.cashfree_gateway import CashfreeGateway
from app.services.cashfree_registration_service import reconcile_order, expire_cashfree_order, queue_paid_needs_review_notifications
from app.services.cashfree_refunds import reconcile_cashfree_refund
from app.services.email_service import _deliver_existing_log, check_email_capacity
from models import CashfreePaymentResolution, CheckoutPayment, EmailLog, Refund, Registration, Participant, User, REFUND_STATUS_APPROVED, REFUND_STATUS_REFUNDED

logger = logging.getLogger(__name__)
LOCK_ID = 734019822


def recover_once(session_factory, stop=None):
    """Each item has an independent transaction; one error cannot poison a sweep."""
    with session_factory() as db:
        gateway = CashfreeGateway()
        payments = list(db.scalars(select(CheckoutPayment.id).where(
            CheckoutPayment.mode == "CASHFREE_PLATFORM",
            CheckoutPayment.event_order_id.is_not(None),
            CheckoutPayment.status == "awaiting",
            or_(and_(CheckoutPayment.provider_account == gateway.account,
                     CheckoutPayment.provider_environment == gateway.environment),
                and_(CheckoutPayment.provider_account.is_(None),
                     CheckoutPayment.provider_environment.is_(None),
                     CheckoutPayment.provider_order_id.is_(None))),
        )))
        review_payments = list(db.scalars(select(CheckoutPayment.id).where(
            CheckoutPayment.mode == "CASHFREE_PLATFORM",
            CheckoutPayment.status == "paid_needs_review",
            CheckoutPayment.event_order_id.is_not(None),
        )))
        resolution_refunds = list(db.scalars(select(CashfreePaymentResolution.checkout_payment_id).where(
            CashfreePaymentResolution.action == "REFUND", CashfreePaymentResolution.status == "PENDING")))
        refunds = list(db.scalars(select(Refund.id).where(
            Refund.payment_provider == "CASHFREE",
            Refund.status == REFUND_STATUS_APPROVED,
            Refund.provider_refund_id.is_not(None),
            Refund.provider_refund_status.in_(("PENDING", "PENDING_APPROVAL", "ONHOLD")),
        )))
        # A crash between the database commit and email send is recovered here.
        refunded_ids = list(db.scalars(select(Refund.id).join(Participant, Refund.participant_id == Participant.id).where(
            Refund.payment_provider == "CASHFREE",
            Refund.status == REFUND_STATUS_REFUNDED,
            Participant.email.is_not(None),
        )))
        notified_ids = set(db.scalars(select(EmailLog.reference_id).where(
            EmailLog.reference_type == "CASHFREE_REFUND_SUCCESS_PARTICIPANT",
        )))
        missing_success_emails = [identifier for identifier in refunded_ids
                                  if str(identifier) not in notified_ids][:100]
        all_issue_ids = list(db.scalars(select(Refund.id).where(
            Refund.payment_provider == "CASHFREE",
            Refund.status == REFUND_STATUS_APPROVED,
            Refund.provider_refund_status.in_(("REJECTED", "CANCELLED")),
        )))
        issue_ids = list(db.scalars(select(Refund.id).join(Participant, Refund.participant_id == Participant.id).where(
            Refund.id.in_(all_issue_ids), Participant.email.is_not(None),
        )))
        issue_notified_ids = set(db.scalars(select(EmailLog.reference_id).where(
            EmailLog.reference_type == "CASHFREE_REFUND_ISSUE_PARTICIPANT",
        )))
        missing_issue_emails = [identifier for identifier in issue_ids
                                if str(identifier) not in issue_notified_ids][:100]
        admin_emails = set(db.scalars(select(User.email).where(User.role == "admin", User.email.is_not(None))))
        admin_approval_ids = list(db.scalars(select(Refund.id).where(
            Refund.payment_provider == "CASHFREE",
            Refund.status == REFUND_STATUS_APPROVED,
            Refund.provider_refund_status.is_(None),
        )))
        admin_notified = set(db.execute(select(EmailLog.reference_id, EmailLog.recipient).where(
            EmailLog.reference_type == "CASHFREE_REFUND_ADMIN_APPROVED",
        )).all())
        missing_admin_emails = [identifier for identifier in admin_approval_ids
                                if any((str(identifier), email) not in admin_notified for email in admin_emails)][:100]
        issue_admin_notified = set(db.execute(select(EmailLog.reference_id, EmailLog.recipient).where(
            EmailLog.reference_type == "CASHFREE_REFUND_ISSUE_ADMIN",
        )).all())
        missing_issue_admin_emails = [identifier for identifier in all_issue_ids
                                      if any((str(identifier), email) not in issue_admin_notified for email in admin_emails)][:100]
        logs = list(db.scalars(select(EmailLog.id).where(
            EmailLog.status == "pending_limit",
            EmailLog.reference_type.in_(("CASHFREE_BOOKING", "CASHFREE_PAYMENT_REVIEW_PARTICIPANT", "CASHFREE_PAYMENT_REVIEW_ADMIN",
                                         "CASHFREE_REVIEW_REFUND_SUCCESS", "CASHFREE_REVIEW_REFUND_ISSUE", "CASHFREE_REVIEW_REFUND_PENDING",
                                         "CASHFREE_REFUND_ADMIN_APPROVED", "CASHFREE_REFUND_SUCCESS_PARTICIPANT", "CASHFREE_REFUND_SUCCESS_ORGANIZER",
                                         "CASHFREE_REFUND_ISSUE_PARTICIPANT", "CASHFREE_REFUND_ISSUE_ORGANIZER", "CASHFREE_REFUND_ISSUE_ADMIN")),
        ).order_by(EmailLog.created_at).limit(100)))
    for kind, identifier in ([('payment', value) for value in payments]
                             + [('payment_review', value) for value in review_payments]
                             + [('resolution_refund', value) for value in resolution_refunds]
                             + [('refund', value) for value in refunds]
                             + [('refund_email', value) for value in missing_success_emails]
                             + [('refund_issue_email', value) for value in missing_issue_emails]
                             + [('refund_admin_email', value) for value in missing_admin_emails]
                             + [('refund_issue_email', value) for value in missing_issue_admin_emails]
                             + [('email', value) for value in logs]):
        if stop and stop.is_set():
            break
        with session_factory() as db:
            try:
                if kind == "payment":
                    payment = db.get(CheckoutPayment, identifier)
                    if not payment.provider_order_id or gateway.recover_session(payment, missing_ok=True) is None:
                        expire_cashfree_order(db, payment.id)
                        continue
                    state = gateway.payment_state(payment)
                    if state == "successful":
                        reconcile_order(db, provider_order_id=payment.provider_order_id)
                    elif state == "expired":
                        expire_cashfree_order(db, payment.id)
                elif kind == "payment_review":
                    queue_paid_needs_review_notifications(db, db.get(CheckoutPayment, identifier))
                    db.commit()
                elif kind == "resolution_refund":
                    from app.services.cashfree_payment_review import reconcile_review_refund
                    reconcile_review_refund(db, payment_id=identifier)
                elif kind == "refund":
                    reconcile_cashfree_refund(db, refund_id=identifier, initiate=True)
                elif kind == "refund_email":
                    from app.services.email_service import send_cashfree_refund_success_notifications
                    send_cashfree_refund_success_notifications(db, db.get(Refund, identifier))
                elif kind == "refund_issue_email":
                    from app.services.email_service import send_cashfree_refund_issue_notifications
                    send_cashfree_refund_issue_notifications(db, db.get(Refund, identifier))
                elif kind == "refund_admin_email":
                    from app.services.email_service import send_cashfree_refund_admin_approval_notification
                    send_cashfree_refund_admin_approval_notification(db, db.get(Refund, identifier))
                else:
                    log = db.get(EmailLog, identifier)
                    if log.reference_type != "CASHFREE_BOOKING":
                        if check_email_capacity(db)[0]:
                            _deliver_existing_log(db, log)
                        continue
                    from app.services.registration_email_content import cashfree_booking_registrations
                    registrations = cashfree_booking_registrations(db, UUID(log.reference_id), log.recipient)
                    if not check_email_capacity(db)[0]:
                        continue
                    result = _deliver_existing_log(db, log)
                    if result.status in {"SENT", "FAILED"}:
                        for registration in registrations:
                            registration.email_status = result.status
                        db.commit()
            except Exception as exc:
                db.rollback()
                # No customer data, gateway response or credentials in logs.
                logger.warning("cashfree_recovery_item_failed kind=%s id=%s error=%s",
                               kind, identifier, type(exc).__name__)


def start_recovery_worker(session_factory, engine):
    stop = StopEvent()

    def run():
        while not stop.is_set():
            try:
                with engine.connect() as lock:
                    postgres = engine.dialect.name == "postgresql"
                    # Transaction-scoped lock also works with transaction
                    # pooling. Closing this connection rolls it back/releases it.
                    acquired = not postgres or lock.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": LOCK_ID})
                    if acquired:
                        recover_once(session_factory, stop)
            except Exception as exc:
                logger.warning("cashfree_recovery_sweep_failed error=%s", type(exc).__name__)
            stop.wait(60)

    worker = Thread(target=run, name="cashfree-recovery", daemon=True)
    if get_settings().cashfree_ready:
        worker.start()
    return stop, worker
