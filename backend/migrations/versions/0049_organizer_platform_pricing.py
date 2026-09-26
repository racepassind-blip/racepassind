"""Add future-safe organizer-specific SportPass pricing inputs."""

from alembic import op
import sqlalchemy as sa

revision = "0049_organizer_platform_pricing"
down_revision = "0048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("platform_pricing_mode", sa.String(length=32), nullable=False, server_default="DEFAULT"))
    op.add_column("organizations", sa.Column("platform_fee_percentage_basis_points", sa.Integer(), nullable=True))
    op.add_column("organizations", sa.Column("platform_fee_min_paise", sa.Integer(), nullable=True))
    op.add_column("organizations", sa.Column("platform_fee_max_paise", sa.Integer(), nullable=True))
    op.add_column("organizations", sa.Column("platform_fee_fixed_paise", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("organizations", "platform_fee_fixed_paise")
    op.drop_column("organizations", "platform_fee_max_paise")
    op.drop_column("organizations", "platform_fee_min_paise")
    op.drop_column("organizations", "platform_fee_percentage_basis_points")
    op.drop_column("organizations", "platform_pricing_mode")
