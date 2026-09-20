from __future__ import annotations

import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.services.platform_fee_service import (
    compute_participant_pricing,
    compute_registration_fee_paise,
    get_or_create_config,
)
from db import Base


class PlatformFeeBearerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)

    def test_fee_matches_five_percent_plus_ten(self) -> None:
        # ₹600 -> 5% = ₹30 + ₹10 = ₹40.
        self.assertEqual(
            compute_registration_fee_paise(
                base_amount_paise=60000, percentage_basis_points=500, per_registration_paise=1000
            ),
            4000,
        )

    def test_free_registration_never_accrues_a_fee(self) -> None:
        self.assertEqual(
            compute_registration_fee_paise(
                base_amount_paise=0, percentage_basis_points=500, per_registration_paise=1000
            ),
            0,
        )

    def test_organizer_bearer_leaves_participant_total_at_base(self) -> None:
        with Session(self.engine) as db:
            get_or_create_config(db)
            pricing = compute_participant_pricing(db, base_amount_paise=60000, fee_bearer="ORGANIZER")
            self.assertEqual(pricing["platformFeePaise"], 4000)  # fee still owed to SportPass
            self.assertEqual(pricing["participantTotalPaise"], 60000)  # participant pays only base
            self.assertEqual(pricing["baseAmountPaise"], 60000)

    def test_participant_bearer_adds_fee_to_participant_total(self) -> None:
        with Session(self.engine) as db:
            get_or_create_config(db)
            pricing = compute_participant_pricing(db, base_amount_paise=60000, fee_bearer="PARTICIPANT")
            self.assertEqual(pricing["platformFeePaise"], 4000)
            self.assertEqual(pricing["participantTotalPaise"], 64000)  # ₹640
            self.assertEqual(pricing["baseAmountPaise"], 60000)  # base (billing base) unchanged

    def test_free_registration_with_participant_bearer_stays_free(self) -> None:
        with Session(self.engine) as db:
            get_or_create_config(db)
            pricing = compute_participant_pricing(db, base_amount_paise=0, fee_bearer="PARTICIPANT")
            self.assertEqual(pricing["platformFeePaise"], 0)
            self.assertEqual(pricing["participantTotalPaise"], 0)

    def test_unknown_bearer_falls_back_to_organizer(self) -> None:
        with Session(self.engine) as db:
            get_or_create_config(db)
            pricing = compute_participant_pricing(db, base_amount_paise=60000, fee_bearer="BOGUS")
            self.assertEqual(pricing["platformFeeBearer"], "ORGANIZER")
            self.assertEqual(pricing["participantTotalPaise"], 60000)


if __name__ == "__main__":
    unittest.main()
