import unittest
import uuid

from fastapi import HTTPException

from app.services.mfa_service import generate_totp_secret, otpauth_uri, totp_code, verify_totp_code
from app.api.deps import require_roles
from models import User


class MfaServiceTests(unittest.TestCase):
    def test_totp_round_trip_and_window(self):
        secret = generate_totp_secret()
        now = 1_700_000_000.0
        code = totp_code(secret, now)
        self.assertEqual(len(code), 6)
        self.assertTrue(verify_totp_code(secret, code, now))
        self.assertTrue(verify_totp_code(secret, totp_code(secret, now - 30), now))
        self.assertFalse(verify_totp_code(secret, "000000", now))

    def test_invalid_inputs_and_uri(self):
        secret = generate_totp_secret()
        self.assertFalse(verify_totp_code(secret, "12", 1_700_000_000))
        uri = otpauth_uri(secret, "admin@example.com")
        self.assertIn("otpauth://totp/", uri)
        self.assertIn(f"secret={secret}", uri)
        self.assertIn("issuer=SportPass%20India", uri)

    def test_admin_role_guard_requires_mfa(self):
        dependency = require_roles("admin")
        admin = User(id=uuid.uuid4(), name="Admin", email="a@example.com", password_hash="x", role="admin", mfa_enabled=False)
        with self.assertRaisesRegex(HTTPException, "admin_mfa_required"):
            dependency(admin)
        admin.mfa_enabled = True
        self.assertIs(dependency(admin), admin)


if __name__ == "__main__":
    unittest.main()
