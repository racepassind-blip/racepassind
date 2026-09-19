"""Add event_id to email_logs for event mapping.

This allows querying all emails and recipients associated with an event,
enabling broadcast/update emails to all registrants of an event.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0036_email_logs_event_id"
down_revision = "0035_email_logs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "email_logs",
        sa.Column("event_id", sa.Uuid(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_email_logs_event_id",
        "email_logs",
        "events",
        ["event_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_email_logs_event_id", "email_logs", ["event_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_email_logs_event_id", table_name="email_logs")
    op.drop_constraint("fk_email_logs_event_id", "email_logs", type_="foreignkey")
    op.drop_column("email_logs", "event_id")
