from __future__ import annotations
import unittest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.services.platform_fee_service import compute_participant_pricing, compute_registration_fee_paise, get_effective_pricing, update_organizer_pricing
from db import Base

class PlatformFeeBearerTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)

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
