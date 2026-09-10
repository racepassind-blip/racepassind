from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0007_organizer_registration_indexes"
down_revision = "0006_registration_claim_lifecycle"
branch_labels = None
depends_on = None


_INDEXES = (
    ("ix_registrations_event_status_created_id", ["event_id", "status", "created_at", "id"]),
    ("ix_registrations_event_checked_created_id", ["event_id", "checked_in", "created_at", "id"]),
)


def upgrade() -> None:
    existing = {index["name"] for index in sa.inspect(op.get_bind()).get_indexes("registrations")}
    for name, columns in _INDEXES:
        if name not in existing:
            op.create_index(name, "registrations", columns)


def downgrade() -> None:
    existing = {index["name"] for index in sa.inspect(op.get_bind()).get_indexes("registrations")}
    for name, _ in reversed(_INDEXES):
        if name in existing:
            op.drop_index(name, table_name="registrations")
