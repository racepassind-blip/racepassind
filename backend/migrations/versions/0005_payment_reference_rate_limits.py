"""Add database-backed rate-limit buckets for payment-reference updates."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0005_payment_reference_rate_limits"
down_revision = "0004_guest_contact_nullable"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rate_limit_buckets",
        sa.Column("key_hash", sa.String(length=64), primary_key=True, nullable=False),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_rate_limit_buckets_updated_at", "rate_limit_buckets", ["updated_at"])


def downgrade() -> None:
    op.drop_index("ix_rate_limit_buckets_updated_at", table_name="rate_limit_buckets")
    op.drop_table("rate_limit_buckets")
