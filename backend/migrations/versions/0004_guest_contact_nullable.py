"""Allow guest participants to register with phone only or email only."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0004_guest_contact_nullable"
down_revision = "0003_poc_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("participants", recreate="always") as batch_op:
            batch_op.alter_column(
                "email",
                existing_type=sa.String(),
                nullable=True,
            )
        return

    op.alter_column(
        "participants",
        "email",
        existing_type=sa.String(),
        nullable=True,
    )


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("participants", recreate="always") as batch_op:
            batch_op.alter_column(
                "email",
                existing_type=sa.String(),
                nullable=False,
            )
        return

    op.alter_column(
        "participants",
        "email",
        existing_type=sa.String(),
        nullable=False,
    )
