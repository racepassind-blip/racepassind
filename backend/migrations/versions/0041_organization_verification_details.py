"""Add name-as-per-PAN, GST flag, and structured billing to organizations

Revision ID: 0041_organization_verification_details
Revises: 0040_organization_paid_verification
Create Date: 2026-09-20
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0041_organization_verification_details"
down_revision = "0040_organization_paid_verification"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("organizations", sa.Column("name_as_per_pan", sa.String(length=200), nullable=True))
    op.add_column(
        "organizations",
        sa.Column("gst_registered", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("organizations", sa.Column("billing_city", sa.String(length=120), nullable=True))
    op.add_column("organizations", sa.Column("billing_state", sa.String(length=120), nullable=True))
    op.add_column("organizations", sa.Column("billing_pincode", sa.String(length=10), nullable=True))


def downgrade():
    op.drop_column("organizations", "billing_pincode")
    op.drop_column("organizations", "billing_state")
    op.drop_column("organizations", "billing_city")
    op.drop_column("organizations", "gst_registered")
    op.drop_column("organizations", "name_as_per_pan")
