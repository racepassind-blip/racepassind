"""Add event announcement web push subscriptions."""

from alembic import op
import sqlalchemy as sa


revision = "0079_push_subscriptions"
down_revision = "0078_event_announcements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("event_announcements", sa.Column("push_sent_at", sa.DateTime(timezone=True), nullable=True))
    # Do not replay announcements that were published before push existed.
    op.execute("UPDATE event_announcements SET push_sent_at = published_at WHERE status = 'PUBLISHED' AND published_at IS NOT NULL")
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("endpoint", sa.String(length=2048), nullable=False),
        sa.Column("p256dh", sa.String(length=255), nullable=False),
        sa.Column("auth", sa.String(length=255), nullable=False),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("enabled", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "event_id", "endpoint", name="uq_push_subscriptions_user_event_endpoint"),
    )
    op.create_index("ix_push_subscriptions_event_enabled", "push_subscriptions", ["event_id", "enabled"])
    op.create_index("ix_push_subscriptions_user_event", "push_subscriptions", ["user_id", "event_id"])


def downgrade() -> None:
    op.drop_index("ix_push_subscriptions_user_event", table_name="push_subscriptions")
    op.drop_index("ix_push_subscriptions_event_enabled", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
    op.drop_column("event_announcements", "push_sent_at")
