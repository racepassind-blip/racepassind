"""SportPass fee pricing and immutable registration snapshot calculations."""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.services.audit_service import record_audit
from models import Organization, PlatformFeeConfig

FEE_BEARER_ORGANIZER = "ORGANIZER"
FEE_BEARER_PARTICIPANT = "PARTICIPANT"
FEE_BEARERS = frozenset({FEE_BEARER_ORGANIZER, FEE_BEARER_PARTICIPANT})


class PlatformFeeValidationError(ValueError):
    """Raised when a platform-fee pricing operation is invalid."""


def get_or_create_config(db: Session) -> PlatformFeeConfig:
    config = db.get(PlatformFeeConfig, 1)
    if config is None:
        config = PlatformFeeConfig(
            id=1,
            label="Standard SportPass Pricing",
            percentage_basis_points=400,
            per_registration_paise=0,
            minimum_fee_paise=2000,
            maximum_fee_paise=6000,
            currency="INR",
        )
        db.add(config)
        db.flush()
    return config


def serialize_config(config: PlatformFeeConfig) -> dict:
    return {
        "label": config.label,
        "percentageBasisPoints": config.percentage_basis_points,
        "percentagePercent": config.percentage_basis_points / 100,
        "minimumFeePaise": config.minimum_fee_paise,
        "maximumFeePaise": config.maximum_fee_paise,
        "currency": config.currency,
        "updatedAt": config.updated_at,
    }


def get_config(db: Session) -> dict:
    return serialize_config(get_or_create_config(db))


def update_config(
    db: Session,
    *,
    actor_user_id: UUID,
    label: str | None,
    percentage_basis_points: int,
    minimum_fee_paise: int,
    maximum_fee_paise: int,
) -> dict:
    if not 0 <= percentage_basis_points <= 10_000:
        raise PlatformFeeValidationError("Percentage must be between 0 and 10000 basis points")
    if minimum_fee_paise < 0 or maximum_fee_paise < minimum_fee_paise:
        raise PlatformFeeValidationError("Minimum and maximum fees are invalid")

    config = get_or_create_config(db)
    previous = serialize_config(config)
    if label is not None and label.strip():
        config.label = label.strip()
    config.percentage_basis_points = percentage_basis_points
    config.minimum_fee_paise = minimum_fee_paise
    config.maximum_fee_paise = maximum_fee_paise
    # Retained only as a historical column; the active formula has no flat add-on.
    config.per_registration_paise = 0
    record_audit(
        db,
        actor_user_id=actor_user_id,
        action="platform_fee_config_updated",
        resource_type="platform_fee_config",
        resource_id=config.id,
        metadata={
            "previous": {
                "percentageBasisPoints": previous["percentageBasisPoints"],
                "minimumFeePaise": previous["minimumFeePaise"],
                "maximumFeePaise": previous["maximumFeePaise"],
            },
            "updated": {
                "percentageBasisPoints": config.percentage_basis_points,
                "minimumFeePaise": config.minimum_fee_paise,
                "maximumFeePaise": config.maximum_fee_paise,
            },
        },
    )
    db.commit()
    db.refresh(config)
    return serialize_config(config)


def compute_registration_fee_paise(
    *,
    base_amount_paise: int,
    percentage_basis_points: int,
    minimum_fee_paise: int = 2000,
    maximum_fee_paise: int = 6000,
) -> int:
    """Calculate one fee in paise using percentage, minimum and maximum bounds."""
    if base_amount_paise <= 0:
        return 0
    percentage = int(
        (
            Decimal(base_amount_paise)
            * Decimal(percentage_basis_points)
            / Decimal(10_000)
        ).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    )
    return min(max(percentage, minimum_fee_paise), maximum_fee_paise)


def get_effective_pricing(organization: Organization | None) -> dict:
    """Return the organizer-specific pricing inputs used for new registrations."""
    mode = getattr(organization, "platform_pricing_mode", "DEFAULT") if organization else "DEFAULT"
    if mode == "CUSTOM_PERCENTAGE":
        return {
            "mode": mode,
            "percentageBasisPoints": organization.platform_fee_percentage_basis_points if organization.platform_fee_percentage_basis_points is not None else 400,
            "minimumFeePaise": organization.platform_fee_min_paise if organization.platform_fee_min_paise is not None else 2000,
            "maximumFeePaise": organization.platform_fee_max_paise if organization.platform_fee_max_paise is not None else 6000,
            "fixedFeePaise": None,
            "currency": "INR",
        }
    if mode == "FIXED_PER_PARTICIPANT":
        return {
            "mode": mode,
            "percentageBasisPoints": 0,
            "minimumFeePaise": 0,
            "maximumFeePaise": 0,
            "fixedFeePaise": organization.platform_fee_fixed_paise or 0,
            "currency": "INR",
        }
    return {
        "mode": "DEFAULT",
        "percentageBasisPoints": 400,
        "minimumFeePaise": 2000,
        "maximumFeePaise": 6000,
        "fixedFeePaise": None,
        "currency": "INR",
    }


def update_organizer_pricing(
    db: Session,
    *,
    organization_id: UUID,
    mode: str,
    percentage_basis_points: int | None,
    minimum_fee_paise: int | None,
    maximum_fee_paise: int | None,
    fixed_fee_paise: int | None,
) -> dict:
    if mode not in {"DEFAULT", "CUSTOM_PERCENTAGE", "FIXED_PER_PARTICIPANT"}:
        raise PlatformFeeValidationError("Unsupported organizer pricing mode")
    organization = db.scalar(select(Organization).where(Organization.id == organization_id).with_for_update())
    if organization is None:
        raise PlatformFeeValidationError("Organization not found")
    if mode == "CUSTOM_PERCENTAGE":
        if percentage_basis_points is None or not 0 <= percentage_basis_points <= 10_000 or minimum_fee_paise is None or maximum_fee_paise is None or minimum_fee_paise < 0 or maximum_fee_paise < minimum_fee_paise:
            raise PlatformFeeValidationError("Custom percentage pricing requires valid percentage and bounds")
    if mode == "FIXED_PER_PARTICIPANT" and (fixed_fee_paise is None or fixed_fee_paise < 0):
        raise PlatformFeeValidationError("Fixed pricing requires a non-negative fee")

    organization.platform_pricing_mode = mode
    organization.platform_fee_percentage_basis_points = percentage_basis_points
    organization.platform_fee_min_paise = minimum_fee_paise
    organization.platform_fee_max_paise = maximum_fee_paise
    organization.platform_fee_fixed_paise = fixed_fee_paise
    db.commit()
    db.refresh(organization)
    return {"organizationId": str(organization.id), **get_effective_pricing(organization)}


def compute_participant_pricing(
    db: Session,
    *,
    base_amount_paise: int,
    fee_bearer: str,
    organization: Organization | None = None,
    participant_count: int = 1,
) -> dict:
    """Calculate the values that are snapshotted on a new registration."""
    bearer = fee_bearer if fee_bearer in FEE_BEARERS else FEE_BEARER_ORGANIZER
    pricing = get_effective_pricing(organization)
    if pricing["mode"] == "DEFAULT":
        config = get_or_create_config(db)
        pricing["percentageBasisPoints"] = config.percentage_basis_points
        pricing["minimumFeePaise"] = config.minimum_fee_paise
        pricing["maximumFeePaise"] = config.maximum_fee_paise

    if pricing["mode"] == "FIXED_PER_PARTICIPANT" and base_amount_paise > 0:
        fee_paise = pricing["fixedFeePaise"] * max(1, participant_count)
    else:
        fee_paise = compute_registration_fee_paise(
            base_amount_paise=base_amount_paise,
            percentage_basis_points=pricing["percentageBasisPoints"],
            minimum_fee_paise=pricing["minimumFeePaise"],
            maximum_fee_paise=pricing["maximumFeePaise"],
        )
    participant_total_paise = base_amount_paise + (fee_paise if bearer == FEE_BEARER_PARTICIPANT else 0)
    return {
        "baseAmountPaise": base_amount_paise,
        "platformFeePaise": fee_paise,
        "platformFeeBearer": bearer,
        "participantTotalPaise": participant_total_paise,
        "percentageBasisPoints": pricing["percentageBasisPoints"],
        "minimumFeePaise": pricing["minimumFeePaise"],
        "maximumFeePaise": pricing["maximumFeePaise"],
        "fixedFeePaise": pricing["fixedFeePaise"],
        "currency": pricing["currency"],
    }
