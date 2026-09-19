"""Add payment_collection_method to events

Revision ID: 0038_event_payment_collection_method
Revises: 0037_email_logs_is_resend
Create Date: 2026-09-20
"""

from alembic import op
import sqlalchemy as sa
import uuid

# revision identifiers, used by Alembic.
revision = "0038_event_payment_collection_method"
down_revision = "0037_email_logs_is_resend"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "events",
        sa.Column("payment_collection_method", sa.String(length=20), nullable=False, server_default="DIRECT_UPI"),
    )


def downgrade():
    op.drop_column("events", "payment_collection_method")
