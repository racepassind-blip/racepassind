"""Remove retired Clerk identity and webhook storage."""

from alembic import op
import sqlalchemy as sa


revision = "0080_remove_clerk_integration"
down_revision = "0079_push_subscriptions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("clerk_webhook_events")
    op.drop_index("ix_users_clerk_user_id", table_name="users")
    op.drop_column("users", "clerk_deleted_at")
    op.drop_column("users", "clerk_user_id")


def downgrade() -> None:
    op.add_column("users", sa.Column("clerk_user_id", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("clerk_deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_users_clerk_user_id", "users", ["clerk_user_id"], unique=True)
    op.create_table(
        "clerk_webhook_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.String(length=128), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id"),
    )
    op.create_index("ix_clerk_webhook_events_event_id", "clerk_webhook_events", ["event_id"], unique=True)
