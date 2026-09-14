from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0019_registration_form_status"
down_revision: Union[str, None] = "0018_dynamic_registration_config"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("registration_status", sa.String(), nullable=False, server_default=sa.text("'open'")),
    )


def downgrade() -> None:
    op.drop_column("events", "registration_status")
