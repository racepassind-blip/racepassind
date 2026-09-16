"""Create match_bouts table and add winner_by column to matches."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0031_match_bouts"
down_revision = "0030_team_match_scoring"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add winner_by to matches (nullable — only meaningful for team-format matches)
    with op.batch_alter_table("matches", recreate="always") as batch_op:
        batch_op.add_column(sa.Column("winner_by", sa.String(length=20), nullable=True))

    op.create_table(
        "match_bouts",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("match_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("event_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("court_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("player_a_reg_participant_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("player_b_reg_participant_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("player_a_name", sa.String(length=160), nullable=True),
        sa.Column("player_b_name", sa.String(length=160), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="scheduled"),
        sa.Column("winner", sa.String(length=20), nullable=True),
        sa.Column("score_a", sa.Integer(), nullable=True),
        sa.Column("score_b", sa.Integer(), nullable=True),
        sa.Column("scheduled_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"]),
        sa.ForeignKeyConstraint(["court_id"], ["courts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["player_a_reg_participant_id"],
            ["registration_participants.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["player_b_reg_participant_id"],
            ["registration_participants.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_match_bouts_match_id", "match_bouts", ["match_id"], unique=False)
    op.create_index("ix_match_bouts_event_id", "match_bouts", ["event_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_match_bouts_event_id", table_name="match_bouts")
    op.drop_index("ix_match_bouts_match_id", table_name="match_bouts")
    op.drop_table("match_bouts")
    with op.batch_alter_table("matches", recreate="always") as batch_op:
        batch_op.drop_column("winner_by")
