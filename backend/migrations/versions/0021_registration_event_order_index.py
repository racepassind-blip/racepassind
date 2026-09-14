from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0021_registration_event_order_index"
down_revision = "0020_event_whatsapp_group_link"
branch_labels = None
depends_on = None

_INDEX_NAME = "ix_registrations_event_created_id"
_INDEX_COLUMNS = ["event_id", "created_at", "id"]


def upgrade() -> None:
    existing = {index["name"] for index in sa.inspect(op.get_bind()).get_indexes("registrations")}
    if _INDEX_NAME not in existing:
        op.create_index(_INDEX_NAME, "registrations", _INDEX_COLUMNS)


def downgrade() -> None:
    existing = {index["name"] for index in sa.inspect(op.get_bind()).get_indexes("registrations")}
    if _INDEX_NAME in existing:
        op.drop_index(_INDEX_NAME, table_name="registrations")
