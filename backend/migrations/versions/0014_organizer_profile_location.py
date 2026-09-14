"""Add lightweight organizer profile type and location fields."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0014_organizer_profile_location"
down_revision: Union[str, None] = "0013_organizer_onboarding_completion"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("organization_type", sa.String(), nullable=True))
    op.add_column("organizations", sa.Column("city", sa.String(), nullable=True))
    op.add_column("organizations", sa.Column("state", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("organizations", "state")
    op.drop_column("organizations", "city")
    op.drop_column("organizations", "organization_type")
