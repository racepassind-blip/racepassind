"""Reserved invitations feed the existing participant checkout and payment flow."""
import datetime as dt
import hashlib
import hmac
import logging
from threading import Event as StopEvent, Thread
from uuid import UUID

from sqlalchemy import func, select, text

from app.config import get_settings
from app.services.auth_service import utc_now
from app.services.audit_service import record_audit
from models import Event, Ticket, WaitlistEntry, Registration, EmailLog

logger = logging.getLogger(__name__)


def aware(value):
    return value.replace(tzinfo=dt.timezone.utc) if value.tzinfo is None else value


def accepting(event):
    now = utc_now()
    return (event.status == "published" and event.archived_at is None and event.registration_status == "open"
            and (event.registration_open is None or aware(event.registration_open) <= now)
            and (event.registration_close is None or aware(event.registration_close) > now))


def eligible(ticket):
    now = utc_now()
    return (ticket.is_active and (ticket.category is None or ticket.category.entry_type == "singles")
            and (ticket.sale_start is None or aware(ticket.sale_start) <= now)
            and (ticket.sale_end is None or aware(ticket.sale_end) > now))


def enabled(event):
    from app.services.registration_service import waitlist_enabled
    return bool(event.waitlist_enabled and waitlist_enabled(event))


def offer_deadline(event):
    if event.waitlist_offer_window == "until_close" and event.registration_close:
        return aware(event.registration_close)
    minutes = 60 if event.waitlist_offer_window == "60" else 30
    return utc_now() + dt.timedelta(minutes=minutes)


def is_full(db, event, ticket=None):
    from app.services.registration_service import _capacity_used
    return _capacity_used(db, event.id) >= event.max_participants or (
        ticket.available == 0 if ticket else not any(eligible(t) and t.available > 0 for t in event.tickets))


def join(db, payload):
    event = db.scalar(select(Event).where(Event.id == payload.event_id).with_for_update().execution_options(populate_existing=True))
    if event is None or not accepting(event) or not enabled(event):
        raise ValueError("The waiting list is not open for this event")
    ticket = db.get(Ticket, payload.ticket_id) if payload.ticket_id else None
    if ticket is not None and (ticket.event_id != event.id or not eligible(ticket)) or payload.ticket_id and ticket is None:
        raise ValueError("Ticket is not available")
    existing = db.scalar(select(WaitlistEntry).where(WaitlistEntry.event_id == event.id, WaitlistEntry.normalized_email == payload.email.casefold()))
    if existing:
        return existing
    if not is_full(db, event, ticket):
        raise ValueError("Places are available; please register through checkout")
    position = int(db.scalar(select(func.max(WaitlistEntry.position)).where(WaitlistEntry.event_id == event.id)) or 0) + 1
    entry = WaitlistEntry(event_id=event.id, ticket_id=ticket.id if ticket else None, name=payload.name,
                          email=str(payload.email), normalized_email=payload.email.casefold(), phone=payload.phone,
                          position=position, status="waiting")
    db.add(entry)
    db.commit()
    return entry


def token_for(entry):
    settings = get_settings()
    secret = settings.session_secret
    if not secret:
        if settings.is_production:
            raise ValueError("Invitation signing is not configured")
        secret = "local-development-waitlist-only"
    message = f"waitlist:{entry.id}:{aware(entry.promoted_at).isoformat()}"
    return f"{entry.id.hex}.{hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()}"


def resolve(db, token):
    try:
        entry_id = UUID(token.split('.')[0])
    except (ValueError, AttributeError):
        raise ValueError("Invalid invitation") from None
    entry = db.get(WaitlistEntry, entry_id)
    if entry is None or entry.promoted_at is None or not hmac.compare_digest(token_for(entry), token):
        raise ValueError("Invalid invitation")
    return entry


def expire_offers(db, event):
    """Caller holds event lock; offered places have no payment attempt to verify."""
    expired = 0
    for entry in db.scalars(select(WaitlistEntry).where(WaitlistEntry.event_id == event.id, WaitlistEntry.status == "offered").with_for_update().execution_options(populate_existing=True)).all():
        if aware(entry.payment_due_at) > utc_now():
            continue
        ticket = db.scalar(select(Ticket).where(Ticket.id == entry.ticket_id).with_for_update().execution_options(populate_existing=True))
        ticket.quantity_reserved = max(0, ticket.quantity_reserved - 1)
        entry.status = "expired"
        record_audit(db, actor_user_id=None, action="waitlist_offer_expired", resource_type="waitlist_entry", resource_id=entry.id)
        expired += 1
    db.flush()
    return expired


def offer_next(db, event, entry, *, waive_payment, actor_id):
    from app.services.registration_service import _capacity_used
    if not accepting(event) or not enabled(event):
        raise ValueError("Waiting list invitations are disabled or registration is closed")
    head = db.scalar(select(WaitlistEntry).where(WaitlistEntry.event_id == event.id, WaitlistEntry.status == "waiting").order_by(WaitlistEntry.position).limit(1))
    if head is None or head.id != entry.id:
        raise ValueError("Invite the first waiting participant before later participants")
    if _capacity_used(db, event.id) >= event.max_participants:
        raise ValueError("No participant place is available yet")
    tickets = db.scalars(select(Ticket).where(Ticket.event_id == event.id).order_by(Ticket.created_at, Ticket.id).with_for_update().execution_options(populate_existing=True)).all()
    ticket = next((t for t in tickets if (entry.ticket_id is None or entry.ticket_id == t.id) and eligible(t) and t.available > 0), None)
    if ticket is None:
        raise ValueError("No place is available for the next participant's ticket")
    entry.ticket_id = ticket.id
    entry.status = "offered"
    entry.waive_payment = waive_payment
    entry.promoted_at = utc_now()
    entry.payment_due_at = offer_deadline(event)
    entry.offer_email_sent = False
    entry.email_retry_after = None
    ticket.quantity_reserved += 1
    record_audit(db, actor_user_id=actor_id, action="waitlist_invited", resource_type="waitlist_entry", resource_id=entry.id,
                 metadata={"waivePayment": waive_payment, "ticketId": str(ticket.id)})
    db.flush()


def promote(db, user, entry_id, *, waive_payment=False):
    from app.api.deps import get_authorized_event
    entry = db.get(WaitlistEntry, entry_id)
    if entry is None:
        raise ValueError("Waiting list entry not found")
    get_authorized_event(db, user, entry.event_id)
    event = db.scalar(select(Event).where(Event.id == entry.event_id).with_for_update().execution_options(populate_existing=True))
    db.refresh(entry)
    expire_offers(db, event)
    if entry.status == "offered":
        if entry.waive_payment != waive_payment:
            raise ValueError("An invitation has already been sent with a different payment choice")
        db.commit()
        return entry
    if entry.status != "waiting":
        raise ValueError("This waiting list entry has already been processed")
    offer_next(db, event, entry, waive_payment=waive_payment, actor_id=user.id)
    db.commit()
    return entry


def resend_offer(db, user, entry_id):
    """Re-invite an expired offer, placing it at the end of the queue."""
    from app.api.deps import get_authorized_event
    entry = db.get(WaitlistEntry, entry_id)
    if entry is None:
        raise ValueError("Waiting list entry not found")
    get_authorized_event(db, user, entry.event_id)
    event = db.scalar(select(Event).where(Event.id == entry.event_id).with_for_update())
    db.refresh(entry)
    if entry.status == "offered" and aware(entry.payment_due_at) > utc_now():
        entry.offer_email_sent = False
        entry.email_retry_after = None
        db.commit()
        return entry
    if entry.status != "expired":
        raise ValueError("Only expired invitations can be sent again")
    entry.status = "waiting"
    entry.position = int(db.scalar(select(func.max(WaitlistEntry.position)).where(WaitlistEntry.event_id == event.id)) or 0) + 1
    expire_offers(db, event)
    offer_next(db, event, entry, waive_payment=entry.waive_payment, actor_id=user.id)
    db.commit()
    return entry


def consume_offer(db, event, payload):
    """Transfer one invitation hold into a normal registration, in its transaction."""
    if not payload.waitlist_token:
        return None
    entry = resolve(db, payload.waitlist_token)
    db.refresh(entry)
    if entry.event_id != event.id or entry.status != "offered" or aware(entry.payment_due_at) <= utc_now():
        raise ValueError("This invitation has expired or has already been used")
    entries = payload.effective_entries
    if len(entries) != 1 or len(entries[0].participants) != 1 or entries[0].ticket_id != entry.ticket_id:
        raise ValueError("This invitation is for one participant and its specified ticket")
    contact = entries[0].email or entries[0].participants[0].responses.get("email", "")
    if str(contact).strip().casefold() != entry.normalized_email:
        raise ValueError("Use the email address that received the invitation")
    ticket = db.scalar(select(Ticket).where(Ticket.id == entry.ticket_id).with_for_update().execution_options(populate_existing=True))
    if ticket.quantity_reserved < 1:
        raise ValueError("Invitation reservation is no longer available")
    ticket.quantity_reserved -= 1
    entry.status = "redeeming"
    db.flush()
    return entry


def send_notifications(db, entry):
    from app.services.email_service import send_email
    event = db.get(Event, entry.event_id)
    if entry.email_retry_after and aware(entry.email_retry_after) > utc_now():
        return
    for kind in ("joined", "offer"):
        flag = "joined_email_sent" if kind == "joined" else "offer_email_sent"
        if getattr(entry, flag) or kind == "offer" and entry.status != "offered":
            continue
        reference = f"waitlist_{kind}"
        # A prior successful attempt remains authoritative after a worker crash.
        sent = db.scalar(select(EmailLog.id).where(EmailLog.reference_type == reference, EmailLog.reference_id == str(entry.id), EmailLog.status == "sent").limit(1))
        if sent:
            setattr(entry, flag, True)
            db.commit()
            continue
        subject = f"Waiting list confirmation — {event.name}"
        event_date = event.start_date.strftime("%d %B %Y") if event.start_date else "To be announced"
        location = ", ".join(value for value in (event.location_name, event.city, event.state) if value) or "To be announced"
        body = (
            f"Dear {entry.name},\n\n"
            f"Thank you for your interest in {event.name}. We have added you to the waiting list.\n\n"
            f"Event: {event.name}\n"
            f"Date: {event_date}\n"
            f"Location: {location}\n"
            f"Waiting list number: #{entry.position}\n\n"
            "All places are currently filled. No payment has been collected, and joining the waiting list does not guarantee a place. "
            "If a place becomes available, we will send you a separate email with instructions and a limited time to complete registration.\n\n"
            "Please do not make any payment unless you receive an official invitation from SportPass India.\n\n"
            "Regards,\nSportPass India\n"
        )
        if kind == "offer":
            url = f"{get_settings().frontend_origins[0].rstrip('/')}/checkout/{event.id}#waitlist={token_for(entry)}"
            subject = f"Your place is available — {event.name}"
            event_date = event.start_date.strftime("%d %B %Y") if event.start_date else "To be announced"
            location = ", ".join(value for value in (event.location_name, event.city, event.state) if value) or "To be announced"
            expiry = aware(entry.payment_due_at).strftime("%d %B %Y at %H:%M UTC")
            payment = "Payment has been waived by the organizer, including add-ons." if entry.waive_payment else "Complete the required details, then pay the normal ticket price and any selected extras. Free tickets do not require payment."
            body = (
                f"Dear {entry.name},\n\n"
                f"Good news — a place has become available for you at {event.name}.\n\n"
                f"Event: {event.name}\n"
                f"Date: {event_date}\n"
                f"Location: {location}\n"
                f"Invitation expires: {expiry}\n\n"
                "Complete your registration using the secure link below:\n"
                f"{url}\n\n"
                f"{payment}\n"
                "Your place will be confirmed only after checkout is completed and any required payment is verified.\n\n"
                "IMPORTANT: This invitation link is private and can be used only for your registration. Do not forward, share, or publish it. "
                "If someone else uses the link first, your reserved place may be lost.\n\n"
                "Regards,\nSportPass India\n"
            )
        result = send_email(db, recipient=entry.email, subject=subject, body=body, email_type=f"WAITLIST_{kind.upper()}",
                            reference_type=reference, reference_id=str(entry.id), event_id=event.id)
        if result.success:
            setattr(entry, flag, True)
            entry.email_retry_after = None
            db.commit()
        else:
            entry.email_retry_after = utc_now() + dt.timedelta(minutes=5)
            db.commit()
            return


def recover_once(session_factory):
    with session_factory() as db:
        event_ids = list(db.scalars(select(WaitlistEntry.event_id).where(WaitlistEntry.status.in_(("waiting", "offered", "booked"))).distinct()))
    for event_id in event_ids:
        try:
            with session_factory() as db:
                event = db.scalar(select(Event).where(Event.id == event_id).with_for_update().execution_options(populate_existing=True))
                expired = expire_offers(db, event)
                # Existing payment recovery is authoritative; never free a place
                # based solely on a clock while a payment may have succeeded.
                for entry in db.scalars(select(WaitlistEntry).where(WaitlistEntry.event_id == event_id, WaitlistEntry.status == "booked")).all():
                    registration = db.get(Registration, entry.registration_id)
                    if registration.status in {"confirmed", "checked_in"}:
                        entry.status = "confirmed"
                    elif registration.status in {"expired", "cancelled", "rejected"}:
                        entry.status = "expired"
                        expired += 1
                if expired and enabled(event) and accepting(event):
                    next_entry = db.scalar(select(WaitlistEntry).where(WaitlistEntry.event_id == event_id, WaitlistEntry.status == "waiting").order_by(WaitlistEntry.position).limit(1))
                    if next_entry and not is_full(db, event):
                        try:
                            offer_next(db, event, next_entry, waive_payment=False, actor_id=None)
                        except ValueError:
                            pass
                db.commit()
                pending = list(db.scalars(select(WaitlistEntry).where(WaitlistEntry.event_id == event_id, WaitlistEntry.status.in_(("waiting", "offered")))))
                for entry in pending:
                    try:
                        send_notifications(db, entry)
                    except Exception as exc:
                        db.rollback()
                        logger.warning("waitlist_email_failed entry=%s error=%s", entry.id, type(exc).__name__)
        except Exception as exc:
            logger.warning("waitlist_recovery_failed event=%s error=%s", event_id, type(exc).__name__)


def start_worker(session_factory, engine):
    stop = StopEvent()
    def run():
        while not stop.is_set():
            try:
                with engine.connect() as lock:
                    acquired = engine.dialect.name != "postgresql" or lock.scalar(text("SELECT pg_try_advisory_xact_lock(734019825)"))
                    if acquired:
                        recover_once(session_factory)
            except Exception as exc:
                logger.warning("waitlist_worker_failed error=%s", type(exc).__name__)
            stop.wait(30)
    worker = Thread(target=run, name="waitlist-recovery", daemon=True)
    worker.start()
    return stop, worker
