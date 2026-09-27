"""Repair databases missing auto_advance despite recording revision 0062."""

from alembic import op
import sqlalchemy as sa


revision = "0065_repair_match_auto_advance"
down_revision = "0064_match_duration"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("matches")}
    if "auto_advance" not in columns:
        op.add_column(
            "matches",
            sa.Column("auto_advance", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )


def downgrade() -> None:
    # This column belongs to 0062 and must still exist when returning to 0064.
    pass
