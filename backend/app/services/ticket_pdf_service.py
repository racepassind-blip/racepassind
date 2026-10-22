from __future__ import annotations

import datetime as dt
import io
from html import escape
from urllib.request import urlopen

from PIL import Image as PilImage
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.config import get_settings
from app.infrastructure.storage.factory import get_storage_service
from app.services.media_service import object_key_from_reference
from models import Event, Registration

_PAGE_MARGIN = 17 * mm
_CONTENT_WIDTH = A4[0] - (2 * _PAGE_MARGIN) - 12  # Default frame padding.
_SPORTPASS_NAVY = colors.HexColor("#102A43")
_SPORTPASS_TEAL = colors.HexColor("#0F7185")
_SPORTPASS_ORANGE = colors.HexColor("#F97316")
_TEXT = colors.HexColor("#1F3445")
_MUTED = colors.HexColor("#657786")
_BORDER = colors.HexColor("#D9E3EA")
_PALE_TEAL = colors.HexColor("#F1F8FA")
_PALE_GRAY = colors.HexColor("#F7F9FB")
_WHITE = colors.white
_ORGANIZATION_LOGO_MAX_BYTES = 2_000_000


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


def _organizer_initials(name: object | None) -> str:
    words = [word for word in str(name or "Organizer").split() if word]
    return "".join(word[0] for word in words[:2]).upper() or "OR"


def _qr_drawing(payload: str, size: float = 43 * mm) -> Drawing:
    widget = qr.QrCodeWidget(payload)
    widget.barWidth = size
    widget.barHeight = size
    drawing = Drawing(size, size)
    drawing.add(widget)
    return drawing


def _organization_logo(organization) -> Image | None:
    """Load an uploaded organization logo for the printable ticket.

    Only private-storage references are fetched. This keeps ticket generation
    from making server-side requests to arbitrary URLs stored on an organizer
    profile, while preserving the existing text-only fallback for legacy URLs.
    """
    object_key = object_key_from_reference(getattr(organization, "logo_url", None))
    if not object_key:
        return None
    try:
        storage = get_storage_service()
        logo_url = storage.get_read_url(object_key, get_settings().storage_signed_url_ttl_seconds)
        with urlopen(logo_url, timeout=5) as response:  # nosec B310 - URL is storage-generated above
            payload = response.read(_ORGANIZATION_LOGO_MAX_BYTES + 1)
        if not payload or len(payload) > _ORGANIZATION_LOGO_MAX_BYTES:
            return None
        # Normalize the validated upload so a malformed or unusual source image
        # cannot break ReportLab later while the document is being written.
        with PilImage.open(io.BytesIO(payload)) as source:
            source.verify()
        with PilImage.open(io.BytesIO(payload)) as source:
            source.thumbnail((300, 300))
            source_width, source_height = source.size
            normalized = io.BytesIO()
            source.convert("RGBA" if source.mode in {"RGBA", "LA"} else "RGB").save(normalized, format="PNG")
        scale = min((15 * mm) / source_width, (15 * mm) / source_height)
        return Image(io.BytesIO(normalized.getvalue()), width=source_width * scale, height=source_height * scale)
    except Exception:
        # A ticket must remain downloadable even if a stored logo was removed
        # or the object store is temporarily unavailable.
        return None


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
    canvas.restoreState()


def _ticket_story(
    registration: Registration,
    event: Event,
    qr_payload: str,
    *,
    bundle_position: int | None = None,
    bundle_total: int | None = None,
) -> list:
    """Shared print layout for individual downloads and emailed ticket bundles."""
    if registration.status not in {"confirmed", "checked_in"}:
        raise ValueError("A ticket PDF is available only for confirmed registrations")
    if not registration.registration_reference:
        raise ValueError("Registration reference is missing")

    organization = event.organization
    ticket = registration.ticket
    participant = registration.participant
    member_names = [member.participant.name for member in registration.participant_memberships] or [participant.name]
    is_group_registration = len(member_names) > 1 or (registration.quantity or 1) > 1
    currency = (ticket.currency if ticket is not None and ticket.currency else "INR").upper()
    category = ticket.category.name if ticket is not None and ticket.category else None
    location = event.location or "Location to be announced"
    address = _event_address(event)
    organizer_name = organization.name if organization is not None else "Event organizer"
    organizer_website = organization.website if organization is not None else None
    organization_logo = _organization_logo(organization) if organization is not None else None

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name="brand",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=15,
        textColor=_WHITE,
    ))
    styles.add(ParagraphStyle(
        name="brand_kicker",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7,
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
        fontSize=22,
        leading=26,
        textColor=_WHITE,
        spaceAfter=5,
    ))
    styles.add(ParagraphStyle(
        name="event_meta",
        parent=styles["Normal"],
        fontSize=9.5,
        leading=13,
        textColor=colors.HexColor("#D6E5EF"),
    ))
    styles.add(ParagraphStyle(
        name="reference",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=14,
        textColor=_WHITE,
        alignment=TA_RIGHT,
    ))
    styles.add(ParagraphStyle(
        name="reference_label",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7,
        leading=9,
        textColor=colors.HexColor("#BFE5EA"),
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
        spaceBefore=4,
        spaceAfter=3,
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
        name="participant_name",
        parent=styles["field_value_accent"],
        fontSize=12,
        leading=15,
    ))
    styles.add(ParagraphStyle(
        name="organizer_initials",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=12,
        alignment=TA_CENTER,
        textColor=_WHITE,
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

    entry_status = "CHECKED IN" if registration.status == "checked_in" else "CONFIRMED"
    entry_instruction = "Entry recorded" if registration.status == "checked_in" else "Valid for one entry"
    header = Table([[
        [Paragraph("SPORTPASS INDIA", styles["brand_kicker"]), Paragraph("ADMISSION TICKET", styles["brand"])],
        [Paragraph(entry_status, styles["brand_badge"]), Paragraph(entry_instruction, styles["brand_badge"])],
    ]], colWidths=[_CONTENT_WIDTH - 48 * mm, 48 * mm], hAlign="LEFT")
    header.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), _SPORTPASS_NAVY),
        ("BACKGROUND", (1, 0), (1, 0), _SPORTPASS_ORANGE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (1, 0), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.extend([header, Spacer(1, 4 * mm)])

    # A logo needs to be its own top-level row. Nesting an image in the dark
    # event card makes ReportLab miscalculate the cell height for some image
    # sources, which can split an otherwise single-page ticket.
    organizer_mark = organization_logo or Paragraph(_organizer_initials(organizer_name), styles["organizer_initials"])
    organizer_mark_background = _WHITE if organization_logo else _SPORTPASS_NAVY
    if organization is not None:
        organizer_brand = Table([[
            organizer_mark,
            [
                Paragraph("PRESENTED BY", styles["field_label"]),
                _paragraph(organizer_name, styles["field_value_accent"]),
            ],
        ]], colWidths=[17 * mm, _CONTENT_WIDTH - 17 * mm], hAlign="LEFT")
        organizer_brand.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), _PALE_GRAY),
            ("BACKGROUND", (0, 0), (0, 0), organizer_mark_background),
            ("BOX", (0, 0), (-1, -1), 0.8, _BORDER),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.extend([organizer_brand, Spacer(1, 3 * mm)])

    event_left = [
        Paragraph("EVENT", styles["brand_kicker"]),
        _paragraph(event.name, styles["event_title"], "Race event"),
        Paragraph(f"{_text(_event_schedule(event))}<br/>{_text(location)}", styles["event_meta"]),
    ]
    if address and address != location:
        event_left.append(_paragraph(address, styles["event_meta"]))
    event_right = [
        _qr_drawing(qr_payload, 35 * mm),
        Spacer(1, 1.5 * mm),
        Paragraph("SCAN TO CHECK IN", styles["qr_caption"]),
    ]
    event_card = Table([[event_left, event_right]], colWidths=[_CONTENT_WIDTH - 59 * mm, 59 * mm], hAlign="LEFT")
    event_card.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), _SPORTPASS_NAVY),
        ("BACKGROUND", (1, 0), (1, 0), _WHITE),
        ("BOX", (0, 0), (-1, -1), 0.8, _BORDER),
        ("LINEBEFORE", (1, 0), (1, 0), 0.8, _BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.extend([event_card, Spacer(1, 3 * mm)])

    reference_content = [_paragraph(registration.registration_reference, styles["field_value_accent"])]
    if bundle_position is not None and bundle_total is not None and bundle_total > 1:
        reference_content.insert(0, Paragraph(f"TICKET {bundle_position} OF {bundle_total}", styles["field_label"]))
    status_line = Table([[
        Paragraph(
            "GROUP REGISTRATION" if is_group_registration else ("ADMISSION CONFIRMED" if registration.status != "checked_in" else "CHECKED IN"),
            styles["brand_badge"],
        ),
        reference_content,
    ]], colWidths=[_CONTENT_WIDTH * 0.52, _CONTENT_WIDTH * 0.48], hAlign="LEFT")
    status_line.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFF1E8")),
        ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#FDBA8C")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.extend([status_line, Spacer(1, 3 * mm)])

    story.append(Paragraph("ATTENDEE DETAILS", styles["section_title"]))
    participant_contact = " · ".join(value for value in [participant.email, participant.phone] if value)
    detail_fields = [
        [Paragraph("PARTICIPANT", styles["field_label"]), _paragraph(participant.name, styles["participant_name"], "Not provided")],
        _field("Ticket", ticket.name if ticket else None, styles),
        _field("Category", category, styles),
        _field("Quantity", registration.quantity, styles),
        _field("Registration total", _money(getattr(registration, "participant_total_paise", None) if getattr(registration, "participant_total_paise", None) is not None else registration.total_amount_paise, currency), styles, accent=True),
        _field("Payment status", _status_label(registration.payment_status), styles),
    ]
    detail_rows = []
    for index in range(0, len(detail_fields), 2):
        row = detail_fields[index:index + 2]
        while len(row) < 2:
            row.append([Paragraph("", styles["field_label"])])
        detail_rows.append(row)
    if participant_contact:
        detail_rows.append([_field("Registration contact", participant_contact, styles), ""])
    if len(member_names) > 1:
        participant_list = "<br/>".join(
            f"{index}. {_text(name)}" for index, name in enumerate(member_names, start=1)
        )
        detail_rows.append([
            [Paragraph("REGISTERED PARTICIPANTS", styles["field_label"]), Paragraph(participant_list, styles["field_value"])],
            "",
        ])
    details = Table(detail_rows, colWidths=[_CONTENT_WIDTH / 2] * 2, hAlign="LEFT")
    details.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), _WHITE),
        ("BOX", (0, 0), (-1, -1), 0.8, _BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.45, _BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    if participant_contact:
        contact_row = len(detail_rows) - (2 if len(member_names) > 1 else 1)
        details.setStyle(TableStyle([("SPAN", (0, contact_row), (-1, contact_row))]))
    if len(member_names) > 1:
        details.setStyle(TableStyle([("SPAN", (0, len(detail_rows) - 1), (-1, len(detail_rows) - 1))]))
    story.extend([details, Spacer(1, 3 * mm)])

    # Add-ons are part of the paid/confirmed ticket, so show them on the
    # printable ticket while keeping the QR payload opaque.
    addon_defs = {
        addon.get("id"): addon
        for addon in (getattr(event, "addon_config", {}) or {}).get("addons", [])
        if isinstance(addon, dict) and addon.get("id")
    }
    selections = getattr(registration, "selections", {}) or {}
    if addon_defs and isinstance(selections, dict):
        addon_rows = []
        for addon_id, addon in addon_defs.items():
            selection = selections.get(addon_id)
            if not isinstance(selection, dict):
                continue
            if "selected" in selection:
                value = str(selection.get("selected") or "")
            elif "qty" in selection:
                value = f"Quantity: {selection.get('qty')}"
            else:
                continue
            if value:
                addon_rows.append([_paragraph(addon.get("name", addon_id), styles["field_value"]), _paragraph(value, styles["field_value_accent"])])
        if addon_rows:
            story.append(Paragraph("YOUR EXTRAS", styles["section_title"]))
            addon_table = Table(addon_rows, colWidths=[_CONTENT_WIDTH * 0.62, _CONTENT_WIDTH * 0.38], hAlign="LEFT")
            addon_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), _PALE_GRAY),
                ("BOX", (0, 0), (-1, -1), 0.8, _BORDER),
                ("INNERGRID", (0, 0), (-1, -1), 0.45, _BORDER),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ]))
            story.extend([addon_table, Spacer(1, 3 * mm)])

    organizer_content = [
        Paragraph("EVENT SUPPORT", styles["section_title"]),
        _paragraph(organizer_name, styles["field_value_accent"]),
    ]
    if organizer_website:
        organizer_content.append(_paragraph(organizer_website, styles["body"]))
    organizer_location = ", ".join(str(value) for value in [getattr(organization, "city", None), getattr(organization, "state", None)] if value)
    if organizer_location:
        organizer_content.append(_paragraph(organizer_location, styles["body"]))
    organizer_content.extend([
        Spacer(1, 2 * mm),
        Paragraph("Present this pass at check-in. Contact the organizer for event-specific instructions.", styles["body"]),
        Spacer(1, 3 * mm),
        Paragraph("AT CHECK-IN", styles["section_title"]),
        Paragraph("Show the QR code above, or give the team your name and registration reference.", styles["body_dark"]),
    ])
    rules = _rule_items(event.rules)
    if rules:
        organizer_content.extend([Spacer(1, 2 * mm), Paragraph("EVENT INSTRUCTIONS", styles["section_title"])])
        organizer_content.extend(Paragraph(f"• {_text(rule)}", styles["rule"]) for rule in rules)
    access_card = Table([[organizer_content]], colWidths=[_CONTENT_WIDTH], hAlign="LEFT")
    access_card.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), _PALE_GRAY),
        ("BOX", (0, 0), (-1, -1), 0.8, _BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(access_card)

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
    bundle_total = len(registrations)
    for index, (registration, payload) in enumerate(zip(registrations, qr_payloads, strict=True), start=1):
        if index > 1:
            story.append(PageBreak())
        story.extend(_ticket_story(
            registration,
            event,
            payload,
            bundle_position=index if bundle_total > 1 else None,
            bundle_total=bundle_total if bundle_total > 1 else None,
        ))
    document.build(story, onFirstPage=_draw_page_footer, onLaterPages=_draw_page_footer)
    return buffer.getvalue()


def build_ticket_pdf(registration: Registration, event: Event, qr_payload: str) -> bytes:
    return _build_tickets_pdf([registration], event, [qr_payload])
