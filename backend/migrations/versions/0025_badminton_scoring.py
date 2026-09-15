"""Add additive badminton scoring configuration and match scores."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0025_badminton_scoring"
down_revision = "0024_badminton_matches"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "badminton_category_scoring",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("event_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("category_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("games_to_win", sa.Integer(), server_default="2", nullable=False),
        sa.Column("points_per_game", sa.Integer(), server_default="21", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["category_id"], ["event_categories.id"]),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("category_id", name="uq_badminton_category_scoring_category"),
    )
    op.create_index("ix_badminton_category_scoring_event_id", "badminton_category_scoring", ["event_id"], unique=False)
    op.create_index("ix_badminton_category_scoring_category_id", "badminton_category_scoring", ["category_id"], unique=False)
    op.add_column("matches", sa.Column("games_to_win", sa.Integer(), server_default="2", nullable=False))
    op.add_column("matches", sa.Column("points_per_game", sa.Integer(), server_default="21", nullable=False))
    op.add_column("matches", sa.Column("games", sa.JSON(), server_default=sa.text("'[]'"), nullable=False))


def downgrade() -> None:
    op.drop_column("matches", "games")
    op.drop_column("matches", "points_per_game")
    op.drop_column("matches", "games_to_win")
    op.drop_index("ix_badminton_category_scoring_category_id", table_name="badminton_category_scoring")
    op.drop_index("ix_badminton_category_scoring_event_id", table_name="badminton_category_scoring")
    op.drop_table("badminton_category_scoring")
