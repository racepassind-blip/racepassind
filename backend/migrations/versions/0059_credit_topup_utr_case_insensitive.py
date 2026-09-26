"""Canonicalize and case-fold Credit top-up UTR uniqueness."""

from alembic import op
import sqlalchemy as sa

revision = "0059_credit_topup_utr_case_insensitive"
down_revision = "0058_normalize_default_platform_fee"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Normalize historical values before adding the database-level guard.
    op.execute(
        sa.text(
            "UPDATE credit_topup_requests "
            "SET utr_reference = upper(trim(utr_reference)) "
            "WHERE utr_reference IS NOT NULL"
        )
    )
    op.execute(
        sa.text(
            "CREATE UNIQUE INDEX uq_credit_topup_requests_utr_reference_ci "
            "ON credit_topup_requests (lower(trim(utr_reference)))"
        )
    )


def downgrade() -> None:
    op.drop_index("uq_credit_topup_requests_utr_reference_ci", table_name="credit_topup_requests")
