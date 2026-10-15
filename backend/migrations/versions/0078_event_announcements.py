"""Add public event announcements."""

from alembic import op
import sqlalchemy as sa


revision = "0078_event_announcements"
down_revision = "0077_registration_attribution"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "event_announcements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=180), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="DRAFT", nullable=False),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_pinned", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED')", name="ck_event_announcement_status"),
        sa.CheckConstraint("(status = 'SCHEDULED' AND scheduled_for IS NOT NULL) OR (status <> 'SCHEDULED')", name="ck_event_announcement_schedule"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_event_announcements_event_id", "event_announcements", ["event_id"])
    op.create_index("ix_event_announcements_status", "event_announcements", ["status"])
    op.create_index("ix_event_announcements_event_status_published", "event_announcements", ["event_id", "status", "published_at"])
    op.create_index(
        "uq_event_announcements_event_pinned",
        "event_announcements",
        ["event_id"],
        unique=True,
        postgresql_where=sa.text("is_pinned = true AND status = 'PUBLISHED'"),
        sqlite_where=sa.text("is_pinned = 1 AND status = 'PUBLISHED'"),
    )


def downgrade() -> None:
    op.drop_index("uq_event_announcements_event_pinned", table_name="event_announcements")
    op.drop_index("ix_event_announcements_event_status_published", table_name="event_announcements")
    op.drop_index("ix_event_announcements_status", table_name="event_announcements")
    op.drop_index("ix_event_announcements_event_id", table_name="event_announcements")
    op.drop_table("event_announcements")
