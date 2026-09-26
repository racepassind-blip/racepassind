"""Add global minimum and maximum SportPass fee bounds."""
from alembic import op
import sqlalchemy as sa

revision = "0050_platform_fee_bounds"
down_revision = "0049_organizer_platform_pricing"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column("platform_fee_configs", sa.Column("minimum_fee_paise", sa.Integer(), nullable=False, server_default="2000"))
    op.add_column("platform_fee_configs", sa.Column("maximum_fee_paise", sa.Integer(), nullable=False, server_default="6000"))

def downgrade() -> None:
    op.drop_column("platform_fee_configs", "maximum_fee_paise")
    op.drop_column("platform_fee_configs", "minimum_fee_paise")
