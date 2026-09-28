import unittest
import uuid
from unittest.mock import Mock, patch

from app.api.v1.organizer import get_my_organization
from models import Organization


class OrganizationProfileMediaTests(unittest.TestCase):
    def test_profile_reload_resolves_stored_logo_reference(self):
        organization = Organization(
            id=uuid.uuid4(), name="Running club", status="active",
            logo_url="storage://private/organization-logo/logo.png",
        )
        storage = Mock()
        storage.get_read_url.side_effect = [
            "https://storage.test/logo.png?signature=first",
            "https://storage.test/logo.png?signature=refreshed",
        ]
        with patch("app.api.v1.organizer.get_authorized_organization", return_value=organization):
            first = get_my_organization(organization.id, user=Mock(), db=Mock(), storage=storage)
            refreshed = get_my_organization(organization.id, user=Mock(), db=Mock(), storage=storage)

        self.assertEqual(first["logoUrl"], "https://storage.test/logo.png?signature=first")
        self.assertEqual(refreshed["logoUrl"], "https://storage.test/logo.png?signature=refreshed")
        self.assertEqual(storage.get_read_url.call_args.args[0], "private/organization-logo/logo.png")
        self.assertEqual(organization.logo_url, "storage://private/organization-logo/logo.png")
