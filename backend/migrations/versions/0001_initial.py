from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "events",
        sa.Column("id", sa.String(), primary_key=True, nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("date", sa.String(), nullable=False),
        sa.Column("location", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("image", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("distance", sa.String(), nullable=False),
        sa.Column("participants", sa.Integer(), nullable=False),
        sa.Column("maxParticipants", sa.Integer(), nullable=False),
        sa.Column("organizer", sa.String(), nullable=False),
        sa.Column("rules", sa.JSON(), nullable=False),
    )

    op.create_table(
        "ticket_tiers",
        sa.Column("id", sa.String(), primary_key=True, nullable=False),
        sa.Column("event_id", sa.String(), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("price", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("available", sa.Integer(), nullable=False),
    )
    op.create_index("ix_ticket_tiers_event_id", "ticket_tiers", ["event_id"])


def downgrade() -> None:
    op.drop_index("ix_ticket_tiers_event_id", table_name="ticket_tiers")
    op.drop_table("ticket_tiers")
    op.drop_table("events")
