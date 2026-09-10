from __future__ import annotations

import base64
import io
import re
from urllib.parse import urlencode, urlparse

import qrcode
from qrcode.constants import ERROR_CORRECT_M

from models import EventPaymentSettings

_UPI_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,254}@[A-Za-z0-9][A-Za-z0-9.-]{1,126}$")
_UNSAFE_TEXT_PATTERN = re.compile(r"[\x00-\x1f\x7f]")


def normalize_upi_id(value: str) -> str:
    normalized = value.strip()
    if not normalized or _UNSAFE_TEXT_PATTERN.search(normalized) or any(character.isspace() for character in normalized):
        raise ValueError("Enter a valid UPI ID")
    if not _UPI_ID_PATTERN.fullmatch(normalized):
        raise ValueError("Enter a valid UPI ID such as name@bank")
    return normalized


def normalize_payment_reference(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) < 4 or len(normalized) > 120:
        raise ValueError("Payment reference must be between 4 and 120 characters")
    if _UNSAFE_TEXT_PATTERN.search(normalized) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ./_-]{2,118}[A-Za-z0-9]", normalized):
        raise ValueError("Payment reference contains unsupported characters")
    return normalized


def normalize_qr_image_url(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or _UNSAFE_TEXT_PATTERN.search(normalized):
        raise ValueError("QR image URL must be an HTTP or HTTPS URL")
    return normalized


def validate_manual_upi_settings(settings: EventPaymentSettings) -> None:
    if settings.method != "manual_upi" or not settings.is_active:
        raise ValueError("Manual UPI payment is not active for this event")
    normalize_upi_id(settings.upi_id)
    if not settings.payee_name.strip() or _UNSAFE_TEXT_PATTERN.search(settings.payee_name):
        raise ValueError("Payment payee name is invalid")
    normalize_qr_image_url(settings.qr_image_url)


def _amount_rupees(amount_paise: int) -> str:
    if amount_paise <= 0:
        raise ValueError("Payment amount must be positive")
    return f"{amount_paise / 100:.2f}"


def generate_qr_data_url(value: str) -> str:
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_M, box_size=8, border=4)
    qr.add_data(value)
    qr.make(fit=True)
    matrix = qr.get_matrix()
    size = len(matrix)
    cells = []
    for row, values in enumerate(matrix):
        for column, enabled in enumerate(values):
            if enabled:
                cells.append(f'<rect x="{column}" y="{row}" width="1" height="1"/>')
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'role="img" aria-label="UPI payment QR code"><rect width="100%" height="100%" fill="white"/>'
        f'<g fill="black">{"".join(cells)}</g></svg>'
    )
    encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


def build_upi_payment_details(settings: EventPaymentSettings, *, amount_paise: int, registration_reference: str) -> dict:
    validate_manual_upi_settings(settings)
    upi_id = normalize_upi_id(settings.upi_id)
    payee_name = settings.payee_name.strip()
    amount = _amount_rupees(amount_paise)
    transaction_note = f"RacePass {registration_reference}"
    uri = "upi://pay?" + urlencode(
        {
            "pa": upi_id,
            "pn": payee_name,
            "am": amount,
            "cu": "INR",
            "tn": transaction_note,
            "tr": registration_reference,
        }
    )
    return {
        "method": settings.method,
        "upiId": upi_id,
        "payeeName": payee_name,
        "instructions": settings.instructions.strip(),
        "qrImageUrl": normalize_qr_image_url(settings.qr_image_url),
        "upiUri": uri,
        "qrDataUrl": generate_qr_data_url(uri),
        "currency": "INR",
        "amountPaise": amount_paise,
    }
