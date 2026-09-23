"""0047 — Make refunds.registration_id / participant_id nullable; add is_manual_refund and manual participant fields.

Manual refunds are organizer-created records not tied to a SportPass registration.
They are excluded from billing/earnings totals via is_manual_refund=true.

Revision ID: 0047
Revises: 0046
Create Date: 2026-09-20
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0047"
down_revision = "0046_refunds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Make registration_id nullable (manual refunds have no registration)
    op.alter_column("refunds", "registration_id", existing_type=sa.UUID(), nullable=True)

    # Make participant_id nullable (manual refunds may have no SportPass account)
    op.alter_column("refunds", "participant_id", existing_type=sa.UUID(), nullable=True)

    # Flag: true = organizer-initiated, not linked to a registration
    op.add_column("refunds", sa.Column(
        "is_manual_refund",
        sa.Boolean(),
        nullable=False,
        server_default=sa.text("false"),
    ))

    # Free-text fields for manual refund participant info
    op.add_column("refunds", sa.Column("manual_participant_name", sa.String(200), nullable=True))
    op.add_column("refunds", sa.Column("manual_participant_contact", sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column("refunds", "manual_participant_contact")
    op.drop_column("refunds", "manual_participant_name")
    op.drop_column("refunds", "is_manual_refund")
    # Restore NOT NULL — only safe if no NULL rows exist
    op.alter_column("refunds", "participant_id", existing_type=sa.UUID(), nullable=False)
    op.alter_column("refunds", "registration_id", existing_type=sa.UUID(), nullable=False)
