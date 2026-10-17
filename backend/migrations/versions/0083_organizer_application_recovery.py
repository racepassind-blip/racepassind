"""Add password recovery for pending organizer applications."""

from alembic import op
import sqlalchemy as sa

revision = "0083_organizer_application_recovery"
down_revision = "0082_organizer_application_verification"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("organizer_applications", sa.Column("recovery_token_hash", sa.String(length=64), nullable=True))
    op.add_column("organizer_applications", sa.Column("recovery_expires_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("organizer_applications", "recovery_expires_at")
    op.drop_column("organizer_applications", "recovery_token_hash")
