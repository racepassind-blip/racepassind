from __future__ import annotations
import unittest
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.services.platform_fee_service import compute_participant_pricing, compute_product_order_pricing, compute_registration_fee_paise, get_effective_pricing, update_organizer_pricing
from db import Base
from app.services.payment_service import build_upi_payment_details

class PlatformFeeBearerTests(unittest.TestCase):

    def test_merchandise_fee_is_four_percent_per_order_with_minimum_and_no_cap(self):
        self.assertEqual(compute_product_order_pricing(base_amount_paise=10000, fee_bearer="PARTICIPANT")["platformFeePaise"], 2000)
        self.assertEqual(compute_product_order_pricing(base_amount_paise=150000, fee_bearer="PARTICIPANT")["platformFeePaise"], 6000)
        self.assertEqual(compute_product_order_pricing(base_amount_paise=2_000_000, fee_bearer="ORGANIZER")["platformFeePaise"], 80000)
        result = compute_product_order_pricing(base_amount_paise=2_000_000, fee_bearer="ORGANIZER")
        self.assertEqual(result["participantTotalPaise"], 2_000_000)
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)

    def tearDown(self):
        self.engine.dispose()

    def test_merch_pricing_does_not_change_event_pricing(self):
        with Session(self.engine) as db:
            for bearer in ("ORGANIZER", "PARTICIPANT"):
                before = compute_participant_pricing(db, base_amount_paise=300000, fee_bearer=bearer)
                merch = compute_product_order_pricing(base_amount_paise=300000, fee_bearer=bearer)
                after = compute_participant_pricing(db, base_amount_paise=300000, fee_bearer=bearer)
                self.assertEqual(before, after)
                self.assertEqual(after["platformFeePaise"], 6000)
                self.assertEqual(merch["platformFeePaise"], 12000)
                self.assertEqual(after["participantTotalPaise"], 306000 if bearer == "PARTICIPANT" else 300000)
                self.assertEqual(merch["participantTotalPaise"], 312000 if bearer == "PARTICIPANT" else 300000)

    def test_event_upi_note_stays_unchanged_and_merch_has_order_reference(self):
        settings = SimpleNamespace(method="manual_upi", is_active=True, upi_id="seller@upi", payee_name="Seller", instructions="Pay", qr_image_url=None)
        for merch, reference, expected in ((False, "RP-123", "SportPass RP-123"), (True, "order-123", "SportPass Order order-123")):
            payment = build_upi_payment_details(settings, amount_paise=306000, registration_reference=reference, merchandise_order=merch)
            params = parse_qs(urlparse(payment["upiUri"]).query)
            self.assertEqual(params["tn"], [expected])
            self.assertEqual(params["tr"], [reference])
            self.assertEqual(params["am"], ["3060.00"])

    def test_merch_minimum_rounding_and_free_order(self):
        for amount, expected in ((0, 0), (1, 2000), (50000, 2000), (50012, 2000), (50013, 2001), (150000, 6000), (150013, 6001)):
            with self.subTest(amount=amount):
                self.assertEqual(compute_product_order_pricing(base_amount_paise=amount, fee_bearer="PARTICIPANT")["platformFeePaise"], expected)

    def test_default_examples(self):
        for amount, expected in ((0, 0), (30000, 2000), (50000, 2000), (70000, 2800), (80000, 3200), (100000, 4000), (150000, 6000), (200000, 6000)):
            self.assertEqual(compute_registration_fee_paise(base_amount_paise=amount, percentage_basis_points=400), expected)

    def test_custom_percentage_and_fixed(self):
        self.assertEqual(compute_registration_fee_paise(base_amount_paise=80000, percentage_basis_points=300), 2400)
        organization = type("Org", (), {"platform_pricing_mode": "FIXED_PER_PARTICIPANT", "platform_fee_fixed_paise": 2000})()
        with Session(self.engine) as db:
            self.assertEqual(compute_participant_pricing(db, base_amount_paise=80000, fee_bearer="PARTICIPANT", organization=organization)["platformFeePaise"], 2000)
            self.assertEqual(compute_participant_pricing(db, base_amount_paise=80000, fee_bearer="PARTICIPANT", organization=organization, participant_count=3)["platformFeePaise"], 6000)

    def test_effective_pricing_modes(self):
        self.assertEqual(get_effective_pricing(None)["percentageBasisPoints"], 400)

    def test_snapshot_inputs_do_not_change_existing_value(self):
        organization = type("Org", (), {"platform_pricing_mode": "CUSTOM_PERCENTAGE", "platform_fee_percentage_basis_points": 300, "platform_fee_min_paise": 2000, "platform_fee_max_paise": 6000})()
        with Session(self.engine) as db:
            old = compute_participant_pricing(db, base_amount_paise=80000, fee_bearer="PARTICIPANT", organization=organization)
            organization.platform_fee_percentage_basis_points = 400
            new = compute_participant_pricing(db, base_amount_paise=80000, fee_bearer="PARTICIPANT", organization=organization)
            self.assertEqual(old["platformFeePaise"], 2400)
            self.assertEqual(new["platformFeePaise"], 3200)

    def test_free_and_bearer_totals(self):
        self.assertEqual(compute_registration_fee_paise(base_amount_paise=0, percentage_basis_points=400), 0)
        with Session(self.engine) as db:
            organizer = compute_participant_pricing(db, base_amount_paise=80000, fee_bearer="ORGANIZER")
            participant = compute_participant_pricing(db, base_amount_paise=80000, fee_bearer="PARTICIPANT")
            self.assertEqual(organizer["platformFeePaise"], 3200)
            self.assertEqual(organizer["participantTotalPaise"], 80000)
            self.assertEqual(participant["participantTotalPaise"], 83200)
