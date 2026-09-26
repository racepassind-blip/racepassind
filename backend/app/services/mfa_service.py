"""Small, dependency-free TOTP implementation for privileged admin MFA."""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import time
from urllib.parse import quote

from app.services.communication_service import _decrypt_value, _encrypt_value

_PERIOD = 30
_DIGITS = 6


def generate_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def encrypt_totp_secret(secret: str) -> str:
    encrypted = _encrypt_value(secret)
    if not encrypted:
        raise RuntimeError("Could not encrypt MFA secret")
    return encrypted


def decrypt_totp_secret(encrypted: str | None) -> str | None:
    return _decrypt_value(encrypted)


def totp_code(secret: str, at: float | None = None) -> str:
    normalized = secret.replace(" ", "").upper()
    padded = normalized + "=" * ((8 - len(normalized) % 8) % 8)
    key = base64.b32decode(padded, casefold=True)
    counter = int((time.time() if at is None else at) // _PERIOD)
    digest = hmac.new(key, counter.to_bytes(8, "big"), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary = int.from_bytes(digest[offset : offset + 4], "big") & 0x7FFFFFFF
    return f"{binary % (10 ** _DIGITS):0{_DIGITS}d}"


def verify_totp_code(secret: str | None, code: str | None, at: float | None = None) -> bool:
    if not secret or not code or not re.fullmatch(r"\d{6}", code.strip()):
        return False
    now = time.time() if at is None else at
    supplied = code.strip()
    return any(hmac.compare_digest(totp_code(secret, now + offset), supplied) for offset in (-_PERIOD, 0, _PERIOD))


def otpauth_uri(secret: str, account: str, issuer: str = "SportPass India") -> str:
    label = quote(f"{issuer}:{account}")
    return f"otpauth://totp/{label}?secret={secret}&issuer={quote(issuer)}&algorithm=SHA1&digits=6&period={_PERIOD}"
