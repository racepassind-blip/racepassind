from __future__ import annotations

import base64
import hashlib
import hmac
from urllib.parse import urlencode

from app.config import get_settings
from app.services.auth_service import hash_opaque_token
from app.services.payment_service import generate_qr_data_url
from models import Registration

_TICKET_VERSION = "1"


def _ticket_signing_key(registration: Registration) -> bytes:
    settings = get_settings()
    configured_key = settings.ticket_signing_secret or settings.session_secret
    if configured_key:
        return configured_key.encode("utf-8")
    if not settings.is_production and registration.confirmation_token_hash:
        # Development fallback keeps local setup usable; production requires TICKET_SIGNING_SECRET.
        return registration.confirmation_token_hash.encode("utf-8")
    raise RuntimeError("Ticket signing configuration is missing")


def ticket_token_for_registration(registration: Registration) -> str:
    if not registration.confirmation_token_hash:
        raise ValueError("Registration confirmation credential is missing")
    message = f"racepass-ticket:{_TICKET_VERSION}:{registration.id}".encode("utf-8")
    digest = hmac.new(_ticket_signing_key(registration), message + registration.confirmation_token_hash.encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def ticket_qr_payload(ticket_token: str) -> str:
    return "racepass://ticket?" + urlencode({"v": _TICKET_VERSION, "t": ticket_token})


def serialize_ticket(registration: Registration) -> dict | None:
    if registration.status not in {"confirmed", "checked_in"} or not registration.ticket_token_hash:
        return None
    ticket_token = ticket_token_for_registration(registration)
    if not hmac.compare_digest(hash_opaque_token(ticket_token), registration.ticket_token_hash):
        return None
    payload = ticket_qr_payload(ticket_token)
    return {
        "version": int(_TICKET_VERSION),
        "format": "svg-data-url",
        "qrDataUrl": generate_qr_data_url(payload),
    }
