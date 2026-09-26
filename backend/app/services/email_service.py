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
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from enum import Enum
from typing import Any, Literal
from uuid import UUID

import smtplib
import ssl
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.services.audit_service import record_audit
from app.services.communication_service import _decrypt_value, _upgrade_legacy_gmail_password
from models import CommunicationConfig, EmailLog, Registration

# Email limits (per 24-hour rolling window)
EMAIL_WARNING_LIMIT = 470
EMAIL_HARD_LIMIT = 480

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

    # Count emails sent in the last 24 hours.
    # Status values are stored lowercase (sent, pending_limit) - match those.
    result = db.execute(
        select(func.count(EmailLog.id)).where(
            and_(
                EmailLog.created_at >= window_start,
                EmailLog.status.in_(("sent", "pending_limit")),
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

    if config is None or not config.enabled:
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
    gmail_app_password_encrypted = config_data.get("gmail_app_password", "")

    if not sender_name or not gmail_address or not gmail_app_password_encrypted:
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

    # Decrypt password and normalize (strip spaces)
    decrypted_password = _decrypt_value(gmail_app_password_encrypted)
    if not decrypted_password:
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
            message="Invalid Gmail credentials",
            email_log=log,
        )

    _upgrade_legacy_gmail_password(config, gmail_app_password_encrypted, decrypted_password)

    # Normalize: strip spaces that may be present in App Password display
    decrypted_password = decrypted_password.replace("\xa0", "").replace(" ", "").strip()

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

    settings = get_settings()
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

        # Send via Gmail SMTP
        context = ssl.create_default_context()
        if settings.environment != "production":
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE

        with smtplib.SMTP("smtp.gmail.com", 587, timeout=10) as server:
            server.starttls(context=context)
            server.login(gmail_address, decrypted_password)
            server.send_message(msg)

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

    except smtplib.SMTPAuthenticationError:
        log.status = "failed"
        log.attempted_at = attempted_at
        log.failure_reason = FAILURE_REASON_AUTH_FAILED
        db.commit()
        return SendEmailResult(
            success=False,
            status="FAILED",
            message="Gmail authentication failed",
            email_log=log,
        )
    except smtplib.SMTPConnectError:
        log.status = "failed"
        log.attempted_at = attempted_at
        log.failure_reason = FAILURE_REASON_SMTP_CONNECTION_FAILED
        db.commit()
        return SendEmailResult(
            success=False,
            status="FAILED",
            message="Unable to connect to Gmail SMTP",
            email_log=log,
        )
    except (TimeoutError, OSError) as exc:
        log.status = "failed"
        log.attempted_at = attempted_at
        log.failure_reason = FAILURE_REASON_SMTP_CONNECTION_FAILED
        db.commit()
        return SendEmailResult(
            success=False,
            status="FAILED",
            message=f"Gmail SMTP timed out: {exc}",
            email_log=log,
        )
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
    """Attempt SMTP delivery for an existing email log and update it in place.

    Rebuilds the message body since only the subject/recipient are persisted.
    Never creates a new log record.
    """
    config = db.scalar(select(CommunicationConfig).where(CommunicationConfig.channel == "EMAIL"))
    if config is None or not config.enabled:
        return SendEmailResult(False, "SKIPPED_DISABLED", "Email disabled", email_log)

    config_data = config.configuration or {}
    sender_name = config_data.get("sender_name", "")
    gmail_address = config_data.get("gmail_address", "")
    encrypted = config_data.get("gmail_app_password", "")

    password = _decrypt_value(encrypted) if encrypted else None
    if not sender_name or not gmail_address or not password:
        email_log.status = "failed"
        email_log.failure_reason = FAILURE_REASON_AUTH_FAILED
        db.commit()
        return SendEmailResult(False, "FAILED", "Invalid Gmail credentials", email_log)

    _upgrade_legacy_gmail_password(config, encrypted, password)

    password = password.replace("\xa0", "").replace(" ", "").strip()
    settings = get_settings()
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
        msg.attach(MIMEText(body, "plain", "utf-8"))

        context = ssl.create_default_context()
        if settings.environment != "production":
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE

        with smtplib.SMTP("smtp.gmail.com", 587, timeout=10) as server:
            server.starttls(context=context)
            server.login(gmail_address, password)
            server.send_message(msg)

        email_log.status = "sent"
        email_log.attempted_at = attempted_at
        email_log.sent_at = dt.datetime.now(dt.timezone.utc)
        db.commit()
        return SendEmailResult(True, "SENT", "Email sent successfully", email_log)

    except smtplib.SMTPAuthenticationError:
        email_log.status = "failed"
        email_log.attempted_at = attempted_at
        email_log.failure_reason = FAILURE_REASON_AUTH_FAILED
        db.commit()
        return SendEmailResult(False, "FAILED", "Gmail authentication failed", email_log)
    except smtplib.SMTPConnectError:
        email_log.status = "failed"
        email_log.attempted_at = attempted_at
        email_log.failure_reason = FAILURE_REASON_SMTP_CONNECTION_FAILED
        db.commit()
        return SendEmailResult(False, "FAILED", "Unable to connect", email_log)
    except (TimeoutError, OSError) as exc:
        email_log.status = "failed"
        email_log.attempted_at = attempted_at
        email_log.failure_reason = FAILURE_REASON_SMTP_CONNECTION_FAILED
        db.commit()
        return SendEmailResult(False, "FAILED", f"Gmail SMTP timed out: {exc}", email_log)
    except Exception as exc:
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
    body = (
        f"Your refund request for {event_name} has been approved.\n\n"
        f"Approved refund amount: {amount}\n\n"
        f"The organizer will process your refund shortly. You will receive another notification once it has been sent."
    )
    html_body = f"""
<p>Your refund request for <strong>{event_name}</strong> has been <strong>approved</strong>.</p>
<p style="font-size:1.2em;font-weight:600;">Approved refund: {amount}</p>
<p>The organizer will process your refund shortly. You will receive another notification once it has been sent.</p>
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
