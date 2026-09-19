"""Add email logs schema.

This adds the email_logs table for centralized email tracking and
rate limiting (24-hour window with 480 email limit).

- EmailLog: tracks all sent emails with status, reference, timestamps
- Registration.email_status: quick status field for UI (PENDING/SENT/FAILED/PENDING_LIMIT)
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0035_email_logs"
down_revision = "0034_communication_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create email_logs table
    op.create_table(
        "email_logs",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("recipient", sa.String(length=320), nullable=False),
        sa.Column("subject", sa.String(length=500), nullable=False),
        sa.Column("email_type", sa.String(length=50), nullable=False),
        sa.Column("reference_type", sa.String(length=50), nullable=True),
        sa.Column("reference_id", sa.String(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("failure_reason", sa.String(length=200), nullable=True),
        sa.Column("provider", sa.String(length=50), nullable=False, server_default=sa.text("'gmail_smtp'")),
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_email_logs_recipient", "email_logs", ["recipient"], unique=False)
    op.create_index("ix_email_logs_email_type", "email_logs", ["email_type"], unique=False)
    op.create_index("ix_email_logs_reference_type", "email_logs", ["reference_type"], unique=False)
    op.create_index("ix_email_logs_reference_id", "email_logs", ["reference_id"], unique=False)
    op.create_index("ix_email_logs_status", "email_logs", ["status"], unique=False)

    # Add email_status column to registrations
    op.add_column(
        "registrations",
        sa.Column("email_status", sa.String(length=20), nullable=True, server_default=None),
    )
    op.create_index("ix_registrations_email_status", "registrations", ["email_status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_registrations_email_status", table_name="registrations")
    op.drop_column("registrations", "email_status")

    op.drop_index("ix_email_logs_status", table_name="email_logs")
    op.drop_index("ix_email_logs_reference_id", table_name="email_logs")
    op.drop_index("ix_email_logs_reference_type", table_name="email_logs")
    op.drop_index("ix_email_logs_email_type", table_name="email_logs")
    op.drop_index("ix_email_logs_recipient", table_name="email_logs")
    op.drop_table("email_logs")
