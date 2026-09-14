"""Track completion of the lightweight organizer setup."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0013_organizer_onboarding_completion"
down_revision: Union[str, None] = "0012_organizer_event_billing"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("onboarding_completed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("organizations", "onboarding_completed_at")
