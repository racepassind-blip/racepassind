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
    with op.batch_alter_table("matches", recreate="always") as batch_op:
        # "singles" or "doubles" — only set for team-category matches, else NULL
        batch_op.add_column(sa.Column("match_type", sa.String(length=20), nullable=True))
        # JSON arrays of registration_participant ids chosen from each team's roster
        batch_op.add_column(sa.Column("player_a_participant_ids", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("player_b_participant_ids", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("matches", recreate="always") as batch_op:
        batch_op.drop_column("player_b_participant_ids")
        batch_op.drop_column("player_a_participant_ids")
        batch_op.drop_column("match_type")
