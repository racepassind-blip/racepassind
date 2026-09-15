from __future__ import annotations

import uuid

from alembic import op
import sqlalchemy as sa

revision = "0026_category_entry_participants"
down_revision = "0025_badminton_scoring"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("event_categories", sa.Column("entry_type", sa.String(length=20), server_default="singles", nullable=False))
    op.add_column("event_categories", sa.Column("participants_per_entry", sa.Integer(), server_default="1", nullable=False))
    op.add_column("registrations", sa.Column("participant_count", sa.Integer(), server_default="1", nullable=False))
    op.create_table(
        "registration_participants",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("registration_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("participant_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("participant_index", sa.Integer(), nullable=False),
        sa.Column("responses", sa.JSON(), server_default=sa.text("'{}'"), nullable=False),
        sa.ForeignKeyConstraint(["registration_id"], ["registrations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["participant_id"], ["participants.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("registration_id", "participant_index", name="uq_registration_participants_index"),
        sa.UniqueConstraint("registration_id", "participant_id", name="uq_registration_participants_participant"),
    )
    op.create_index("ix_registration_participants_registration_id", "registration_participants", ["registration_id"], unique=False)
    op.create_index("ix_registration_participants_participant_id", "registration_participants", ["participant_id"], unique=False)

    connection = op.get_bind()
    rows = connection.execute(sa.text("SELECT id, participant_id FROM registrations")).all()
    membership_table = sa.table(
        "registration_participants",
        sa.column("id", sa.Uuid(as_uuid=True)),
        sa.column("registration_id", sa.Uuid(as_uuid=True)),
        sa.column("participant_id", sa.Uuid(as_uuid=True)),
        sa.column("participant_index", sa.Integer()),
        sa.column("responses", sa.JSON()),
    )
    if rows:
        connection.execute(
            membership_table.insert(),
            [
                {
                    "id": uuid.uuid4(),
                    "registration_id": registration_id,
                    "participant_id": participant_id,
                    "participant_index": 1,
                    "responses": {},
                }
                for registration_id, participant_id in rows
            ],
        )


def downgrade() -> None:
    op.drop_index("ix_registration_participants_participant_id", table_name="registration_participants")
    op.drop_index("ix_registration_participants_registration_id", table_name="registration_participants")
    op.drop_table("registration_participants")
    op.drop_column("registrations", "participant_count")
    op.drop_column("event_categories", "participants_per_entry")
    op.drop_column("event_categories", "entry_type")
