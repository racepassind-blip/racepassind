"""Add ordered event checkpoints and scope check-in scans per checkpoint."""

from __future__ import annotations

import datetime as dt
import uuid

from alembic import op
import sqlalchemy as sa

revision = "0028_event_checkpoints"
down_revision = "0027_tournament_rounds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "event_checkpoints",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("event_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "position", name="uq_event_checkpoints_event_position"),
        sa.UniqueConstraint("event_id", "name", name="uq_event_checkpoints_event_name"),
    )
    op.create_index("ix_event_checkpoints_event_id", "event_checkpoints", ["event_id"], unique=False)
    op.create_index("ix_event_checkpoints_event_position", "event_checkpoints", ["event_id", "position"], unique=False)

    connection = op.get_bind()
    events = connection.execute(sa.text("SELECT id FROM events")).all()
    checkpoint_ids = {}
    for (event_id,) in events:
        checkpoint_id = uuid.uuid4()
        checkpoint_ids[event_id] = checkpoint_id
        connection.execute(
            sa.text(
                "INSERT INTO event_checkpoints (id, event_id, name, position) "
                "VALUES (:id, :event_id, :name, :position)"
            ),
            {"id": checkpoint_id, "event_id": event_id, "name": "Check-In", "position": 1},
        )

    op.add_column("checkins", sa.Column("checkpoint_id", sa.Uuid(as_uuid=True), nullable=True))
    connection = op.get_bind()
    legacy_scans = connection.execute(
        sa.text(
            "SELECT checkins.id, registrations.event_id "
            "FROM checkins JOIN registrations ON registrations.id = checkins.registration_id"
        )
    ).all()
    for checkin_id, event_id in legacy_scans:
        checkpoint_id = checkpoint_ids.get(event_id)
        if checkpoint_id is not None:
            connection.execute(
                sa.text("UPDATE checkins SET checkpoint_id = :checkpoint_id WHERE id = :checkin_id"),
                {"checkpoint_id": checkpoint_id, "checkin_id": checkin_id},
            )

    # Some legacy rows only carried the boolean/status summary and never wrote an audit row.
    # Materialize those summaries as default-checkpoint scans as well.
    missing_legacy_scans = connection.execute(
        sa.text(
            "SELECT registrations.id, registrations.event_id, registrations.checked_in_at "
            "FROM registrations LEFT JOIN checkins ON checkins.registration_id = registrations.id "
            "WHERE (registrations.checked_in OR registrations.status = 'checked_in') "
            "AND checkins.id IS NULL"
        )
    ).all()
    for registration_id, event_id, checked_in_at in missing_legacy_scans:
        checkpoint_id = checkpoint_ids.get(event_id)
        if checkpoint_id is not None:
            connection.execute(
                sa.text(
                    "INSERT INTO checkins (id, registration_id, checkpoint_id, checked_in_at) "
                    "VALUES (:id, :registration_id, :checkpoint_id, :checked_in_at)"
                ),
                {
                    "id": uuid.uuid4(),
                    "registration_id": registration_id,
                    "checkpoint_id": checkpoint_id,
                    "checked_in_at": checked_in_at or dt.datetime.now(dt.timezone.utc),
                },
            )

    # Earlier revisions used either name depending on whether the equivalent
    # unique index was created by 0003 or 0009.
    existing_indexes = {index["name"] for index in sa.inspect(connection).get_indexes("checkins")}
    if "uq_checkins_registration_id" in existing_indexes:
        op.drop_index("uq_checkins_registration_id", table_name="checkins")
    elif "ix_checkins_registration_id_unique" in existing_indexes:
        op.drop_index("ix_checkins_registration_id_unique", table_name="checkins")
    with op.batch_alter_table("checkins", recreate="always") as batch_op:
        batch_op.create_foreign_key(
            "fk_checkins_checkpoint_id_event_checkpoints",
            "event_checkpoints",
            ["checkpoint_id"],
            ["id"],
            ondelete="CASCADE",
        )
    op.create_index(
        "uq_checkins_registration_checkpoint_id",
        "checkins",
        ["registration_id", "checkpoint_id"],
        unique=True,
    )
    op.create_index(
        "uq_checkins_legacy_registration_id",
        "checkins",
        ["registration_id"],
        unique=True,
        sqlite_where=sa.text("checkpoint_id IS NULL"),
        postgresql_where=sa.text("checkpoint_id IS NULL"),
    )
    op.create_index(
        "ix_checkins_checkpoint_id_checked_in_at",
        "checkins",
        ["checkpoint_id", "checked_in_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_checkins_checkpoint_id_checked_in_at", table_name="checkins")
    op.drop_index("uq_checkins_legacy_registration_id", table_name="checkins")
    op.drop_index("uq_checkins_registration_checkpoint_id", table_name="checkins")
    with op.batch_alter_table("checkins", recreate="always") as batch_op:
        batch_op.drop_constraint("fk_checkins_checkpoint_id_event_checkpoints", type_="foreignkey")
        batch_op.drop_column("checkpoint_id")
    op.create_index("uq_checkins_registration_id", "checkins", ["registration_id"], unique=True)
    op.drop_index("ix_event_checkpoints_event_position", table_name="event_checkpoints")
    op.drop_index("ix_event_checkpoints_event_id", table_name="event_checkpoints")
    op.drop_table("event_checkpoints")
