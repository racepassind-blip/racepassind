"""Add refund policy fields to events table.

Adds optional refund policy configuration to each event. When
refund_policy_enabled is false (default) the policy is hidden from
participants and the request-refund flow is unavailable.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0045_event_refund_policy"
down_revision: Union[str, None] = "0044_organization_allow_direct_upi"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("events", sa.Column("refund_policy_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("events", sa.Column("refund_policy_type", sa.String(50), nullable=True))
    op.add_column("events", sa.Column("refund_cutoff_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("events", sa.Column("refund_percentage", sa.Integer(), nullable=True))
    op.add_column("events", sa.Column("platform_fee_refundable", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("events", sa.Column("refund_policy_text", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("events", "refund_policy_text")
    op.drop_column("events", "platform_fee_refundable")
    op.drop_column("events", "refund_percentage")
    op.drop_column("events", "refund_cutoff_at")
    op.drop_column("events", "refund_policy_type")
    op.drop_column("events", "refund_policy_enabled")
