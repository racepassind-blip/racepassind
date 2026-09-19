"""Communication settings management service.

Provides centralized configuration for communication channels (email, WhatsApp, SMS, etc.).
Currently supports Gmail for email sending via SMTP.
"""

from __future__ import annotations

import base64
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.services.audit_service import record_audit
from models import CommunicationConfig

# Email channel identifier
EMAIL_CHANNEL = "EMAIL"

# Gmail SMTP configuration (fixed - admin doesn't configure these)
GMAIL_SMTP_HOST = "smtp.gmail.com"
GMAIL_SMTP_PORT = 587
GMAIL_SMTP_USE_TLS = True

# Sensitive keys in configuration
_SENSITIVE_KEYS = frozenset({"gmail_app_password"})


def _encrypt_value(value: str | None) -> str | None:
    """Encrypt a sensitive value for storage.

    Currently uses a simple obfuscation pattern. This can be upgraded to
    proper encryption (e.g., Fernet with a key from environment) in the future
    without changing the API.

    For production, replace the XOR-based approach with:
    ```
    from cryptography.fernet import Fernet

    _fernet = Fernet(settings.communication_encryption_key.encode())

    def _encrypt_value(value: str | None) -> str | None:
        if value is None:
            return None
        return _fernet.encrypt(value.encode()).decode()

    def _decrypt_value(encrypted: str | None) -> str | None:
        if encrypted is None:
            return None
        return _fernet.decrypt(encrypted.encode()).decode()
    ```
    And add COMMUNICATION_ENCRYPTION_KEY to the Settings class.
    """
    if value is None:
        return None
    # Simple XOR-based obfuscation for development
    # For production, replace with proper encryption (Fernet, etc.)
    key = 0x5A
    return "".join(chr(ord(c) ^ key) for c in value)


def _decrypt_value(encrypted: str | None) -> str | None:
    """Decrypt a previously encrypted value.

    This mirrors _encrypt_value. The same key must be used.

    For production with Fernet:
    ```
    from cryptography.fernet import Fernet

    _fernet = Fernet(settings.communication_encryption_key.encode())

    def _decrypt_value(encrypted: str | None) -> str | None:
        if encrypted is None:
            return None
        return _fernet.decrypt(encrypted.encode()).decode()
    ```
    """
    if encrypted is None:
        return None
    key = 0x5A
    return "".join(chr(ord(c) ^ key) for c in encrypted)


def _serialize_config_for_api(config: dict[str, Any], *, redact_sensitive: bool = True) -> dict[str, Any]:
    """Serialize configuration for API responses, optionally redacting sensitive fields."""
    result = {}
    for key, value in config.items():
        if redact_sensitive and key in _SENSITIVE_KEYS:
            result[f"{key}_configured"] = value is not None and len(value) > 0
        else:
            result[key] = value
    return result


def _get_or_create_email_config(db: Session) -> CommunicationConfig:
    """Get existing EMAIL config or create a new one with defaults."""
    config = db.scalar(
        select(CommunicationConfig).where(CommunicationConfig.channel == EMAIL_CHANNEL).with_for_update()
    )
    if config is None:
        config = CommunicationConfig(
            channel=EMAIL_CHANNEL,
            enabled=True,
            configuration={},
        )
        db.add(config)
    return config


def get_communication_settings(db: Session) -> dict[str, Any]:
    """Get all communication settings for the admin panel."""
    config = db.scalar(
        select(CommunicationConfig).where(CommunicationConfig.channel == EMAIL_CHANNEL)
    )

    if config is None:
        return {
            "channel": EMAIL_CHANNEL,
            "enabled": True,
            "sender_name": "",
            "gmail_address": "",
            "gmail_app_password_configured": False,
        }

    config_data = config.configuration or {}
    return {
        "channel": config.channel,
        "enabled": config.enabled,
        "sender_name": config_data.get("sender_name", ""),
        "gmail_address": config_data.get("gmail_address", ""),
        "gmail_app_password_configured": config_data.get("gmail_app_password") is not None
        and len(config_data.get("gmail_app_password", "")) > 0,
    }


def update_email_settings(
    db: Session,
    *,
    actor_user_id: UUID,
    sender_name: str | None = None,
    gmail_address: str | None = None,
    gmail_app_password: str | None = None,
    enabled: bool | None = None,
) -> dict[str, Any]:
    """Update email communication settings."""
    config = _get_or_create_email_config(db)

    if enabled is not None:
        config.enabled = enabled

    # Build a NEW dict so SQLAlchemy detects the change on the JSON column.
    # Mutating the existing dict in place is not tracked and won't persist.
    new_configuration = dict(config.configuration or {})

    if sender_name is not None:
        new_configuration["sender_name"] = sender_name

    if gmail_address is not None:
        new_configuration["gmail_address"] = gmail_address

    # Only update password if it's provided and non-empty
    if gmail_app_password is not None and len(gmail_app_password.strip()) > 0:
        # Normalize the password: Gmail App Passwords are shown as "xxxx xxxx xxxx xxxx"
        # but should be used without spaces. Also replace non-breaking spaces.
        normalized_password = gmail_app_password.replace("\xa0", "").replace(" ", "").strip()
        new_configuration["gmail_app_password"] = _encrypt_value(normalized_password)

    # Reassign the whole dict to trigger SQLAlchemy change detection
    config.configuration = new_configuration

    db.commit()
    db.refresh(config)

    record_audit(
        db,
        actor_user_id=actor_user_id,
        action="email_settings_updated",
        resource_type="communication_config",
        resource_id=config.id,
        metadata={
            "enabled": config.enabled,
            "sender_name": config.configuration.get("sender_name"),
            "gmail_address": config.configuration.get("gmail_address"),
        },
    )

    return get_communication_settings(db)


def send_test_email(
    db: Session,
    *,
    recipient_email: str,
) -> tuple[bool, str]:
    """Send a test email using the configured Gmail settings."""
    config = db.scalar(
        select(CommunicationConfig).where(CommunicationConfig.channel == EMAIL_CHANNEL)
    )

    if config is None:
        return False, "Email configuration is disabled"

    if not config.enabled:
        return False, "Email configuration is disabled"

    config_data = config.configuration or {}

    sender_name = config_data.get("sender_name", "")
    gmail_address = config_data.get("gmail_address", "")
    gmail_app_password = config_data.get("gmail_app_password", "")

    # Validate we have all required credentials
    if not sender_name or not gmail_address or not gmail_app_password:
        return False, "Invalid Gmail credentials"

    # Decrypt the password
    decrypted_password = _decrypt_value(gmail_app_password)

    if not decrypted_password:
        return False, "Invalid Gmail credentials"

    # Normalize: strip spaces and non-breaking spaces that Gmail may include
    decrypted_password = decrypted_password.replace("\xa0", "").replace(" ", "").strip()

    settings = get_settings()

    try:
        # Create message with proper encoding
        msg = MIMEMultipart()
        # Use encoded words for non-ASCII sender names
        msg["From"] = f"=?utf-8?B?{base64.b64encode(sender_name.encode('utf-8')).decode()}?= <{gmail_address}>"
        msg["To"] = recipient_email
        msg["Subject"] = "=?utf-8?B?{base64.b64encode('SportPass Email Test'.encode('utf-8')).decode()}?="

        body = """Your SportPass email configuration is working successfully.

This is a test email to verify your email settings are correct.

If you're reading this, your email configuration is working!"""
        msg.attach(MIMEText(body, "plain", "utf-8"))

        # Send via Gmail SMTP
        context = ssl.create_default_context()
        # For development, allow self-signed certificates
        if settings.environment != "production":
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE

        with smtplib.SMTP(GMAIL_SMTP_HOST, GMAIL_SMTP_PORT) as server:
            server.starttls(context=context)
            server.login(gmail_address, decrypted_password)
            server.send_message(msg)

        return True, "Test email sent successfully"

    except smtplib.SMTPAuthenticationError:
        return False, "Gmail authentication failed"
    except smtplib.SMTPConnectError:
        return False, "Unable to connect"
    except smtplib.SMTPException as exc:
        if "Authentication" in str(exc):
            return False, "Gmail authentication failed"
        return False, f"Gmail error: {str(exc)}"
    except Exception as exc:
        return False, f"Unable to connect: {str(exc)}"
