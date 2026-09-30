import unittest

from app.services.checkin_service import normalize_registration_reference
from app.services.registration_service import _human_reference


class ReferenceFormatTests(unittest.TestCase):
    def test_new_event_references_use_spe_prefix(self):
        self.assertRegex(_human_reference(), r"^SPE-[0-9A-F]{10}$")

    def test_existing_rp_references_remain_valid_for_checkin(self):
        self.assertEqual(normalize_registration_reference("rp-abc123"), "RP-ABC123")


if __name__ == "__main__":
    unittest.main()
