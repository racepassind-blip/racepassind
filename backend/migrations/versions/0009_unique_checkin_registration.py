"""Prevent duplicate check-in rows for one registration.

Revision ID: 0009_unique_checkin_registration
Revises: 0008_qr_image_storage
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect


revision: str = "0009_unique_checkin_registration"
down_revision: Union[str, None] = "0008_qr_image_storage"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    index_names = {index["name"] for index in inspect(bind).get_indexes("checkins")}
    # 0003 already created an equivalent unique index. Do not add a second
    # physical index when upgrading a fresh database through the full chain.
    if "ix_checkins_registration_id_unique" not in index_names and "uq_checkins_registration_id" not in index_names:
        op.create_index("uq_checkins_registration_id", "checkins", ["registration_id"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    index_names = {index["name"] for index in inspect(bind).get_indexes("checkins")}
    if "uq_checkins_registration_id" in index_names:
        op.drop_index("uq_checkins_registration_id", table_name="checkins")
