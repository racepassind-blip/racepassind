from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.services.audit_service import record_audit
from models import Organization

FEE_TYPES = frozenset({"none", "fixed_per_registration", "percentage"})


class OrganizationFeeValidationError(ValueError):
    """Raised when an organization fee configuration is invalid."""


class OrganizationNotFoundError(LookupError):
    """Raised when an organization does not exist."""


def normalize_fee_settings(
    fee_type: str,
    fee_value_paise: int,
    fee_percentage_basis_points: int,
) -> tuple[str, int, int]:
    if fee_type not in FEE_TYPES:
        raise OrganizationFeeValidationError("Unsupported fee type")
    if isinstance(fee_value_paise, bool) or not isinstance(fee_value_paise, int) or fee_value_paise < 0:
        raise OrganizationFeeValidationError("Fixed fee must be a non-negative integer amount in paise")
    if (
        isinstance(fee_percentage_basis_points, bool)
        or not isinstance(fee_percentage_basis_points, int)
        or fee_percentage_basis_points < 0
        or fee_percentage_basis_points > 10_000
    ):
        raise OrganizationFeeValidationError("Percentage fee must be between 0 and 10000 basis points")

    if fee_type == "none":
        return fee_type, 0, 0
    if fee_type == "fixed_per_registration":
        if fee_percentage_basis_points != 0:
            raise OrganizationFeeValidationError("Fixed fees cannot include a percentage value")
        return fee_type, fee_value_paise, 0
    if fee_value_paise != 0:
        raise OrganizationFeeValidationError("Percentage fees cannot include a fixed value")
    return fee_type, 0, fee_percentage_basis_points


def serialize_organization_fee(organization: Organization) -> dict:
    return {
        "id": str(organization.id),
        "name": organization.name,
        "status": organization.status,
        "feeType": organization.fee_type,
        "feeValuePaise": organization.fee_value_paise,
        "feePercentageBasisPoints": organization.fee_percentage_basis_points,
        "currency": "INR",
        "collectionStatus": "not_collected",
    }


def update_organization_fee_settings(
    db: Session,
    *,
    organization_id: UUID,
    actor_user_id: UUID,
    fee_type: str,
    fee_value_paise: int,
    fee_percentage_basis_points: int,
) -> dict:
    normalized = normalize_fee_settings(fee_type, fee_value_paise, fee_percentage_basis_points)
    organization = db.scalar(
        select(Organization).where(Organization.id == organization_id).with_for_update()
    )
    if organization is None:
        raise OrganizationNotFoundError("Organization not found")

    previous = {
        "feeType": organization.fee_type,
        "feeValuePaise": organization.fee_value_paise,
        "feePercentageBasisPoints": organization.fee_percentage_basis_points,
    }
    organization.fee_type, organization.fee_value_paise, organization.fee_percentage_basis_points = normalized
    updated = serialize_organization_fee(organization)
    record_audit(
        db,
        actor_user_id=actor_user_id,
        action="organization_fee_settings_updated",
        resource_type="organization",
        resource_id=organization.id,
        metadata={
            "previous": previous,
            "updated": {
                "feeType": updated["feeType"],
                "feeValuePaise": updated["feeValuePaise"],
                "feePercentageBasisPoints": updated["feePercentageBasisPoints"],
            },
            "currency": "INR",
            "collectionStatus": "not_collected",
        },
    )
    db.commit()
    db.refresh(organization)
    return serialize_organization_fee(organization)
