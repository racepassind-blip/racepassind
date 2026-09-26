"""Normalize legacy global 5% pricing to the active 4% model."""

from alembic import op
import sqlalchemy as sa

revision = "0058_normalize_default_platform_fee"
down_revision = "0057_credit_topup_payment_method"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE platform_fee_configs "
            "SET percentage_basis_points = 400, minimum_fee_paise = 2000, "
            "maximum_fee_paise = 6000, per_registration_paise = 0 "
            "WHERE id = 1 AND percentage_basis_points = 500"
        )
    )
    # Older deployments represented 5% as 500 basis points; the condition is
    # intentionally limited to the singleton global configuration row.


def downgrade() -> None:
    pass
