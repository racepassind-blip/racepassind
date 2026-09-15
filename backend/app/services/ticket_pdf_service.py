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
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from models import Event, Registration

_PAGE_MARGIN = 17 * mm
_CONTENT_WIDTH = A4[0] - (2 * _PAGE_MARGIN)
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
    if start and end:
        if event.start_date and event.end_date and event.start_date.date() == event.end_date.date():
            return f"{event.start_date.strftime('%d %b %Y')} · {event.start_date.strftime('%I:%M %p')} – {event.end_date.strftime('%I:%M %p')}"
        return f"{start} – {end}"
    return start or end or event.date or "Date to be announced"


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
    canvas.line(_PAGE_MARGIN, 10 * mm, A4[0] - _PAGE_MARGIN, 10 * mm)
    canvas.setFillColor(_MUTED)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(_PAGE_MARGIN, 6 * mm, "SportPass India · Participant ticket")
    canvas.drawRightString(A4[0] - _PAGE_MARGIN, 6 * mm, f"Page {document.page}")
    canvas.restoreState()


def build_ticket_pdf(registration: Registration, event: Event, qr_payload: str) -> bytes:
    """Build a clean branded participant ticket without serializing private credentials."""
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

    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=_PAGE_MARGIN,
        leftMargin=_PAGE_MARGIN,
        topMargin=13 * mm,
        bottomMargin=16 * mm,
        title=f"SportPass ticket {registration.registration_reference}",
        author="SportPass India",
        subject="Participant event ticket",
    )
    story: list[object] = []

    header = Table([[
        [Paragraph("SportPass India", styles["brand"]), Paragraph("SECURE EVENT ACCESS", styles["brand_kicker"])],
        [Paragraph("PARTICIPANT TICKET", styles["brand_badge"]), Paragraph("Keep this ticket ready at check-in", styles["brand_badge"])],
    ]], colWidths=[125 * mm, 43 * mm])
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
        Paragraph("VALID TICKET", styles["brand_kicker"]),
    ]
    event_card = Table([[event_left, event_right]], colWidths=[119 * mm, 49 * mm])
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
        *([_field("Members", " / ".join(member_names), styles)] if len(member_names) > 1 else []),
        _field("Ticket", ticket.name if ticket else None, styles),
        _field("Category", category, styles),
        _field("Quantity", registration.quantity, styles),
        _field("Amount", _money(registration.total_amount_paise, currency), styles, accent=True),
        _field("Payment status", _status_label(registration.payment_status), styles),
    ]
    if participant_contact:
        detail_fields.append(_field("Contact", participant_contact, styles))
    detail_rows = []
    for index in range(0, len(detail_fields), 3):
        row = detail_fields[index:index + 3]
        while len(row) < 3:
            row.append([Paragraph("", styles["field_label"])])
        detail_rows.append(row)
    details = Table(detail_rows, colWidths=[56 * mm, 56 * mm, 56 * mm], hAlign="LEFT")
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
    story.extend([details, Spacer(1, 5 * mm)])

    organizer_content = [
        Paragraph("ORGANIZER", styles["section_title"]),
        _paragraph(organizer_name, styles["field_value_accent"]),
    ]
    if organizer_website:
        organizer_content.append(_paragraph(organizer_website, styles["body"]))
    organizer_content.extend([
        Spacer(1, 3 * mm),
        Paragraph("CHECK-IN", styles["section_title"]),
        _paragraph(
            "Checked in" if registration.status == "checked_in" else "Ready for check-in",
            styles["field_value_accent"],
        ),
        Spacer(1, 2 * mm),
        Paragraph("Show this QR at the event entrance. Keep your registration reference available for manual lookup.", styles["body"]),
    ])
    qr_content = [
        _qr_drawing(qr_payload),
        Spacer(1, 1.5 * mm),
        Paragraph("SCAN AT CHECK-IN", styles["field_label"]),
        Paragraph("Opaque ticket credential", styles["qr_caption"]),
    ]
    access_card = Table([[organizer_content, qr_content]], colWidths=[110 * mm, 58 * mm], hAlign="LEFT")
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

    story.extend([
        Spacer(1, 4 * mm),
        HRFlowable(width="100%", thickness=0.7, color=_SPORTPASS_ORANGE, spaceAfter=3 * mm),
        Paragraph(
            "Present this ticket at the event. If event details change, follow the organizer's latest instructions.",
            ParagraphStyle(
                "closing_note",
                parent=styles["body"],
                alignment=TA_CENTER,
                fontSize=7.8,
                leading=10,
            ),
        ),
    ])

    document.build(story, onFirstPage=_draw_page_footer, onLaterPages=_draw_page_footer)
    return buffer.getvalue()
