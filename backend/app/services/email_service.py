"""Central email service for SportPass.

Provides a single interface for sending all emails with:
- Rate limiting (480 emails per 24-hour window)
- Email logging for tracking and retry
- Reusable across all features (registration, ticket, payment, etc.)

Email limits:
- EMAIL_WARNING_LIMIT = 470: Show warning on admin dashboard
- EMAIL_HARD_LIMIT = 480: Stop sending emails

Email types:
- REGISTRATION_CONFIRMATION
- TICKET
- PAYMENT_CONFIRMATION
- ADMIN_LIMIT_WARNING
"""

from __future__ import annotations

import datetime as dt
import logging
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from enum import Enum
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.services.audit_service import record_audit
from app.services.gmail_api_service import GmailDeliveryError, gmail_api_configured, send_gmail_message
from models import CommunicationConfig, EmailLog, Registration

logger = logging.getLogger(__name__)

# Email limits (per 24-hour rolling window)
EMAIL_WARNING_LIMIT = 470
EMAIL_HARD_LIMIT = 480
EMAIL_RETRY_ENABLED = False

# Email types
EMAIL_TYPE_REGISTRATION_CONFIRMATION = "REGISTRATION_CONFIRMATION"
EMAIL_TYPE_TICKET = "TICKET"
EMAIL_TYPE_PAYMENT_CONFIRMATION = "PAYMENT_CONFIRMATION"
EMAIL_TYPE_ADMIN_LIMIT_WARNING = "ADMIN_LIMIT_WARNING"

# Reference types
REFERENCE_TYPE_REGISTRATION = "REGISTRATION"
REFERENCE_TYPE_EVENT = "EVENT"
REFERENCE_TYPE_TICKET = "TICKET"

# Failure reasons
FAILURE_REASON_AUTH_FAILED = "AUTHENTICATION_FAILED"
FAILURE_REASON_INVALID_RECIPIENT = "INVALID_RECIPIENT"
FAILURE_REASON_PROVIDER_LIMIT_REACHED = "PROVIDER_LIMIT_REACHED"
FAILURE_REASON_SMTP_CONNECTION_FAILED = "SMTP_CONNECTION_FAILED"
FAILURE_REASON_UNKNOWN_ERROR = "UNKNOWN_ERROR"


class EmailLimitStatus(Enum):
    NORMAL = "normal"  # 0-469 emails
    WARNING = "warning"  # 470-479 emails
    LIMIT_REACHED = "limit_reached"  # 480+ emails


class SendEmailResult:
    """Result of an email send attempt."""

    def __init__(
        self,
        success: bool,
        status: str,
        message: str,
        email_log: EmailLog | None = None,
    ):
        self.success = success
        self.status = status  # SENT, PENDING_LIMIT, FAILED, SKIPPED_DISABLED
        self.message = message
        self.email_log = email_log
        # Background callers often ignore this result. Make every unsuccessful
        # outcome visible without logging recipients, message bodies or secrets.
        if not success:
            logger.warning(
                "Email delivery status=%s reason=%s email_type=%s reference_id=%s",
                status,
                getattr(email_log, "failure_reason", None),
                getattr(email_log, "email_type", None),
                getattr(email_log, "reference_id", None),
            )

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "status": self.status,
            "message": self.message,
            "email_log_id": str(self.email_log.id) if self.email_log else None,
        }


def get_email_limit_status(db: Session) -> tuple[EmailLimitStatus, int]:
    """Get current email usage and status for the 24-hour window."""
    window_start = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=24)

    # Count actual attempts, not queued work: counting pending_limit entries
    # would make a full queue permanently block its own recovery.
    result = db.execute(
        select(func.count(EmailLog.id)).where(
            and_(
                EmailLog.attempted_at >= window_start,
                EmailLog.status.in_(("sent", "pending", "failed")),
            )
        )
    ).scalar_one()

    email_count = int(result)

    if email_count >= EMAIL_HARD_LIMIT:
        return EmailLimitStatus.LIMIT_REACHED, email_count
    if email_count >= EMAIL_WARNING_LIMIT:
        return EmailLimitStatus.WARNING, email_count
    return EmailLimitStatus.NORMAL, email_count


def check_email_capacity(db: Session) -> tuple[bool, int, EmailLimitStatus]:
    """Check if we have capacity to send more emails.

    Returns: (has_capacity, current_count, status)
    """
    status, count = get_email_limit_status(db)
    return status != EmailLimitStatus.LIMIT_REACHED, count, status


def _get_or_create_email_log(
    db: Session,
    *,
    recipient: str,
    subject: str,
    email_type: str,
    reference_type: str | None = None,
    reference_id: str | None = None,
    event_id=None,
    status: str = "pending",
    failure_reason: str | None = None,
    is_resend: bool = False,
) -> EmailLog:
    """Create or get an email log entry."""
    log = EmailLog(
        recipient=recipient,
        subject=subject,
        email_type=email_type,
        reference_type=reference_type,
        reference_id=reference_id,
        event_id=event_id,
        status=status,
        failure_reason=failure_reason,
        is_resend=is_resend,
    )
    db.add(log)
    return log


def send_email(
    db: Session,
    *,
    recipient: str,
    subject: str,
    body: str,
    email_type: str,
    reference_type: str | None = None,
    reference_id: str | None = None,
    event_id=None,
    html_body: str | None = None,
    attachments: list[tuple[str, bytes]] | None = None,
    is_resend: bool = False,
    dedupe: bool = False,
) -> SendEmailResult:
    """Send an email using the configured Gmail account.

    Optional:
    - html_body: an HTML alternative rendered by email clients.
    - attachments: list of (filename, pdf_bytes) tuples attached to the message.
    - event_id: links the email to an event for later broadcasts.

    Returns a SendEmailResult with status and email log reference.
    """
    # Lock the EMAIL config row so the capacity check + log reservation below is
    # atomic. Concurrent send_email calls serialize on this row, preventing two
    # requests from both seeing count=479 and both sending (exceeding the 480 cap).
    config = db.scalar(
        select(CommunicationConfig)
        .where(CommunicationConfig.channel == "EMAIL")
        .with_for_update()
    )

    if dedupe:
        existing = db.scalar(select(EmailLog).where(
            EmailLog.recipient == recipient,
            EmailLog.reference_type == reference_type,
            EmailLog.reference_id == reference_id,
        ).order_by(EmailLog.created_at.desc()).limit(1))
        if existing is not None:
            return SendEmailResult(existing.status == "sent", existing.status.upper(),
                                   "Notification already recorded", existing)

    if config is None or not config.enabled:
        logger.warning("Email configuration %s", "missing; save sender settings in Admin Communication" if config is None else "disabled")
        # Log skipped email
        log = _get_or_create_email_log(
            db,
            recipient=recipient,
            subject=subject,
            email_type=email_type,
            reference_type=reference_type,
            reference_id=reference_id,
            status="skipped_disabled",
        )
        db.commit()
        return SendEmailResult(
            success=False,
            status="SKIPPED_DISABLED",
            message="Email configuration is disabled",
            email_log=log,
        )

    # Check email capacity (while holding the config row lock)
    has_capacity, current_count, status = check_email_capacity(db)

    if not has_capacity:
        # Log as pending_limit - will be retried later. Committing releases the lock.
        log = _get_or_create_email_log(
            db,
            recipient=recipient,
            subject=subject,
            email_type=email_type,
            reference_type=reference_type,
            reference_id=reference_id,
            event_id=event_id,
            status="pending_limit",
        )
        db.commit()
        return SendEmailResult(
            success=False,
            status="PENDING_LIMIT",
            message="Daily email limit reached. Email queued for later delivery.",
            email_log=log,
        )

    # Get Gmail configuration
    config_data = config.configuration or {}
    sender_name = config_data.get("sender_name", "")
    gmail_address = config_data.get("gmail_address", "")

    if not sender_name or not gmail_address or not gmail_api_configured():
        logger.warning(
            "Email configuration incomplete: sender_name_present=%s gmail_address_present=%s gmail_oauth_configured=%s",
            bool(sender_name), bool(gmail_address), gmail_api_configured(),
        )
        log = _get_or_create_email_log(
            db,
            recipient=recipient,
            subject=subject,
            email_type=email_type,
            reference_type=reference_type,
            reference_id=reference_id,
            event_id=event_id,
            status="failed",
            failure_reason=FAILURE_REASON_AUTH_FAILED,
        )
        db.commit()
        return SendEmailResult(
            success=False,
            status="FAILED",
            message="Gmail credentials not configured",
            email_log=log,
        )

    # Create log entry for attempted send
    log = _get_or_create_email_log(
        db,
        recipient=recipient,
        subject=subject,
        email_type=email_type,
        reference_type=reference_type,
        reference_id=reference_id,
        event_id=event_id,
        status="pending",
    )
    db.flush()

    attempted_at = dt.datetime.now(dt.timezone.utc)

    try:
        # Create message. Use 'mixed' when attachments are present so both the
        # body (plain/html) and the PDF attachments are delivered correctly.
        msg = MIMEMultipart("mixed")
        msg["From"] = f"{sender_name} <{gmail_address}>"
        msg["To"] = recipient
        msg["Subject"] = subject

        plain_body = f"{body}\n\nThis email was sent via SportPass India."
        if html_body:
            alt = MIMEMultipart("alternative")
            alt.attach(MIMEText(plain_body, "plain", "utf-8"))
            alt.attach(MIMEText(html_body, "html", "utf-8"))
            msg.attach(alt)
        else:
            msg.attach(MIMEText(plain_body, "plain", "utf-8"))

        for filename, file_bytes in attachments or []:
            part = MIMEApplication(file_bytes, _subtype="pdf")
            part.add_header("Content-Disposition", "attachment", filename=filename)
            msg.attach(part)

        send_gmail_message(msg)

        # Mark as sent
        log.status = "sent"
        log.attempted_at = attempted_at
        log.sent_at = dt.datetime.now(dt.timezone.utc)
        db.commit()

        # Check if we hit warning threshold and send warning email if needed
        new_count = current_count + 1
        if new_count >= EMAIL_WARNING_LIMIT and new_count < EMAIL_HARD_LIMIT:
            _send_limit_warning_email(db)

        return SendEmailResult(
            success=True,
            status="SENT",
            message="Email sent successfully",
            email_log=log,
        )

    except GmailDeliveryError as exc:
        log.status = "failed"
        log.attempted_at = attempted_at
        log.failure_reason = exc.reason
        db.commit()
        return SendEmailResult(False, "FAILED", str(exc), log)
    except Exception as exc:
        log.status = "failed"
        log.attempted_at = attempted_at
        log.failure_reason = FAILURE_REASON_UNKNOWN_ERROR
        db.commit()
        return SendEmailResult(
            success=False,
            status="FAILED",
            message=f"Email sending failed: {str(exc)}",
            email_log=log,
        )


def _send_limit_warning_email(db: Session) -> None:
    """Send a warning email when approaching the limit."""
    config = db.scalar(
        select(CommunicationConfig).where(CommunicationConfig.channel == "EMAIL")
    )
    if config is None or not config.enabled:
        return

    config_data = config.configuration or {}
    gmail_address = config_data.get("gmail_address", "")
    sender_name = config_data.get("sender_name", "")

    if not gmail_address:
        return

    subject = "SportPass Email Limit Warning"
    body = f"""SportPass has sent {EMAIL_WARNING_LIMIT} emails in the current sending window.

The configured hard stop is {EMAIL_HARD_LIMIT} emails.

Please review the Communication dashboard or move to a higher-volume email provider.

--
This is an automated warning from SportPass.
"""

    result = send_email(
        db,
        recipient=gmail_address,
        subject=subject,
        body=body,
        email_type=EMAIL_TYPE_ADMIN_LIMIT_WARNING,
    )
    if result.success:
        record_audit(
            db,
            actor_user_id=None,
            action="email_limit_warning_sent",
            resource_type="email_config",
            resource_id=str(config.id),
            metadata={"warning_threshold": EMAIL_WARNING_LIMIT, "hard_limit": EMAIL_HARD_LIMIT},
        )


def retry_pending_emails(db: Session) -> list[SendEmailResult]:
    """Retry pending_limit emails that couldn't be sent due to rate limit.

    Sends oldest pending emails first until the limit is reached again.
    Re-uses the existing email log record (does NOT create duplicates):
    - On success: the existing log is marked sent.
    - On genuine sending error: the existing log is marked failed.
    - When capacity runs out: remaining logs stay pending_limit.

    Returns list of results for each retried email.
    """
    if not EMAIL_RETRY_ENABLED:
        return []
    results: list[SendEmailResult] = []

    # Get pending_limit emails ordered by created_at (oldest first)
    pending = db.scalars(
        select(EmailLog)
        .where(EmailLog.status == "pending_limit")
        .order_by(EmailLog.created_at)
    ).all()

    for email_log in pending:
        # Check current capacity before each send
        has_capacity, _current_count, _status = check_email_capacity(db)
        if not has_capacity:
            # No more capacity - stop; remaining logs stay pending_limit.
            break

        result = _deliver_existing_log(db, email_log)
        results.append(result)

        # Keep referenced registration email_status in sync (if applicable)
        if email_log.reference_type == REFERENCE_TYPE_REGISTRATION and email_log.reference_id:
            registration = db.get(Registration, email_log.reference_id)
            if registration is not None:
                if result.status == "SENT":
                    registration.email_status = "SENT"
                elif result.status == "FAILED":
                    registration.email_status = "FAILED"
                db.commit()

    return results


def _deliver_existing_log(db: Session, email_log: EmailLog) -> SendEmailResult:
    """Attempt Gmail API delivery for an existing email log and update it in place.

    Rebuilds the message body since only the subject/recipient are persisted.
    Never creates a new log record.
    """
    config = db.scalar(select(CommunicationConfig).where(CommunicationConfig.channel == "EMAIL").with_for_update())
    db.refresh(email_log, with_for_update=True)
    if email_log.status != "pending_limit":
        return SendEmailResult(False, "SKIPPED", "Email already processed", email_log)
    if config is None or not config.enabled:
        return SendEmailResult(False, "SKIPPED_DISABLED", "Email disabled", email_log)

    config_data = config.configuration or {}
    sender_name = config_data.get("sender_name", "")
    gmail_address = config_data.get("gmail_address", "")
    if not sender_name or not gmail_address or not gmail_api_configured():
        email_log.failure_reason = FAILURE_REASON_AUTH_FAILED
        db.commit()
        return SendEmailResult(False, "PENDING_LIMIT", "Gmail API credentials not configured", email_log)

    attempted_at = dt.datetime.now(dt.timezone.utc)

    try:
        msg = MIMEMultipart()
        msg["From"] = f"{sender_name} <{gmail_address}>"
        msg["To"] = email_log.recipient
        msg["Subject"] = email_log.subject
        # The original body is not persisted; send a concise delayed-delivery note.
        body = (
            "Your SportPass email was delayed due to capacity limits and is now being delivered.\n\n"
            "If this relates to a registration, your registration is confirmed and safely recorded.\n\n"
            "This email was sent via SportPass India."
        )
        if email_log.reference_type in {"CASHFREE_REVIEW_REFUND_SUCCESS", "CASHFREE_REVIEW_REFUND_ISSUE", "CASHFREE_REVIEW_REFUND_PENDING"}:
            from models import CashfreePaymentResolution, CheckoutPayment
            payment_id = UUID(str(email_log.reference_id))
            resolution = db.scalar(select(CashfreePaymentResolution).where(CashfreePaymentResolution.checkout_payment_id == payment_id))
            checkout = db.get(CheckoutPayment, payment_id)
            expected_status = {"CASHFREE_REVIEW_REFUND_SUCCESS": "REFUNDED", "CASHFREE_REVIEW_REFUND_ISSUE": "NEEDS_REVIEW",
                               "CASHFREE_REVIEW_REFUND_PENDING": "PENDING"}[email_log.reference_type]
            if resolution is None or checkout is None or resolution.status != expected_status:
                email_log.status = "skipped_disabled"
                db.commit()
                return SendEmailResult(False, "SKIPPED", "Refund status has changed", email_log)
            outcome = {
                "REFUNDED": "Cashfree has confirmed the full refund. Your bank or payment method may take additional time to reflect the credit.",
                "NEEDS_REVIEW": "Cashfree has not completed this refund. SportPass is reviewing it; the refund is not yet confirmed.",
                "PENDING": "SportPass has initiated a full refund. We will email you once Cashfree confirms the result.",
            }[resolution.status]
            body = (f"Your booking could not be confirmed. {outcome}\n\n"
                    f"Refund amount: {_fmt_paise(resolution.amount_paise)}\n"
                    f"SportPass order: {checkout.event_order_id}\nRefund reference: {resolution.provider_refund_id}\n\n"
                    "No ticket has been issued for this payment. Contact SportPass support with the order reference if needed.")
            msg.attach(MIMEText(body, "plain", "utf-8"))
        elif email_log.reference_type in {"CASHFREE_PAYMENT_REVIEW_PARTICIPANT", "CASHFREE_PAYMENT_REVIEW_ADMIN"}:
            from models import CheckoutPayment, OrderItem
            order_id = UUID(str(email_log.reference_id))
            checkout = db.scalar(select(CheckoutPayment).where(CheckoutPayment.event_order_id == order_id))
            from models import CashfreePaymentResolution
            resolution = db.scalar(select(CashfreePaymentResolution.id).where(CashfreePaymentResolution.checkout_payment_id == checkout.id)) if checkout else None
            registration = db.scalar(select(Registration).join(OrderItem, OrderItem.registration_id == Registration.id)
                                     .where(OrderItem.order_id == order_id).limit(1))
            if checkout is None or checkout.status != "paid_needs_review" or registration is None or resolution:
                email_log.status = "skipped_disabled"
                db.commit()
                return SendEmailResult(False, "SKIPPED", "Payment review no longer required", email_log)
            event_name = registration.event.name if registration.event else "your event"
            amount = _fmt_paise(checkout.amount_paise)
            if email_log.reference_type == "CASHFREE_PAYMENT_REVIEW_ADMIN":
                body = (f"Cashfree verified a payment of {amount} for {event_name}, but the booking could not be confirmed.\n"
                        f"SportPass order: {order_id}\nCashfree order: {checkout.provider_order_id}\n\n"
                        "Investigate the payment and booking before issuing a ticket or refund. Do not ask the customer to pay again.")
            else:
                body = (f"Cashfree confirmed receipt of your payment of {amount} for {event_name}, but your booking needs SportPass review.\n"
                        f"SportPass order: {order_id}\n\n"
                        "Your ticket has not been issued yet. Please do not pay again. "
                        "SportPass will review this payment and update you; contact support with the order reference if needed.")
            msg.attach(MIMEText(body, "plain", "utf-8"))
        elif email_log.reference_type in {"CASHFREE_REFUND_ADMIN_APPROVED",
                                        "CASHFREE_REFUND_SUCCESS_PARTICIPANT", "CASHFREE_REFUND_SUCCESS_ORGANIZER",
                                        "CASHFREE_REFUND_ISSUE_PARTICIPANT", "CASHFREE_REFUND_ISSUE_ORGANIZER",
                                        "CASHFREE_REFUND_ISSUE_ADMIN"}:
            from models import Refund
            refund = db.get(Refund, UUID(str(email_log.reference_id)))
            if refund is None or refund.payment_provider != "CASHFREE":
                raise ValueError("Cashfree refund unavailable")
            amount = _fmt_paise(refund.approved_refund_amount or 0)
            event_name = refund.event.name if refund.event else "your event"
            if email_log.reference_type == "CASHFREE_REFUND_ADMIN_APPROVED":
                if refund.status != "APPROVED":
                    email_log.status = "skipped_disabled"
                    db.commit()
                    return SendEmailResult(False, "SKIPPED", "Approval no longer awaiting processing", email_log)
                body = (f"An organizer approved a Cashfree refund of {amount} for {event_name}.\n"
                        f"Refund ID: {refund.id}\n\n"
                        "Open Admin → Refunds, verify the request and process it there.")
            elif "SUCCESS" in email_log.reference_type and refund.status != "REFUNDED":
                raise ValueError("Confirmed Cashfree refund unavailable")
            elif "ISSUE" in email_log.reference_type:
                if refund.status == "REFUNDED" or refund.provider_refund_status not in {"REJECTED", "CANCELLED"}:
                    email_log.status = "skipped_disabled"
                    db.commit()
                    return SendEmailResult(False, "SKIPPED", "Provider issue resolved", email_log)
                body = (f"Cashfree has not completed the approved refund of {amount} for {event_name}.\n"
                        f"Refund reference: {refund.provider_refund_id}\n\n"
                        "SportPass admin is reviewing the provider outcome. Do not assume the refund has been credited.")
            elif email_log.reference_type.endswith("PARTICIPANT"):
                body = (f"Cashfree has confirmed your refund of {amount} for {event_name}.\n"
                        f"Refund reference: {refund.provider_refund_id}\n\n"
                        "Your bank or payment method may take additional time to reflect the credit.")
            elif "SUCCESS" in email_log.reference_type:
                body = (f"Cashfree has confirmed a refund of {amount} for {event_name}.\n"
                        f"Refund reference: {refund.provider_refund_id}\n\n"
                        "The participant has been notified. View the refund in your SportPass dashboard.")
            msg.attach(MIMEText(body, "plain", "utf-8"))
        elif email_log.reference_type == "PRODUCT_ORDER":
            from models import ProductOrder
            from app.services.product_order_email import build_product_order_confirmation
            order = db.get(ProductOrder, UUID(str(email_log.reference_id)))
            if order is None or order.status not in {"confirmed", "fulfilled"}:
                raise ValueError("Confirmed merchandise order unavailable")
            content = build_product_order_confirmation(order)
            body = content["body"]
            alternative = MIMEMultipart("alternative")
            alternative.attach(MIMEText(body, "plain", "utf-8"))
            alternative.attach(MIMEText(content["html_body"], "html", "utf-8"))
            msg.attach(alternative)
        elif email_log.reference_type in {REFERENCE_TYPE_REGISTRATION, "CASHFREE_BOOKING"}:
            from app.services.registration_email_content import build_registration_confirmation_content
            if email_log.reference_type == "CASHFREE_BOOKING":
                from app.services.registration_email_content import build_cashfree_booking_content
                content = build_cashfree_booking_content(db, UUID(str(email_log.reference_id)), email_log.recipient)
            else:
                registration = db.get(Registration, UUID(str(email_log.reference_id)))
                if registration is None:
                    raise ValueError("Registration unavailable")
                if registration.payment and registration.payment.payment_gateway == "cashfree" and registration.status not in {"confirmed", "checked_in"}:
                    raise ValueError("Cashfree payment is not confirmed")
                content = build_registration_confirmation_content(db, registration)
            alternative = MIMEMultipart("alternative")
            alternative.attach(MIMEText(content["body"], "plain", "utf-8"))
            alternative.attach(MIMEText(content["html_body"], "html", "utf-8"))
            msg.attach(alternative)
            for filename, file_bytes in content["attachments"]:
                attachment = MIMEApplication(file_bytes, _subtype="pdf")
                attachment.add_header("Content-Disposition", "attachment", filename=filename)
                msg.attach(attachment)
        else:
            msg.attach(MIMEText(body, "plain", "utf-8"))

        # Persist the send attempt before the external call. If the worker
        # stops after Gmail accepts it, leave an ambiguous attempt for manual
        # review instead of automatically sending the same ticket again.
        email_log.status = "pending"
        email_log.attempted_at = attempted_at
        db.commit()
        send_gmail_message(msg)

        email_log.status = "sent"
        email_log.attempted_at = attempted_at
        email_log.sent_at = dt.datetime.now(dt.timezone.utc)
        db.commit()
        return SendEmailResult(True, "SENT", "Email sent successfully", email_log)

    except GmailDeliveryError as exc:
        safe_retry = exc.reason in {FAILURE_REASON_AUTH_FAILED, "PROVIDER_LIMIT_REACHED", "API_NOT_ENABLED"}
        email_log.status = "pending_limit" if safe_retry else "failed"
        email_log.attempted_at = attempted_at
        email_log.failure_reason = exc.reason
        db.commit()
        return SendEmailResult(False, "PENDING_LIMIT" if safe_retry else "FAILED", str(exc), email_log)
    except Exception as exc:
        if email_log.status == "pending_limit":
            # Nothing has been sent: template/PDF generation may safely retry.
            email_log.failure_reason = FAILURE_REASON_UNKNOWN_ERROR
            db.commit()
            return SendEmailResult(False, "PENDING_LIMIT", "Ticket preparation will retry", email_log)
        email_log.status = "failed"
        email_log.attempted_at = attempted_at
        email_log.failure_reason = FAILURE_REASON_UNKNOWN_ERROR
        db.commit()
        return SendEmailResult(False, "FAILED", f"Email sending failed: {exc}", email_log)


def send_registration_confirmation(
    db: Session,
    registration,
    *,
    is_resend: bool = False,
) -> SendEmailResult:
    """Send a registration confirmation email and update the registration's email_status.

    This is a convenience wrapper around send_email() specifically for registrations.
    It never raises - failures are logged and reflected in the return value and
    the registration.email_status field.
    """
    from app.services.registration_email_content import build_registration_confirmation_content

    if (registration.payment and registration.payment.payment_gateway == "cashfree"
            and registration.status not in {"confirmed", "checked_in"}):
        return SendEmailResult(False, "SKIPPED", "Cashfree payment is not confirmed")

    content = build_registration_confirmation_content(db, registration)

    if content["recipient"] is None:
        # No email to send to - mark as failed with invalid recipient
        registration.email_status = "FAILED"
        db.commit()
        return SendEmailResult(
            success=False,
            status="FAILED",
            message="No recipient email address",
        )

    result = send_email(
        db,
        recipient=content["recipient"],
        subject=content["subject"],
        body=content["body"],
        html_body=content["html_body"],
        attachments=content["attachments"],
        email_type=EMAIL_TYPE_REGISTRATION_CONFIRMATION,
        reference_type=REFERENCE_TYPE_REGISTRATION,
        reference_id=str(registration.id),
        event_id=registration.event_id,
        is_resend=is_resend,
    )

    # Map the email service status to the registration email_status
    if result.status == "SENT":
        registration.email_status = "SENT"
    elif result.status == "PENDING_LIMIT":
        registration.email_status = "PENDING_LIMIT"
    elif result.status == "SKIPPED_DISABLED":
        registration.email_status = None
    else:
        registration.email_status = "FAILED"

    db.commit()
    return result


EMAIL_TYPE_EVENT_UPDATE = "EVENT_UPDATE"


def get_event_recipients(db: Session, event_id) -> list[str]:
    """Return the distinct recipient emails for an event.

    Resolves emails from each registration's responses (falling back to the
    participant record). Used for broadcasting event update emails.
    """
    registrations = db.scalars(
        select(Registration).where(Registration.event_id == event_id)
    ).all()

    recipients: list[str] = []
    seen: set[str] = set()
    for reg in registrations:
        responses = reg.responses or {}
        email = responses.get("email")
        if not email and reg.participant is not None:
            email = reg.participant.email
        if email:
            normalized = email.strip().lower()
            if normalized not in seen:
                seen.add(normalized)
                recipients.append(email.strip())
    return recipients


def broadcast_event_update(
    db: Session,
    *,
    event_id,
    subject: str,
    body: str,
    html_body: str | None = None,
) -> dict:
    """Send an update email to every registrant of an event.

    Each email is logged with reference_type=EVENT and event_id for auditing.
    Respects the rate limit; over-limit emails are queued as PENDING_LIMIT and
    retried later by retry_pending_emails.

    Returns a summary dict with counts.
    """
    recipients = get_event_recipients(db, event_id)

    sent = 0
    pending = 0
    failed = 0
    skipped = 0

    for recipient in recipients:
        result = send_email(
            db,
            recipient=recipient,
            subject=subject,
            body=body,
            html_body=html_body,
            email_type=EMAIL_TYPE_EVENT_UPDATE,
            reference_type=REFERENCE_TYPE_EVENT,
            reference_id=str(event_id),
            event_id=event_id,
        )
        if result.status == "SENT":
            sent += 1
        elif result.status == "PENDING_LIMIT":
            pending += 1
        elif result.status == "SKIPPED_DISABLED":
            skipped += 1
        else:
            failed += 1

    return {
        "totalRecipients": len(recipients),
        "sent": sent,
        "pending": pending,
        "failed": failed,
        "skipped": skipped,
    }

# ---------------------------------------------------------------------------
# Refund notification emails
# ---------------------------------------------------------------------------

EMAIL_TYPE_REFUND = "REFUND"
REFERENCE_TYPE_REFUND = "REFUND"


def _fmt_paise(paise: int) -> str:
    return f"₹{paise / 100:,.2f}"


def send_refund_requested_notification(db: Session, refund) -> SendEmailResult:
    """Notify the organizer that a participant has submitted a refund request."""
    organizer_email = None
    from sqlalchemy import select as _select
    from models import User, OrganizationMember
    organizer_members = db.scalars(
        _select(OrganizationMember).where(
            OrganizationMember.organization_id == refund.organizer_id,
            OrganizationMember.member_role == "organizer",
        )
    ).all()
    for member in organizer_members:
        user = db.get(User, member.user_id)
        if user and user.email:
            organizer_email = user.email
            break

    if not organizer_email:
        return SendEmailResult(False, "FAILED", "No organizer email found")

    event_name = refund.event.name if refund.event else "your event"
    participant_name = refund.participant.name if refund.participant else "A participant"
    amount = _fmt_paise(refund.requested_refund_amount)

    subject = f"Refund request received — {event_name}"
    body = (
        f"{participant_name} has submitted a refund request for {event_name}.\n\n"
        f"Requested refund: {amount}\n"
        f"Reason: {refund.refund_reason}\n\n"
        f"Log in to your SportPass organizer dashboard to review and approve or reject this request."
    )
    html_body = f"""
<p><strong>{participant_name}</strong> has submitted a refund request for <strong>{event_name}</strong>.</p>
<table style="border-collapse:collapse;margin:16px 0;">
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Requested refund</td><td style="padding:4px 0;font-weight:600;">{amount}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Reason</td><td style="padding:4px 0;">{refund.refund_reason}</td></tr>
</table>
<p>Log in to your SportPass organizer dashboard to review and approve or reject this request.</p>
"""
    return send_email(
        db,
        recipient=organizer_email,
        subject=subject,
        body=body,
        html_body=html_body,
        email_type=EMAIL_TYPE_REFUND,
        reference_type=REFERENCE_TYPE_REFUND,
        reference_id=str(refund.id),
        event_id=refund.event_id,
    )


def send_refund_approved_notification(db: Session, refund) -> SendEmailResult:
    """Notify the participant that their refund has been approved."""
    participant_email = refund.participant.email if refund.participant else None
    if not participant_email:
        return SendEmailResult(False, "FAILED", "No participant email found")

    event_name = refund.event.name if refund.event else "your event"
    amount = _fmt_paise(refund.approved_refund_amount or refund.requested_refund_amount)

    subject = f"Refund approved — {event_name}"
    next_step = (
        "SportPass will submit the approved refund to Cashfree. We will email you once Cashfree confirms success."
        if refund.payment_provider == "CASHFREE" else
        "The organizer will send your refund manually. Please confirm receipt on your dashboard once received."
    )
    body = (
        f"Your refund request for {event_name} has been approved.\n\n"
        f"Approved refund amount: {amount}\n\n"
        f"{next_step}"
    )
    html_body = f"""
<p>Your refund request for <strong>{event_name}</strong> has been <strong>approved</strong>.</p>
<p style="font-size:1.2em;font-weight:600;">Approved refund: {amount}</p>
<p>{next_step}</p>
"""
    return send_email(
        db,
        recipient=participant_email,
        subject=subject,
        body=body,
        html_body=html_body,
        email_type=EMAIL_TYPE_REFUND,
        reference_type=REFERENCE_TYPE_REFUND,
        reference_id=str(refund.id),
        event_id=refund.event_id,
    )


def send_refund_rejected_notification(db: Session, refund) -> SendEmailResult:
    """Notify the participant that their refund has been rejected."""
    participant_email = refund.participant.email if refund.participant else None
    if not participant_email:
        return SendEmailResult(False, "FAILED", "No participant email found")

    event_name = refund.event.name if refund.event else "your event"
    reason = refund.organizer_comments or "No reason provided."

    subject = f"Refund request declined — {event_name}"
    body = (
        f"Your refund request for {event_name} has been declined.\n\n"
        f"Reason: {reason}\n\n"
        f"If you have questions, please contact the event organizer directly."
    )
    html_body = f"""
<p>Your refund request for <strong>{event_name}</strong> has been <strong>declined</strong>.</p>
<p><strong>Reason:</strong> {reason}</p>
<p>If you have questions, please contact the event organizer directly.</p>
"""
    return send_email(
        db,
        recipient=participant_email,
        subject=subject,
        body=body,
        html_body=html_body,
        email_type=EMAIL_TYPE_REFUND,
        reference_type=REFERENCE_TYPE_REFUND,
        reference_id=str(refund.id),
        event_id=refund.event_id,
    )


def send_refund_sent_notification(db: Session, refund) -> SendEmailResult:
    """Notify the participant that the organizer has sent their refund."""
    participant_email = refund.participant.email if refund.participant else None
    if not participant_email:
        return SendEmailResult(False, "FAILED", "No participant email found")

    event_name = refund.event.name if refund.event else "your event"
    amount = _fmt_paise(refund.approved_refund_amount or refund.requested_refund_amount)
    utr = refund.refund_utr or "N/A"

    subject = f"Refund sent — {event_name}"
    body = (
        f"Your refund for {event_name} has been processed by the organizer.\n\n"
        f"Amount: {amount}\n"
        f"Reference / UTR: {utr}\n\n"
        f"Please allow 1–3 business days for the amount to reflect in your account.\n"
        f"Once received, please confirm receipt on your SportPass dashboard."
    )
    html_body = f"""
<p>Your refund for <strong>{event_name}</strong> has been processed by the organizer.</p>
<table style="border-collapse:collapse;margin:16px 0;">
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Amount</td><td style="padding:4px 0;font-weight:600;">{amount}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Reference / UTR</td><td style="padding:4px 0;font-family:monospace;">{utr}</td></tr>
</table>
<p>Please allow 1–3 business days for the amount to reflect in your account.</p>
<p>Once received, please confirm receipt on your SportPass dashboard.</p>
"""
    return send_email(
        db,
        recipient=participant_email,
        subject=subject,
        body=body,
        html_body=html_body,
        email_type=EMAIL_TYPE_REFUND,
        reference_type=REFERENCE_TYPE_REFUND,
        reference_id=str(refund.id),
        event_id=refund.event_id,
    )


def send_cashfree_refund_success_notifications(db: Session, refund) -> None:
    """Notify both parties once, only after a verified Cashfree SUCCESS."""
    if refund.payment_provider != "CASHFREE" or refund.status != "REFUNDED":
        raise ValueError("Cashfree refund has not been confirmed")
    from models import OrganizationMember, User
    event_name = refund.event.name if refund.event else "your event"
    amount = _fmt_paise(refund.approved_refund_amount or 0)
    organizer_members = db.scalars(select(OrganizationMember).where(
        OrganizationMember.organization_id == refund.organizer_id,
        OrganizationMember.member_role == "organizer",
    )).all()
    for member in organizer_members:
        organizer = db.get(User, member.user_id)
        if organizer and organizer.email:
            send_email(
                db, recipient=organizer.email,
                subject=f"Cashfree refund confirmed — {event_name}",
                body=(f"Cashfree has confirmed a refund of {amount} for {event_name}.\n"
                      f"Refund reference: {refund.provider_refund_id}\n\n"
                      "You can view the refund in your SportPass dashboard."),
                email_type=EMAIL_TYPE_REFUND,
                reference_type="CASHFREE_REFUND_SUCCESS_ORGANIZER",
                reference_id=str(refund.id), event_id=refund.event_id, dedupe=True,
            )
    participant_email = refund.participant.email if refund.participant else None
    if participant_email:
        send_email(
            db, recipient=participant_email,
            subject=f"Cashfree refund confirmed — {event_name}",
            body=(f"Cashfree has confirmed your refund of {amount} for {event_name}.\n"
                  f"Refund reference: {refund.provider_refund_id}\n\n"
                  "Your bank or payment method may take additional time to reflect the credit. "
                  "You can check its status in your SportPass dashboard."),
            email_type=EMAIL_TYPE_REFUND,
            reference_type="CASHFREE_REFUND_SUCCESS_PARTICIPANT",
            reference_id=str(refund.id), event_id=refund.event_id, dedupe=True,
        )


def send_cashfree_refund_issue_notifications(db: Session, refund) -> None:
    """Explain a provider-rejected/cancelled refund without implying money moved."""
    if refund.payment_provider != "CASHFREE" or refund.provider_refund_status not in {"REJECTED", "CANCELLED"}:
        raise ValueError("Cashfree refund is not in a provider issue state")
    from models import OrganizationMember, User
    event_name = refund.event.name if refund.event else "your event"
    amount = _fmt_paise(refund.approved_refund_amount or 0)
    body = (f"Cashfree has not completed the approved refund of {amount} for {event_name}.\n"
            f"Refund reference: {refund.provider_refund_id}\n\n"
            "SportPass admin is reviewing the provider outcome. Do not assume the refund has been credited.")
    for admin in db.scalars(select(User).where(User.role == "admin", User.email.is_not(None))).all():
        send_email(db, recipient=admin.email,
                   subject=f"Cashfree refund requires resolution — {event_name}",
                   body=(f"Cashfree returned {refund.provider_refund_status} for an approved refund of {amount} "
                         f"for {event_name}.\nRefund ID: {refund.id}\n"
                         f"Provider reference: {refund.provider_refund_id}\n\n"
                         "Review Admin → Refunds. Do not issue a second payment without verifying Cashfree's final state."),
                   email_type=EMAIL_TYPE_REFUND, reference_type="CASHFREE_REFUND_ISSUE_ADMIN",
                   reference_id=str(refund.id), event_id=refund.event_id, dedupe=True)
    for member in db.scalars(select(OrganizationMember).where(
        OrganizationMember.organization_id == refund.organizer_id,
        OrganizationMember.member_role == "organizer",
    )).all():
        organizer = db.get(User, member.user_id)
        if organizer and organizer.email:
            send_email(db, recipient=organizer.email,
                       subject=f"Cashfree refund needs review — {event_name}", body=body,
                       email_type=EMAIL_TYPE_REFUND, reference_type="CASHFREE_REFUND_ISSUE_ORGANIZER",
                       reference_id=str(refund.id), event_id=refund.event_id, dedupe=True)
    participant_email = refund.participant.email if refund.participant else None
    if participant_email:
        send_email(db, recipient=participant_email,
                   subject=f"Cashfree refund needs review — {event_name}", body=body,
                   email_type=EMAIL_TYPE_REFUND, reference_type="CASHFREE_REFUND_ISSUE_PARTICIPANT",
                   reference_id=str(refund.id), event_id=refund.event_id, dedupe=True)


def send_cashfree_refund_admin_approval_notification(db: Session, refund) -> None:
    """Alert admins that an organizer-approved Cashfree refund needs processing."""
    if refund.payment_provider != "CASHFREE" or refund.status != "APPROVED":
        return
    from models import User
    event_name = refund.event.name if refund.event else "an event"
    amount = _fmt_paise(refund.approved_refund_amount or 0)
    for admin in db.scalars(select(User).where(User.role == "admin", User.email.is_not(None))).all():
        send_email(db, recipient=admin.email,
                   subject=f"Cashfree refund awaiting processing — {event_name}",
                   body=(f"An organizer approved a Cashfree refund of {amount} for {event_name}.\n"
                         f"Refund ID: {refund.id}\n\n"
                         "Open Admin → Refunds, verify the request and process it there."),
                   email_type=EMAIL_TYPE_REFUND, reference_type="CASHFREE_REFUND_ADMIN_APPROVED",
                   reference_id=str(refund.id), event_id=refund.event_id, dedupe=True)
