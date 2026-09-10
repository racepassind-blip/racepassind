"""Add expiry and consumption timestamps for guest registration claim codes."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0006_registration_claim_lifecycle"
down_revision = "0005_payment_reference_rate_limits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("registrations", sa.Column("claim_code_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("registrations", sa.Column("claim_code_claimed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("registrations", "claim_code_claimed_at")
    op.drop_column("registrations", "claim_code_expires_at")
