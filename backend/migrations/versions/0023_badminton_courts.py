"""Add additive badminton court records."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0023_badminton_courts"
down_revision = "0022_manual_registration_payment"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "courts",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("event_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "name", name="uq_courts_event_name"),
    )
    op.create_index("ix_courts_event_id", "courts", ["event_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_courts_event_id", table_name="courts")
    op.drop_table("courts")
