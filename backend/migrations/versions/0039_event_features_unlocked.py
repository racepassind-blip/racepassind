"""Add features_unlocked admin override to events

Revision ID: 0039_event_features_unlocked
Revises: 0038_event_payment_collection_method
Create Date: 2026-09-20
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0039_event_features_unlocked"
down_revision = "0038_event_payment_collection_method"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "events",
        sa.Column("features_unlocked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade():
    op.drop_column("events", "features_unlocked")
