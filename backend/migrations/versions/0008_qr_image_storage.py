"""Add backend-owned organizer QR image storage metadata.

Revision ID: 0008_qr_image_storage
Revises: 0007_organizer_registration_indexes
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0008_qr_image_storage"
down_revision: Union[str, None] = "0007_organizer_registration_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = {
    "qr_image_object_key": sa.Column("qr_image_object_key", sa.String(), nullable=True),
    "qr_image_content_type": sa.Column("qr_image_content_type", sa.String(), nullable=True),
    "qr_image_size_bytes": sa.Column("qr_image_size_bytes", sa.Integer(), nullable=True),
    "qr_image_width": sa.Column("qr_image_width", sa.Integer(), nullable=True),
    "qr_image_height": sa.Column("qr_image_height", sa.Integer(), nullable=True),
    "qr_image_uploaded_at": sa.Column("qr_image_uploaded_at", sa.DateTime(timezone=True), nullable=True),
}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {column["name"] for column in inspector.get_columns("event_payment_settings")}
    existing_constraints = {constraint.get("name") for constraint in inspector.get_unique_constraints("event_payment_settings")}
    with op.batch_alter_table("event_payment_settings") as batch_op:
        for name, column in _COLUMNS.items():
            if name not in existing_columns:
                batch_op.add_column(column)
        if "uq_event_payment_settings_qr_image_object_key" not in existing_constraints:
            batch_op.create_unique_constraint(
                "uq_event_payment_settings_qr_image_object_key",
                ["qr_image_object_key"],
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_columns = {column["name"] for column in inspector.get_columns("event_payment_settings")}
    existing_constraints = {constraint.get("name") for constraint in inspector.get_unique_constraints("event_payment_settings")}
    with op.batch_alter_table("event_payment_settings") as batch_op:
        if "uq_event_payment_settings_qr_image_object_key" in existing_constraints:
            batch_op.drop_constraint("uq_event_payment_settings_qr_image_object_key", type_="unique")
        for name in reversed(tuple(_COLUMNS)):
            if name in existing_columns:
                batch_op.drop_column(name)
