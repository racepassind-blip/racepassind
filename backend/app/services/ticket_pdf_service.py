from __future__ import annotations

import datetime as dt
import io
from html import escape

from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from models import Event, Registration

_PAGE_MARGIN = 17 * mm
_CONTENT_WIDTH = A4[0] - (2 * _PAGE_MARGIN) - 12  # Default frame padding.
_SPORTPASS_NAVY = colors.HexColor("#102A43")
_SPORTPASS_TEAL = colors.HexColor("#0F7185")
_SPORTPASS_ORANGE = colors.HexColor("#E9941A")
_TEXT = colors.HexColor("#1F3445")
_MUTED = colors.HexColor("#657786")
_BORDER = colors.HexColor("#D9E3EA")
_PALE_TEAL = colors.HexColor("#F1F8FA")
_PALE_GRAY = colors.HexColor("#F7F9FB")
_WHITE = colors.white


def _text(value: object | None, fallback: str = "") -> str:
    return escape(str(value)) if value not in (None, "") else fallback


def _paragraph(value: object | None, style: ParagraphStyle, fallback: str = "") -> Paragraph:
    return Paragraph(_text(value, fallback), style)


def _format_datetime(value: dt.datetime | None) -> str | None:
    if value is None:
        return None
    return value.strftime("%d %b %Y, %I:%M %p")


def _event_schedule(event: Event) -> str:
    start = _format_datetime(event.start_date)
    end = _format_datetime(event.end_date)
    start_is_date_only = bool(event.start_date and event.start_date.time() == dt.time.min)
    end_is_date_only = bool(event.end_date and event.end_date.time() == dt.time.min)
    if start and end:
        if start_is_date_only and end_is_date_only:
            if event.start_date and event.end_date and event.start_date.date() == event.end_date.date():
                return event.start_date.strftime("%d %b %Y")
            return f"{event.start_date.strftime('%d %b %Y')} – {event.end_date.strftime('%d %b %Y')}"
        if event.start_date and event.end_date and event.start_date.date() == event.end_date.date():
            return f"{event.start_date.strftime('%d %b %Y')} · {event.start_date.strftime('%I:%M %p')} – {event.end_date.strftime('%I:%M %p')}"
        return f"{start} – {end}"
    if event.start_date and start_is_date_only:
        return event.start_date.strftime("%d %b %Y")
    if start or end:
        return start or end
    try:
        return dt.date.fromisoformat(str(event.date)).strftime("%d %b %Y")
    except (TypeError, ValueError):
        return event.date or "Date to be announced"


def _event_address(event: Event) -> str:
    parts = [event.address, event.city, event.state, event.country]
    return ", ".join(str(part).strip() for part in parts if part and str(part).strip())


def _money(amount_paise: int | None, currency: str) -> str:
    amount = (amount_paise or 0) / 100
    return f"{currency} {amount:,.2f}"


def _status_label(status: str | None) -> str:
    return {
        "approved": "Paid and approved",
        "not_required": "No payment required",
        "checked_in": "Checked in",
    }.get(status or "", (status or "Not available").replace("_", " ").title())


def _rule_items(rules: object) -> list[str]:
    if not isinstance(rules, list):
        return []
    return [str(rule).strip() for rule in rules if str(rule).strip()]


def _qr_drawing(payload: str, size: float = 43 * mm) -> Drawing:
    widget = qr.QrCodeWidget(payload)
    widget.barWidth = size
    widget.barHeight = size
    drawing = Drawing(size, size)
    drawing.add(widget)
    return drawing


def _field(label: str, value: object | None, styles: dict[str, ParagraphStyle], *, accent: bool = False) -> list[Paragraph]:
    return [
        Paragraph(_text(label).upper(), styles["field_label"]),
        _paragraph(value, styles["field_value_accent" if accent else "field_value"], "Not provided"),
    ]


def _draw_page_footer(canvas, document) -> None:
    canvas.saveState()
    canvas.setStrokeColor(_BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(_PAGE_MARGIN + 6, 10 * mm, A4[0] - _PAGE_MARGIN - 6, 10 * mm)
    canvas.setFillColor(_MUTED)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(_PAGE_MARGIN + 6, 6 * mm, "Ticketing powered by SportPass India")
    canvas.drawRightString(A4[0] - _PAGE_MARGIN - 6, 6 * mm, f"Page {document.page}")
    canvas.restoreState()


def _ticket_story(registration: Registration, event: Event, qr_payload: str) -> list:
    """Shared print layout for individual downloads and emailed ticket bundles."""
    if registration.status not in {"confirmed", "checked_in"}:
        raise ValueError("A ticket PDF is available only for confirmed registrations")
    if not registration.registration_reference:
        raise ValueError("Registration reference is missing")

    organization = event.organization
    ticket = registration.ticket
    participant = registration.participant
    member_names = [member.participant.name for member in registration.participant_memberships] or [participant.name]
    currency = (ticket.currency if ticket is not None and ticket.currency else "INR").upper()
    category = ticket.category.name if ticket is not None and ticket.category else None
    location = event.location or "Location to be announced"
    address = _event_address(event)
    organizer_name = organization.name if organization is not None else "Event organizer"
    organizer_website = organization.website if organization is not None else None

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name="brand",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=22,
        textColor=_WHITE,
    ))
    styles.add(ParagraphStyle(
        name="brand_kicker",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=10,
        textColor=colors.HexColor("#BFE5EA"),
        tracking=1,
    ))
    styles.add(ParagraphStyle(
        name="brand_badge",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=_SPORTPASS_NAVY,
        alignment=TA_CENTER,
    ))
    styles.add(ParagraphStyle(
        name="event_title",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        textColor=_SPORTPASS_NAVY,
        spaceAfter=5,
    ))
    styles.add(ParagraphStyle(
        name="event_meta",
        parent=styles["Normal"],
        fontSize=9.5,
        leading=13,
        textColor=_MUTED,
    ))
    styles.add(ParagraphStyle(
        name="reference",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=14,
        textColor=_SPORTPASS_NAVY,
        alignment=TA_RIGHT,
    ))
    styles.add(ParagraphStyle(
        name="reference_label",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7,
        leading=9,
        textColor=_SPORTPASS_TEAL,
        alignment=TA_RIGHT,
    ))
    styles.add(ParagraphStyle(
        name="section_title",
        parent=styles["Heading2"],
        keepWithNext=True,
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=_SPORTPASS_TEAL,
        spaceBefore=7,
        spaceAfter=5,
        tracking=0.8,
    ))
    styles.add(ParagraphStyle(
        name="field_label",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=6.8,
        leading=8,
        textColor=_MUTED,
        spaceAfter=2,
        tracking=0.3,
    ))
    styles.add(ParagraphStyle(
        name="field_value",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9.2,
        leading=12,
        textColor=_TEXT,
    ))
    styles.add(ParagraphStyle(
        name="field_value_accent",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9.2,
        leading=12,
        textColor=_SPORTPASS_NAVY,
    ))
    styles.add(ParagraphStyle(
        name="body",
        parent=styles["Normal"],
        fontSize=8.5,
        leading=12,
        textColor=_MUTED,
    ))
    styles.add(ParagraphStyle(
        name="body_dark",
        parent=styles["Normal"],
        fontSize=8.5,
        leading=12,
        textColor=_TEXT,
    ))
    styles.add(ParagraphStyle(
        name="qr_caption",
        parent=styles["Normal"],
        fontSize=7.5,
        leading=10,
        textColor=_MUTED,
        alignment=TA_CENTER,
    ))
    styles.add(ParagraphStyle(
        name="rule",
        parent=styles["Normal"],
        fontSize=8.2,
        leading=11,
        leftIndent=8,
        firstLineIndent=-8,
        textColor=_MUTED,
        spaceAfter=3,
    ))

    story: list[object] = []

    header = Table([[
        [Paragraph("ORGANIZED BY", styles["brand_kicker"]), _paragraph(organizer_name, styles["brand"])],
        [Paragraph("EVENT TICKET", styles["brand_badge"]), Paragraph("Keep ready at check-in", styles["brand_badge"])],
    ]], colWidths=[_CONTENT_WIDTH - 48 * mm, 48 * mm], hAlign="LEFT")
    header.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), _SPORTPASS_NAVY),
        ("BACKGROUND", (1, 0), (1, 0), _SPORTPASS_ORANGE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (1, 0), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    story.extend([header, Spacer(1, 7 * mm)])

    event_left = [
        Paragraph("EVENT", styles["section_title"]),
        _paragraph(event.name, styles["event_title"], "Race event"),
        _paragraph(_event_schedule(event), styles["event_meta"]),
        _paragraph(location, styles["event_meta"]),
    ]
    if address and address != location:
        event_left.append(_paragraph(address, styles["event_meta"]))
    event_right = [
        Paragraph("REGISTRATION REFERENCE", styles["reference_label"]),
        _paragraph(registration.registration_reference, styles["reference"]),
        Spacer(1, 2 * mm),
        Paragraph("CHECKED IN" if registration.status == "checked_in" else "REGISTRATION CONFIRMED", styles["reference_label"]),
    ]
    event_card = Table([[event_left, event_right]], colWidths=[_CONTENT_WIDTH - 52 * mm, 52 * mm], hAlign="LEFT")
    event_card.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), _PALE_TEAL),
        ("BACKGROUND", (1, 0), (1, 0), colors.HexColor("#E4F2F4")),
        ("BOX", (0, 0), (-1, -1), 0.8, _BORDER),
        ("LINEBEFORE", (1, 0), (1, 0), 0.8, _BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.extend([event_card, Spacer(1, 5 * mm)])

    story.append(Paragraph("REGISTRATION DETAILS", styles["section_title"]))
    participant_contact = " · ".join(value for value in [participant.email, participant.phone] if value)
    detail_fields = [
        _field("Participant", participant.name, styles, accent=True),
        _field("Ticket", ticket.name if ticket else None, styles),
        _field("Category", category, styles),
        _field("Quantity", registration.quantity, styles),
        _field("Registration total", _money(getattr(registration, "participant_total_paise", None) if getattr(registration, "participant_total_paise", None) is not None else registration.total_amount_paise, currency), styles, accent=True),
        _field("Payment status", _status_label(registration.payment_status), styles),
    ]
    detail_rows = []
    for index in range(0, len(detail_fields), 3):
        row = detail_fields[index:index + 3]
        while len(row) < 3:
            row.append([Paragraph("", styles["field_label"])])
        detail_rows.append(row)
    if participant_contact:
        detail_rows.append([_field("Registration contact", participant_contact, styles), "", ""])
    if len(member_names) > 1:
        detail_rows.append([_field("Registered participants", " / ".join(member_names), styles), "", ""])
    details = Table(detail_rows, colWidths=[_CONTENT_WIDTH / 3] * 3, hAlign="LEFT")
    details.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), _WHITE),
        ("BOX", (0, 0), (-1, -1), 0.8, _BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.45, _BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    if participant_contact:
        contact_row = len(detail_rows) - (2 if len(member_names) > 1 else 1)
        details.setStyle(TableStyle([("SPAN", (0, contact_row), (-1, contact_row))]))
    if len(member_names) > 1:
        details.setStyle(TableStyle([("SPAN", (0, len(detail_rows) - 1), (-1, len(detail_rows) - 1))]))
    story.extend([details, Spacer(1, 5 * mm)])

    organizer_content = [
        Paragraph("ORGANIZER", styles["section_title"]),
        _paragraph(organizer_name, styles["field_value_accent"]),
    ]
    if organizer_website:
        organizer_content.append(_paragraph(organizer_website, styles["body"]))
    organizer_location = ", ".join(str(value) for value in [getattr(organization, "city", None), getattr(organization, "state", None)] if value)
    if organizer_location:
        organizer_content.append(_paragraph(organizer_location, styles["body"]))
    organizer_content.extend([
        Spacer(1, 2 * mm),
        Paragraph("For event arrangements, pickup instructions and refund queries, contact the organizer through the details on the event page.", styles["body"]),
        Paragraph("SportPass India provides registration and ticketing. The organizer conducts the event.", styles["body"]),
    ])
    organizer_content.extend([
        Spacer(1, 3 * mm),
        Paragraph("CHECK-IN", styles["section_title"]),
        _paragraph(
            "Checked in" if registration.status == "checked_in" else "Ready for check-in",
            styles["field_value_accent"],
        ),
        Spacer(1, 2 * mm),
        Paragraph("Show this QR at each event checkpoint, or give the check-in team your name and registration number. This ticket covers the named registration and its listed participants.", styles["body"]),
    ])
    qr_content = [
        _qr_drawing(qr_payload),
        Spacer(1, 1.5 * mm),
        Paragraph("SCAN AT CHECK-IN", styles["qr_caption"]),
        Paragraph("Keep the full QR visible", styles["qr_caption"]),
    ]
    access_card = Table([[organizer_content, qr_content]], colWidths=[_CONTENT_WIDTH - 58 * mm, 58 * mm], hAlign="LEFT")
    access_card.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), _PALE_GRAY),
        ("BACKGROUND", (1, 0), (1, 0), _WHITE),
        ("BOX", (0, 0), (-1, -1), 0.8, _BORDER),
        ("LINEBEFORE", (1, 0), (1, 0), 0.8, _BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    story.append(access_card)

    story.extend([
        Spacer(1, 3 * mm),
        Paragraph("TICKET VALIDITY", styles["section_title"]),
        Paragraph("Issued for a confirmed registration for the event, date and participants shown above. Admission depends on the current registration status verified by the check-in team. A downloaded PDF does not override a later cancellation or refund. Duplicate scans are checked at each checkpoint.", styles["body_dark"]),
    ])

    if event.description:
        story.extend([
            Spacer(1, 3 * mm),
            Paragraph("ABOUT THIS EVENT", styles["section_title"]),
            _paragraph(event.description, styles["body_dark"]),
        ])

    rules = _rule_items(event.rules)
    if rules:
        story.extend([Spacer(1, 2 * mm), Paragraph("EVENT RULES & INSTRUCTIONS", styles["section_title"])])
        story.extend(Paragraph(f"• {_text(rule)}", styles["rule"]) for rule in rules)

    return story


def _build_tickets_pdf(registrations: list[Registration], event: Event, qr_payloads: list[str]) -> bytes:
    if not registrations or len(registrations) != len(qr_payloads):
        raise ValueError("Ticket bundle data is invalid")
    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer, pagesize=A4, rightMargin=_PAGE_MARGIN, leftMargin=_PAGE_MARGIN,
        topMargin=13 * mm, bottomMargin=16 * mm,
        title=f"{event.name} - participant tickets", author="SportPass India",
        subject="Confirmed event registrations",
    )
    story: list[object] = []
    for index, (registration, payload) in enumerate(zip(registrations, qr_payloads, strict=True)):
        if index:
            story.append(PageBreak())
        story.extend(_ticket_story(registration, event, payload))
    document.build(story, onFirstPage=_draw_page_footer, onLaterPages=_draw_page_footer)
    return buffer.getvalue()


def build_ticket_pdf(registration: Registration, event: Event, qr_payload: str) -> bytes:
    return _build_tickets_pdf([registration], event, [qr_payload])
