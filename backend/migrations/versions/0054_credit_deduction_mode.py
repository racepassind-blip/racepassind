"""Add organization Credit deduction mode."""
from alembic import op
import sqlalchemy as sa
revision = "0054_credit_deduction_mode"
down_revision = "0053_credit_transaction_source_unique"
branch_labels = None
depends_on = None
def upgrade() -> None:
    op.add_column("organizations", sa.Column("credit_deduction_mode", sa.String(length=40), nullable=False, server_default="AUTOMATIC_PER_REGISTRATION"))
def downgrade() -> None:
    op.drop_column("organizations", "credit_deduction_mode")
