"""Add additive badminton manual match records."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0024_badminton_matches"
down_revision = "0023_badminton_courts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "matches",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("event_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("category_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("entry_a_registration_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("entry_b_registration_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("court_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("round_label", sa.String(length=160), nullable=False),
        sa.Column("scheduled_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=30), server_default="scheduled", nullable=False),
        sa.Column("winner", sa.String(length=20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["category_id"], ["event_categories.id"]),
        sa.ForeignKeyConstraint(["court_id"], ["courts.id"]),
        sa.ForeignKeyConstraint(["entry_a_registration_id"], ["registrations.id"]),
        sa.ForeignKeyConstraint(["entry_b_registration_id"], ["registrations.id"]),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_matches_event_id", "matches", ["event_id"], unique=False)
    op.create_index("ix_matches_category_id", "matches", ["category_id"], unique=False)
    op.create_index("ix_matches_entry_a_registration_id", "matches", ["entry_a_registration_id"], unique=False)
    op.create_index("ix_matches_entry_b_registration_id", "matches", ["entry_b_registration_id"], unique=False)
    op.create_index("ix_matches_court_id", "matches", ["court_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_matches_court_id", table_name="matches")
    op.drop_index("ix_matches_entry_b_registration_id", table_name="matches")
    op.drop_index("ix_matches_entry_a_registration_id", table_name="matches")
    op.drop_index("ix_matches_category_id", table_name="matches")
    op.drop_index("ix_matches_event_id", table_name="matches")
    op.drop_table("matches")
