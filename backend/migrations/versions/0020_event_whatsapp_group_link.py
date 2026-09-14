from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0020_event_whatsapp_group_link"
down_revision: Union[str, None] = "0019_registration_form_status"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("events", sa.Column("whatsapp_group_url", sa.String(length=2000), nullable=True))


def downgrade() -> None:
    op.drop_column("events", "whatsapp_group_url")
