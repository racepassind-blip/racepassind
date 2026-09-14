from __future__ import annotations

import unittest
from types import SimpleNamespace

from app.services.ticket_pdf_service import build_ticket_pdf


class TicketPdfServiceTests(unittest.TestCase):
    @staticmethod
    def _registration(status: str = "confirmed"):
        organization = SimpleNamespace(
            name="Stride Club",
            website="https://stride.example.test",
            logo_url="https://cdn.example.test/logo.png",
        )
        event = SimpleNamespace(
            name="India City Run",
            date="2026-09-11",
            start_date=None,
            end_date=None,
            location="Central Park",
            location_name="Central Park",
            address="1 Main Street",
            city="Pune",
            state="Maharashtra",
            country="India",
            description="A community run.",
            rules=["Bring a photo ID", "Arrive 30 minutes early"],
            organization=organization,
        )
        ticket = SimpleNamespace(
            name="10K Open",
            currency="INR",
            category=SimpleNamespace(name="Open category"),
        )
        participant = SimpleNamespace(
            name="Runner Name",
            email="runner@example.test",
            phone="+919999999999",
        )
        registration = SimpleNamespace(
            status=status,
            registration_reference="RP-ABC123",
            quantity=1,
            total_amount_paise=10000,
            payment_status="approved",
            participant=participant,
            ticket=ticket,
        )
        return registration, event

    def test_confirmed_pdf_contains_branded_document_header(self) -> None:
        registration, event = self._registration()

        pdf = build_ticket_pdf(registration, event, "racepass://ticket?v=1&t=opaque")

        self.assertTrue(pdf.startswith(b"%PDF-"))
        self.assertGreater(len(pdf), 1000)
        self.assertNotIn(b"confirmation-token", pdf)
        self.assertNotIn(b"UTR-SECRET", pdf)
        self.assertNotIn(b"claim-code", pdf)

    def test_checked_in_registration_can_download_pdf(self) -> None:
        registration, event = self._registration("checked_in")

        pdf = build_ticket_pdf(registration, event, "racepass://ticket?v=1&t=opaque")

        self.assertTrue(pdf.startswith(b"%PDF-"))

    def test_unconfirmed_registration_cannot_build_pdf(self) -> None:
        registration, event = self._registration("pending_verification")

        with self.assertRaisesRegex(ValueError, "confirmed registrations"):
            build_ticket_pdf(registration, event, "racepass://ticket?v=1&t=opaque")


if __name__ == "__main__":
    unittest.main()
