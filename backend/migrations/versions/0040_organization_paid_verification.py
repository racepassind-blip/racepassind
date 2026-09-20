"""Add paid organizer verification fields to organizations

Revision ID: 0040_organization_paid_verification
Revises: 0039_event_features_unlocked
Create Date: 2026-09-20
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0040_organization_paid_verification"
down_revision = "0039_event_features_unlocked"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "organizations",
        sa.Column(
            "paid_verification_status",
            sa.String(),
            nullable=False,
            server_default="NOT_SUBMITTED",
        ),
    )
    op.add_column("organizations", sa.Column("pan_number", sa.String(length=10), nullable=True))
    op.add_column("organizations", sa.Column("gst_number", sa.String(length=15), nullable=True))
    op.add_column("organizations", sa.Column("billing_name", sa.String(length=200), nullable=True))
    op.add_column("organizations", sa.Column("billing_address", sa.Text(), nullable=True))
    op.add_column(
        "organizations",
        sa.Column("paid_verification_submitted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "organizations",
        sa.Column("paid_verification_reviewed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "organizations",
        sa.Column("paid_verification_reviewed_by", sa.Uuid(as_uuid=True), nullable=True),
    )
    op.add_column(
        "organizations",
        sa.Column("paid_verification_rejection_reason", sa.Text(), nullable=True),
    )
    op.create_foreign_key(
        "fk_organizations_paid_verification_reviewed_by_users",
        "organizations",
        "users",
        ["paid_verification_reviewed_by"],
        ["id"],
    )
    op.create_index(
        "ix_organizations_paid_verification_status",
        "organizations",
        ["paid_verification_status"],
    )


def downgrade():
    op.drop_index("ix_organizations_paid_verification_status", table_name="organizations")
    op.drop_constraint(
        "fk_organizations_paid_verification_reviewed_by_users",
        "organizations",
        type_="foreignkey",
    )
    op.drop_column("organizations", "paid_verification_rejection_reason")
    op.drop_column("organizations", "paid_verification_reviewed_by")
    op.drop_column("organizations", "paid_verification_reviewed_at")
    op.drop_column("organizations", "paid_verification_submitted_at")
    op.drop_column("organizations", "billing_address")
    op.drop_column("organizations", "billing_name")
    op.drop_column("organizations", "gst_number")
    op.drop_column("organizations", "pan_number")
    op.drop_column("organizations", "paid_verification_status")
