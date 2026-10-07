"""Record Clerk webhook deliveries for retry-safe processing."""
from alembic import op
import sqlalchemy as sa

revision = "0070_clerk_webhook_events"
down_revision = "0069_clerk_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "clerk_webhook_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("event_id", sa.String(128), nullable=False, unique=True),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True)),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_clerk_webhook_events_event_id", "clerk_webhook_events", ["event_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_clerk_webhook_events_event_id", table_name="clerk_webhook_events")
    op.drop_table("clerk_webhook_events")
