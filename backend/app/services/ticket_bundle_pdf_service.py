import io

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from models import Event, Registration
from app.services.ticket_pdf_service import (
    _BORDER,
    _MUTED,
    _PALE_GRAY,
    _PALE_TEAL,
    _RACEPASS_NAVY,
    _RACEPASS_ORANGE,
    _RACEPASS_TEAL,
    _TEXT,
    _WHITE,
    _draw_page_footer,
    _event_address,
    _event_schedule,
    _field,
    _money,
    _paragraph,
    _qr_drawing,
    _status_label,
    _text,
)

_PAGE_MARGIN = 17 * mm


def _ticket_styles():
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name="bundle_brand",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=22,
        textColor=_WHITE,
    ))
    styles.add(ParagraphStyle(
        name="bundle_kicker",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=10,
        textColor=colors.HexColor("#BFE5EA"),
        tracking=1,
    ))
    styles.add(ParagraphStyle(
        name="bundle_badge",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=_RACEPASS_NAVY,
        alignment=TA_CENTER,
    ))
    styles.add(ParagraphStyle(
        name="bundle_event_title",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        textColor=_RACEPASS_NAVY,
        spaceAfter=5,
    ))
    styles.add(ParagraphStyle(
        name="bundle_event_meta",
        parent=styles["Normal"],
        fontSize=9.5,
        leading=13,
        textColor=_MUTED,
    ))
    styles.add(ParagraphStyle(
        name="bundle_reference",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=14,
        textColor=_RACEPASS_NAVY,
        alignment=TA_RIGHT,
    ))
    styles.add(ParagraphStyle(
        name="bundle_reference_label",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7,
        leading=9,
        textColor=_RACEPASS_TEAL,
        alignment=TA_RIGHT,
    ))
    styles.add(ParagraphStyle(
        name="bundle_section_title",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=_RACEPASS_TEAL,
        spaceBefore=7,
        spaceAfter=5,
        tracking=0.8,
    ))
    styles.add(ParagraphStyle(
        name="bundle_field_label",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=6.8,
        leading=8,
        textColor=_MUTED,
        spaceAfter=2,
        tracking=0.3,
    ))
    styles.add(ParagraphStyle(
        name="bundle_field_value",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9.2,
        leading=12,
        textColor=_TEXT,
    ))
    styles.add(ParagraphStyle(
        name="bundle_field_value_accent",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9.2,
        leading=12,
        textColor=_RACEPASS_NAVY,
    ))
    styles.add(ParagraphStyle(
        name="bundle_body",
        parent=styles["Normal"],
        fontSize=8.5,
        leading=12,
        textColor=_MUTED,
    ))
    styles.add(ParagraphStyle(
        name="bundle_qr_caption",
        parent=styles["Normal"],
        fontSize=7.5,
        leading=10,
        textColor=_MUTED,
        alignment=TA_CENTER,
    ))
    return styles


def _bundle_ticket_story(registration: Registration, event: Event, qr_payload: str, styles) -> list[object]:
    organization = event.organization
    ticket = registration.ticket
    participant = registration.participant
    currency = (ticket.currency if ticket is not None and ticket.currency else "INR").upper()
    category = ticket.category.name if ticket is not None and ticket.category else None
    location = event.location or "Location to be announced"
    address = _event_address(event)
    organizer_name = organization.name if organization is not None else "Event organizer"
    organizer_website = organization.website if organization is not None else None

    story: list[object] = []
    header = Table([[
        [Paragraph("RacePass India", styles["bundle_brand"]), Paragraph("SECURE EVENT ACCESS", styles["bundle_kicker"])],
        [Paragraph("PARTICIPANT TICKET", styles["bundle_badge"]), Paragraph("Keep this ticket ready at check-in", styles["bundle_badge"])],
    ]], colWidths=[125 * mm, 43 * mm])
    header.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), _RACEPASS_NAVY),
        ("BACKGROUND", (1, 0), (1, 0), _RACEPASS_ORANGE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (1, 0), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    story.extend([header, Spacer(1, 7 * mm)])

    event_left = [
        Paragraph("EVENT", styles["bundle_section_title"]),
        _paragraph(event.name, styles["bundle_event_title"], "Race event"),
        _paragraph(_event_schedule(event), styles["bundle_event_meta"]),
        _paragraph(location, styles["bundle_event_meta"]),
    ]
    if address and address != location:
        event_left.append(_paragraph(address, styles["bundle_event_meta"]))
    event_right = [
        Paragraph("REGISTRATION REFERENCE", styles["bundle_reference_label"]),
        _paragraph(registration.registration_reference, styles["bundle_reference"]),
        Spacer(1, 2 * mm),
        Paragraph("VALID TICKET", styles["bundle_kicker"]),
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

    story.append(Paragraph("REGISTRATION DETAILS", styles["bundle_section_title"]))
    participant_contact = " · ".join(value for value in [participant.email, participant.phone] if value)
    detail_fields = [
        _field("Participant", participant.name, {
            "field_label": styles["bundle_field_label"],
            "field_value": styles["bundle_field_value"],
            "field_value_accent": styles["bundle_field_value_accent"],
        }, accent=True),
        _field("Ticket", ticket.name if ticket else None, {
            "field_label": styles["bundle_field_label"],
            "field_value": styles["bundle_field_value"],
            "field_value_accent": styles["bundle_field_value_accent"],
        }),
        _field("Category", category, {
            "field_label": styles["bundle_field_label"],
            "field_value": styles["bundle_field_value"],
            "field_value_accent": styles["bundle_field_value_accent"],
        }),
        _field("Quantity", registration.quantity, {
            "field_label": styles["bundle_field_label"],
            "field_value": styles["bundle_field_value"],
            "field_value_accent": styles["bundle_field_value_accent"],
        }),
        _field("Amount", _money(registration.total_amount_paise, currency), {
            "field_label": styles["bundle_field_label"],
            "field_value": styles["bundle_field_value"],
            "field_value_accent": styles["bundle_field_value_accent"],
        }, accent=True),
        _field("Payment status", _status_label(registration.payment_status), {
            "field_label": styles["bundle_field_label"],
            "field_value": styles["bundle_field_value"],
            "field_value_accent": styles["bundle_field_value_accent"],
        }),
    ]
    if participant_contact:
        detail_fields.append(_field("Contact", participant_contact, {
            "field_label": styles["bundle_field_label"],
            "field_value": styles["bundle_field_value"],
            "field_value_accent": styles["bundle_field_value_accent"],
        }))
    detail_rows = []
    for index in range(0, len(detail_fields), 3):
        row = detail_fields[index:index + 3]
        while len(row) < 3:
            row.append([Paragraph("", styles["bundle_field_label"])])
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
        Paragraph("ORGANIZER", styles["bundle_section_title"]),
        _paragraph(organizer_name, styles["bundle_field_value_accent"]),
    ]
    if organizer_website:
        organizer_content.append(_paragraph(organizer_website, styles["bundle_body"]))
    organizer_content.extend([
        Spacer(1, 3 * mm),
        Paragraph("CHECK-IN", styles["bundle_section_title"]),
        _paragraph(
            "Checked in" if registration.status == "checked_in" else "Ready for check-in",
            styles["bundle_field_value_accent"],
        ),
        Spacer(1, 2 * mm),
        Paragraph("Show this QR at the event entrance. Keep your registration reference available for manual lookup.", styles["bundle_body"]),
    ])
    qr_content = [
        _qr_drawing(qr_payload),
        Spacer(1, 1.5 * mm),
        Paragraph("SCAN AT CHECK-IN", styles["bundle_field_label"]),
        Paragraph("Opaque ticket credential", styles["bundle_qr_caption"]),
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
    story.extend([
        Spacer(1, 4 * mm),
        Paragraph(
            "Present this ticket at the event. If event details change, follow the organizer's latest instructions.",
            ParagraphStyle(
                f"bundle_closing_{registration.id}",
                parent=styles["bundle_body"],
                alignment=TA_CENTER,
                fontSize=7.8,
                leading=10,
            ),
        ),
    ])
    return story


def build_ticket_bundle_pdf(registrations: list[Registration], event: Event, qr_payloads: list[str]) -> bytes:
    """Build one PDF containing one complete ticket page per confirmed registration."""
    if not registrations or len(registrations) != len(qr_payloads):
        raise ValueError("Ticket bundle data is invalid")
    for registration in registrations:
        if registration.status not in {"confirmed", "checked_in"}:
            raise ValueError("A ticket PDF is available only for confirmed registrations")
        if not registration.registration_reference:
            raise ValueError("Registration reference is missing")

    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=_PAGE_MARGIN,
        leftMargin=_PAGE_MARGIN,
        topMargin=13 * mm,
        bottomMargin=16 * mm,
        title="RacePass participant tickets",
        author="RacePass India",
        subject="Participant event tickets",
    )
    styles = _ticket_styles()
    story: list[object] = []
    for index, (registration, qr_payload) in enumerate(zip(registrations, qr_payloads, strict=True)):
        if index:
            story.append(PageBreak())
        story.extend(_bundle_ticket_story(registration, event, qr_payload, styles))
    document.build(story, onFirstPage=_draw_page_footer, onLaterPages=_draw_page_footer)
    return buffer.getvalue()
