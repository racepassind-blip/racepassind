from __future__ import annotations

import unittest
import uuid

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.services.organization_fee_service import (
    OrganizationFeeValidationError,
    normalize_fee_settings,
    serialize_organization_fee,
    update_organization_fee_settings,
)
from db import Base
from models import AuditLog, Organization, User


class AdminFeeConfigurationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(cls.engine)

    def _create_admin_and_organization(self, db: Session) -> tuple[User, Organization]:
        admin = User(
            name=f"Admin {uuid.uuid4().hex[:6]}",
            email=f"admin-{uuid.uuid4().hex}@example.test",
            normalized_email=f"admin-{uuid.uuid4().hex}@example.test",
            password_hash="test-hash",
            role="admin",
            is_active=True,
        )
        organization = Organization(name=f"Race {uuid.uuid4().hex[:6]}", status="active")
        db.add_all([admin, organization])
        db.commit()
        db.refresh(admin)
        db.refresh(organization)
        return admin, organization

    def test_new_organization_defaults_to_zero_and_none(self) -> None:
        with Session(self.engine) as db:
            _, organization = self._create_admin_and_organization(db)
            self.assertEqual(serialize_organization_fee(organization)["feeType"], "none")
            self.assertEqual(organization.fee_value_paise, 0)
            self.assertEqual(organization.fee_percentage_basis_points, 0)

    def test_admin_can_set_fixed_and_percentage_fee_with_audit(self) -> None:
        with Session(self.engine) as db:
            admin, organization = self._create_admin_and_organization(db)

            fixed = update_organization_fee_settings(
                db,
                organization_id=organization.id,
                actor_user_id=admin.id,
                fee_type="fixed_per_registration",
                fee_value_paise=1250,
                fee_percentage_basis_points=0,
            )
            self.assertEqual(fixed["feeType"], "fixed_per_registration")
            self.assertEqual(fixed["feeValuePaise"], 1250)
            self.assertEqual(fixed["feePercentageBasisPoints"], 0)

            percentage = update_organization_fee_settings(
                db,
                organization_id=organization.id,
                actor_user_id=admin.id,
                fee_type="percentage",
                fee_value_paise=0,
                fee_percentage_basis_points=750,
            )
            self.assertEqual(percentage["feeType"], "percentage")
            self.assertEqual(percentage["feeValuePaise"], 0)
            self.assertEqual(percentage["feePercentageBasisPoints"], 750)

            audits = db.scalars(
                select(AuditLog).where(
                    AuditLog.action == "organization_fee_settings_updated",
                    AuditLog.resource_id == str(organization.id),
                )
            ).all()
            self.assertEqual(len(audits), 2)
            self.assertEqual(audits[-1].actor_user_id, admin.id)
            self.assertEqual(audits[-1].metadata_json["updated"]["feeType"], "percentage")

    def test_none_clears_stale_values(self) -> None:
        with Session(self.engine) as db:
            admin, organization = self._create_admin_and_organization(db)
            update_organization_fee_settings(
                db,
                organization_id=organization.id,
                actor_user_id=admin.id,
                fee_type="fixed_per_registration",
                fee_value_paise=500,
                fee_percentage_basis_points=0,
            )
            cleared = update_organization_fee_settings(
                db,
                organization_id=organization.id,
                actor_user_id=admin.id,
                fee_type="none",
                fee_value_paise=500,
                fee_percentage_basis_points=100,
            )
            self.assertEqual(cleared["feeType"], "none")
            self.assertEqual(cleared["feeValuePaise"], 0)
            self.assertEqual(cleared["feePercentageBasisPoints"], 0)

    def test_invalid_values_are_rejected_without_mutation(self) -> None:
        invalid_values = [
            ("unknown", 0, 0),
            ("fixed_per_registration", -1, 0),
            ("fixed_per_registration", 100, 1),
            ("percentage", 1, 100),
            ("percentage", 0, 10_001),
        ]
        for values in invalid_values:
            with self.subTest(values=values):
                with self.assertRaises(OrganizationFeeValidationError):
                    normalize_fee_settings(*values)

        with Session(self.engine) as db:
            admin, organization = self._create_admin_and_organization(db)
            with self.assertRaises(OrganizationFeeValidationError):
                update_organization_fee_settings(
                    db,
                    organization_id=organization.id,
                    actor_user_id=admin.id,
                    fee_type="percentage",
                    fee_value_paise=100,
                    fee_percentage_basis_points=500,
                )
            db.refresh(organization)
            self.assertEqual(organization.fee_type, "none")
            self.assertEqual(db.scalar(select(AuditLog).where(AuditLog.resource_id == str(organization.id))), None)

    def test_unknown_organization_is_rejected(self) -> None:
        with Session(self.engine) as db:
            admin, _ = self._create_admin_and_organization(db)
            with self.assertRaises(LookupError):
                update_organization_fee_settings(
                    db,
                    organization_id=uuid.uuid4(),
                    actor_user_id=admin.id,
                    fee_type="none",
                    fee_value_paise=0,
                    fee_percentage_basis_points=0,
                )


if __name__ == "__main__":
    unittest.main()
