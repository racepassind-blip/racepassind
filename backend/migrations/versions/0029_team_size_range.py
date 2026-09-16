"""Add team_size_min and team_size_max to event_categories."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0029_team_size_range"
down_revision = "0028_event_checkpoints"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("event_categories", sa.Column("team_size_min", sa.Integer(), nullable=True))
    op.add_column("event_categories", sa.Column("team_size_max", sa.Integer(), nullable=True))
    # Backfill: existing team categories get min=max=participants_per_entry
    op.execute(
        """
        UPDATE event_categories
        SET team_size_min = participants_per_entry,
            team_size_max = participants_per_entry
        WHERE entry_type = 'team'
        """
    )


def downgrade() -> None:
    op.drop_column("event_categories", "team_size_max")
    op.drop_column("event_categories", "team_size_min")
