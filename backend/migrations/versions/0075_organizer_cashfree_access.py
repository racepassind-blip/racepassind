"""Require explicit admin approval for organizer Cashfree collections."""

from alembic import op
import sqlalchemy as sa


revision = "0075_organizer_cashfree_access"
down_revision = "0074_automatic_registration_credits"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("organizations", sa.Column("allow_cashfree", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column("organizations", "allow_cashfree")
