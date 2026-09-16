"""Add per-match player selection for team-format matches.

These columns are only populated for matches whose category is a team category.
They let organizers pick which specific team members play a given match
(singles = 1 per team, doubles = 2 per team). For singles/doubles categories the
columns stay NULL and existing behaviour is unchanged.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0032_match_player_selection"
down_revision = "0031_match_bouts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Plain ADD COLUMN works natively on PostgreSQL and avoids rebuilding the
    # matches table (which would fail because match_bouts has an FK on matches_pkey).
    # "match_type" is "singles" or "doubles" — only set for team-category matches.
    op.add_column("matches", sa.Column("match_type", sa.String(length=20), nullable=True))
    # JSON arrays of registration_participant ids chosen from each team's roster.
    op.add_column("matches", sa.Column("player_a_participant_ids", sa.JSON(), nullable=True))
    op.add_column("matches", sa.Column("player_b_participant_ids", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("matches", "player_b_participant_ids")
    op.drop_column("matches", "player_a_participant_ids")
    op.drop_column("matches", "match_type")
