"""Add organizer-managed event schedules."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0016_event_schedule"
down_revision: Union[str, None] = "0015_pricing_model_update"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("schedule", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )


def downgrade() -> None:
    op.drop_column("events", "schedule")
