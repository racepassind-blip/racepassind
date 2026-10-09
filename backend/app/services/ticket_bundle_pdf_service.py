from models import Event, Registration
from app.services.ticket_pdf_service import _build_tickets_pdf


def build_ticket_bundle_pdf(registrations: list[Registration], event: Event, qr_payloads: list[str]) -> bytes:
    """Use the same organizer-first layout for email bundles and downloads."""
    return _build_tickets_pdf(registrations, event, qr_payloads)
