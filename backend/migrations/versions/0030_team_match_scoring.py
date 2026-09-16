"""Create team_match_scoring table for flexible point rules."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0030_team_match_scoring"
down_revision = "0029_team_size_range"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "team_match_scoring",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("event_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("category_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("points_for_win", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("points_for_draw", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("points_for_loss", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("winner_by", sa.String(length=20), nullable=False, server_default="bouts"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["category_id"], ["event_categories.id"]),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("category_id", name="uq_team_match_scoring_category"),
    )
    op.create_index("ix_team_match_scoring_event_id", "team_match_scoring", ["event_id"], unique=False)
    op.create_index("ix_team_match_scoring_category_id", "team_match_scoring", ["category_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_team_match_scoring_category_id", table_name="team_match_scoring")
    op.drop_index("ix_team_match_scoring_event_id", table_name="team_match_scoring")
    op.drop_table("team_match_scoring")
