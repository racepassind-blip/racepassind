"""Add is_resend flag to email_logs

Revision ID: 0037_email_logs_is_resend
Revises: 0036_email_logs_event_id
Create Date: 2026-09-19
"""

from alembic import op
import sqlalchemy as sa
import uuid

# revision identifiers, used by Alembic.
revision = "0037_email_logs_is_resend"
down_revision = "0036_email_logs_event_id"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "email_logs",
        sa.Column("is_resend", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade():
    op.drop_column("email_logs", "is_resend")
