"""Builds the content (subject, body, html, PDF attachment) for registration
confirmation emails.

This module owns ONLY the email content/formatting. It does not talk to SMTP
or Gmail - that stays in email_service.py. This keeps provider logic separate
from content, so switching providers later requires no changes here.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.services.ticket_bundle_pdf_service import build_ticket_bundle_pdf
from app.services.ticket_pdf_service import build_ticket_pdf
from app.services.ticket_service import verified_ticket_qr_payload
from models import Event, Registration


def _format_datetime(value: dt.datetime | None) -> str:
    if value is None:
        return "To be announced"
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt.timezone.utc)
    return value.strftime("%d %b %Y, %I:%M %p")


def _event_location(event: Event) -> str:
    parts = [event.location_name, event.address, event.city, event.state, event.country]
    return ", ".join(str(p) for p in parts if p) or "To be announced"


def _money(amount_paise: int | None) -> str:
    if not amount_paise:
        return "Free"
    return f"₹{amount_paise / 100:,.2f}"


def build_registration_confirmation_content(
    db: Session,
    registration: Registration,
) -> dict:
    """Build the full email content for a registration confirmation.

    Returns a dict with: recipient, subject, body, html_body, attachments,
    event (the loaded Event), or {"recipient": None} if there is no email.
    """
    responses = registration.responses or {}
    recipient = responses.get("email")
    if not recipient and registration.participant is not None:
        recipient = registration.participant.email

    if not recipient:
        return {"recipient": None}

    participant_name = responses.get("full_name") or "Participant"

    event = db.scalar(
        select(Event).options(selectinload(Event.organization)).where(Event.id == registration.event_id)
    )
    event_name = event.name if event is not None else "the event"
    location = _event_location(event) if event is not None else "To be announced"
    start = _format_datetime(event.start_date) if event is not None else "To be announced"
    reference = registration.registration_reference or ""
    ticket_name = registration.ticket.name if registration.ticket is not None else "General"
    category = (
        registration.ticket.category.name
        if registration.ticket is not None and registration.ticket.category is not None
        else None
    )
    total_paid = _money(registration.total_amount_paise)
    whatsapp_url = event.whatsapp_group_url if event is not None else None

    is_confirmed = registration.status in {"confirmed", "checked_in"}

    subject = f"Your ticket for {event_name}" if is_confirmed else f"Registration received — {event_name}"

    # Plain-text body
    if is_confirmed:
        intro = f"Your registration for {event_name} is confirmed. Your ticket is attached as a PDF."
        qr_note = "Please carry the QR code in the attached PDF for check-in at the event."
    else:
        intro = f"We've received your registration for {event_name}. Your payment is being reviewed — you'll receive your ticket PDF with QR code once your payment is confirmed."
        qr_note = "Your QR code ticket will be sent in a follow-up email once payment is confirmed."

    lines = [
        f"Hi {participant_name},",
        "",
        intro,
        "",
        "TICKET DETAILS",
        f"  Reference: {reference}",
        f"  Ticket: {ticket_name}" + (f" ({category})" if category else ""),
        f"  Total paid: {total_paid}",
        "",
        "EVENT DETAILS",
        f"  Event: {event_name}",
        f"  When: {start}",
        f"  Where: {location}",
    ]
    if whatsapp_url:
        lines += ["", f"Join the event WhatsApp community: {whatsapp_url}"]
    lines += ["", qr_note, "", "See you there!"]
    body = "\n".join(lines)

    # HTML body
    whatsapp_html = (
        f'<p><a href="{whatsapp_url}" style="color:#16a34a;font-weight:bold;">Join the event WhatsApp community</a></p>'
        if whatsapp_url
        else ""
    )
    category_html = f" ({category})" if category else ""
    if is_confirmed:
        status_para = "<p>Your registration is <strong>confirmed</strong>. Your ticket is attached as a PDF with your QR code for check-in.</p>"
        qr_para = '<p style="color:#666;font-size:13px;margin-top:16px;">Please carry the QR code in the attached PDF for check-in.</p>'
    else:
        status_para = "<p>We've received your registration. Your <strong>payment is under review</strong> — once confirmed, you'll receive a follow-up email with your ticket PDF and QR code.</p>"
        qr_para = '<p style="color:#666;font-size:13px;margin-top:16px;">Your QR code ticket will be sent once your payment is confirmed.</p>'

    html_body = f"""<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111;">
  <h2 style="color:#111;">{"Your ticket for" if is_confirmed else "Registration received —"} {event_name}</h2>
  <p>Hi {participant_name},</p>
  {status_para}
  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <tr><td style="padding:6px 0;color:#666;">Reference</td><td style="padding:6px 0;font-weight:bold;">{reference}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">Ticket</td><td style="padding:6px 0;font-weight:bold;">{ticket_name}{category_html}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">Total paid</td><td style="padding:6px 0;font-weight:bold;">{total_paid}</td></tr>
  </table>
  <h3 style="color:#111;margin-bottom:4px;">Event details</h3>
  <table style="width:100%;border-collapse:collapse;margin:8px 0;">
    <tr><td style="padding:6px 0;color:#666;">Event</td><td style="padding:6px 0;">{event_name}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">When</td><td style="padding:6px 0;">{start}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">Where</td><td style="padding:6px 0;">{location}</td></tr>
  </table>
  {whatsapp_html}
  {qr_para}
</div>"""

    # Build the ticket PDF attachment (best-effort; skip if not available yet)
    attachments: list[tuple[str, bytes]] = []
    if event is not None:
        try:
            qr_payload = verified_ticket_qr_payload(registration)
            if qr_payload is not None:
                pdf = build_ticket_pdf(registration, event, qr_payload)
                safe_ref = reference or str(registration.id)
                attachments.append((f"SportPass-Ticket-{safe_ref}.pdf", pdf))
        except (RuntimeError, ValueError):
            # PDF unavailable (e.g. unconfirmed) - send email without attachment.
            attachments = []

    return {
        "recipient": recipient,
        "subject": subject,
        "body": body,
        "html_body": html_body,
        "attachments": attachments,
        "event": event,
    }
