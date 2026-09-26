"""Add explicit approval state for public match results."""

from alembic import op
import sqlalchemy as sa


revision = "0063_match_result_approval"
down_revision = "0062_match_winner_advancement"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("matches", sa.Column("result_approved_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("matches", sa.Column("result_approved_by", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_matches_result_approved_by_users",
        "matches",
        "users",
        ["result_approved_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_matches_result_approved_at", "matches", ["result_approved_at"])


def downgrade() -> None:
    op.drop_index("ix_matches_result_approved_at", table_name="matches")
    op.drop_constraint("fk_matches_result_approved_by_users", "matches", type_="foreignkey")
    op.drop_column("matches", "result_approved_by")
    op.drop_column("matches", "result_approved_at")
