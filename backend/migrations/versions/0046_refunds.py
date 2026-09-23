"""Create refunds table.

Tracks the full lifecycle of a refund request from REQUESTED through
REFUNDED. Never deleted — provides an immutable audit trail.
Payment-method-specific fields (provider_refund_id etc.) are present
but unused until Cashfree integration is added.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0046_refunds"
down_revision: Union[str, None] = "0045_event_refund_policy"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "refunds",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("registration_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("registrations.id"), nullable=False, index=True),
        sa.Column("event_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("events.id"), nullable=False, index=True),
        sa.Column("participant_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("participants.id"), nullable=False, index=True),
        sa.Column("organizer_id", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id"), nullable=False, index=True),
        # Payment method snapshot
        sa.Column("payment_method", sa.String(50), nullable=False),
        sa.Column("payment_provider", sa.String(50), nullable=False),
        # Original amounts (frozen at request time from registration snapshot)
        sa.Column("original_registration_amount", sa.Integer(), nullable=False),
        sa.Column("original_platform_fee", sa.Integer(), nullable=False),
        sa.Column("original_total_paid", sa.Integer(), nullable=False),
        # Refund amounts
        sa.Column("requested_refund_amount", sa.Integer(), nullable=False),
        sa.Column("approved_refund_amount", sa.Integer(), nullable=True),
        sa.Column("platform_fee_refund_amount", sa.Integer(), nullable=False, server_default="0"),
        # Text fields
        sa.Column("refund_reason", sa.String(120), nullable=False),
        sa.Column("participant_comments", sa.Text(), nullable=True),
        sa.Column("organizer_comments", sa.Text(), nullable=True),
        # Status
        sa.Column("status", sa.String(30), nullable=False, server_default="REQUESTED"),
        # Direct UPI fields
        sa.Column("refund_utr", sa.String(120), nullable=True, index=True),
        sa.Column("refund_proof_url", sa.String(2000), nullable=True),
        # Cashfree / future provider fields
        sa.Column("provider_refund_id", sa.String(200), nullable=True),
        sa.Column("provider_refund_status", sa.String(60), nullable=True),
        sa.Column("provider_refund_response", sa.JSON(), nullable=True),
        # Timestamps
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    # Only one active refund per registration (non-terminal statuses)
    op.create_index(
        "ix_refunds_registration_id_status",
        "refunds",
        ["registration_id", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_refunds_registration_id_status", table_name="refunds")
    op.drop_table("refunds")
