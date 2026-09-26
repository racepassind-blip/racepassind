from __future__ import annotations

import unittest
from unittest.mock import patch

from app.services.communication_service import (
    _FERNET_PREFIX,
    _decrypt_value,
    _encrypt_value,
    _upgrade_legacy_gmail_password,
)
from models import CommunicationConfig


class _EncryptionSettings:
    communication_encryption_key = "test-communication-key"
    session_secret = "test-session-key"


class CommunicationEncryptionTests(unittest.TestCase):
    def test_new_values_use_authenticated_encryption_and_round_trip(self) -> None:
        with patch("app.services.communication_service.get_settings", return_value=_EncryptionSettings()):
            encrypted = _encrypt_value("gmail-app-password")
            self.assertIsNotNone(encrypted)
            self.assertTrue(encrypted.startswith(_FERNET_PREFIX))
            self.assertNotIn("gmail-app-password", encrypted)
            self.assertEqual(_decrypt_value(encrypted), "gmail-app-password")

    def test_legacy_xor_value_is_readable_and_upgraded(self) -> None:
        legacy = "".join(chr(ord(character) ^ 0x5A) for character in "old-password")
        config = CommunicationConfig(channel="EMAIL", enabled=True, configuration={"gmail_app_password": legacy})

        with patch("app.services.communication_service.get_settings", return_value=_EncryptionSettings()):
            plaintext = _decrypt_value(legacy)
            self.assertEqual(plaintext, "old-password")
            _upgrade_legacy_gmail_password(config, legacy, plaintext or "")

        upgraded = config.configuration["gmail_app_password"]
        self.assertTrue(upgraded.startswith(_FERNET_PREFIX))
        with patch("app.services.communication_service.get_settings", return_value=_EncryptionSettings()):
            self.assertEqual(_decrypt_value(upgraded), "old-password")


if __name__ == "__main__":
    unittest.main()
