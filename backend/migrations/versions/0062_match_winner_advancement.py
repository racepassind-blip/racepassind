"""Add deterministic match links for automatic winner advancement."""

from alembic import op
import sqlalchemy as sa


revision = "0062_match_winner_advancement"
down_revision = "0061_admin_mfa"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("matches", sa.Column("bracket_position", sa.Integer(), nullable=True))
    op.add_column("matches", sa.Column("auto_advance", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("matches", sa.Column("next_match_id", sa.Uuid(), nullable=True))
    op.add_column("matches", sa.Column("next_match_slot", sa.String(length=16), nullable=True))
    op.create_foreign_key(
        "fk_matches_next_match_id_matches",
        "matches",
        "matches",
        ["next_match_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_check_constraint(
        "ck_matches_next_match_slot",
        "matches",
        "next_match_slot IS NULL OR next_match_slot IN ('entry_a', 'entry_b')",
    )

    # Existing configured-round matches receive a stable order before the
    # uniqueness constraint is enabled. Legacy label-only matches remain null.
    op.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT id,
                       row_number() OVER (
                           PARTITION BY round_id
                           ORDER BY scheduled_time NULLS LAST, created_at, id
                       ) - 1 AS position
                FROM matches
                WHERE round_id IS NOT NULL
            )
            UPDATE matches
            SET bracket_position = ranked.position
            FROM ranked
            WHERE matches.id = ranked.id
            """
        )
    )
    op.create_index("ix_matches_next_match_id", "matches", ["next_match_id"])
    op.execute(
        sa.text(
            "CREATE UNIQUE INDEX uq_matches_round_bracket_position "
            "ON matches (round_id, bracket_position) "
            "WHERE round_id IS NOT NULL AND bracket_position IS NOT NULL"
        )
    )
    op.execute(
        sa.text(
            "CREATE UNIQUE INDEX uq_matches_next_match_slot "
            "ON matches (next_match_id, next_match_slot) "
            "WHERE next_match_id IS NOT NULL AND next_match_slot IS NOT NULL"
        )
    )


def downgrade() -> None:
    op.drop_index("uq_matches_next_match_slot", table_name="matches")
    op.drop_index("uq_matches_round_bracket_position", table_name="matches")
    op.drop_index("ix_matches_next_match_id", table_name="matches")
    op.drop_constraint("ck_matches_next_match_slot", "matches", type_="check")
    op.drop_constraint("fk_matches_next_match_id_matches", "matches", type_="foreignkey")
    op.drop_column("matches", "next_match_slot")
    op.drop_column("matches", "next_match_id")
    op.drop_column("matches", "auto_advance")
    op.drop_column("matches", "bracket_position")
