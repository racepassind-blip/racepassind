"""Add waiting list entries for capacity-controlled sports."""

from alembic import op
import sqlalchemy as sa

revision = "0085_waitlist_entries"
down_revision = "0084_refund_payment_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("events", sa.Column("waitlist_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False))
    op.create_table(
        "waitlist_entries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("ticket_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("normalized_email", sa.String(length=320), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="waiting", nullable=False),
        sa.Column("registration_id", sa.Uuid(), nullable=True),
        sa.Column("promoted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payment_due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"]),
        sa.ForeignKeyConstraint(["registration_id"], ["registrations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "normalized_email", name="uq_waitlist_event_email"),
    )
    op.create_index("ix_waitlist_entries_event_id", "waitlist_entries", ["event_id"])
    op.create_index("ix_waitlist_entries_ticket_id", "waitlist_entries", ["ticket_id"])
    op.create_index("ix_waitlist_event_status_position", "waitlist_entries", ["event_id", "status", "position"])
    op.create_index("ix_waitlist_entries_registration_id", "waitlist_entries", ["registration_id"])


def downgrade() -> None:
    op.drop_column("events", "waitlist_enabled")
    op.drop_index("ix_waitlist_event_status_position", table_name="waitlist_entries")
    op.drop_index("ix_waitlist_entries_registration_id", table_name="waitlist_entries")
    op.drop_index("ix_waitlist_entries_ticket_id", table_name="waitlist_entries")
    op.drop_index("ix_waitlist_entries_event_id", table_name="waitlist_entries")
    op.drop_table("waitlist_entries")
