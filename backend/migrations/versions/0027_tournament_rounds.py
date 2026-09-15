"""Add ordered tournament rounds and optional match links."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0027_tournament_rounds"
down_revision = "0026_category_entry_participants"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tournament_rounds",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("event_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("category_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["category_id"], ["event_categories.id"]),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("category_id", "position", name="uq_tournament_rounds_category_position"),
    )
    op.create_index("ix_tournament_rounds_event_id", "tournament_rounds", ["event_id"], unique=False)
    op.create_index("ix_tournament_rounds_category_id", "tournament_rounds", ["category_id"], unique=False)
    with op.batch_alter_table("matches", recreate="always") as batch_op:
        batch_op.add_column(sa.Column("round_id", sa.Uuid(as_uuid=True), nullable=True))
        batch_op.create_foreign_key(
            "fk_matches_round_id_tournament_rounds",
            "tournament_rounds",
            ["round_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index("ix_matches_round_id", "matches", ["round_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_matches_round_id", table_name="matches")
    with op.batch_alter_table("matches", recreate="always") as batch_op:
        batch_op.drop_constraint("fk_matches_round_id_tournament_rounds", type_="foreignkey")
        batch_op.drop_column("round_id")
    op.drop_index("ix_tournament_rounds_category_id", table_name="tournament_rounds")
    op.drop_index("ix_tournament_rounds_event_id", table_name="tournament_rounds")
    op.drop_table("tournament_rounds")
