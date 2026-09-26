"""Add encrypted TOTP MFA fields for admin users."""

from alembic import op
import sqlalchemy as sa

revision = "0061_admin_mfa"
down_revision = "0060_unique_event_allocation_numbers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("mfa_secret_encrypted", sa.String(length=512), nullable=True))
    op.add_column("users", sa.Column("mfa_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")))


def downgrade() -> None:
    op.drop_column("users", "mfa_enabled")
    op.drop_column("users", "mfa_secret_encrypted")
