"""Add moderated organizer applications.

Revision ID: 0010_organizer_applications
Revises: 0009_unique_checkin_registration
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0010_organizer_applications"
down_revision: Union[str, None] = "0009_unique_checkin_registration"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "organizer_applications",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("organization_name", sa.String(), nullable=False),
        sa.Column("applicant_name", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("normalized_email", sa.String(), nullable=False),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("normalized_phone", sa.String(), nullable=True),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("status", sa.String(), server_default="pending", nullable=False),
        sa.Column("reviewed_by", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("approved_user_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["approved_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("approved_user_id", name="uq_organizer_applications_approved_user_id"),
    )
    op.create_index(
        "ix_organizer_applications_status_created_at",
        "organizer_applications",
        ["status", "created_at"],
    )
    op.create_index(
        "ix_organizer_applications_normalized_email",
        "organizer_applications",
        ["normalized_email"],
    )
    op.create_index(
        "ix_organizer_applications_reviewed_by",
        "organizer_applications",
        ["reviewed_by"],
    )


def downgrade() -> None:
    op.drop_index("ix_organizer_applications_reviewed_by", table_name="organizer_applications")
    op.drop_index("ix_organizer_applications_normalized_email", table_name="organizer_applications")
    op.drop_index("ix_organizer_applications_status_created_at", table_name="organizer_applications")
    op.drop_table("organizer_applications")
