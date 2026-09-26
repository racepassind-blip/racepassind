"""Record the payment method used for each Credit top-up request."""
from alembic import op
import sqlalchemy as sa

revision = "0057_credit_topup_payment_method"
down_revision = "0056_credit_payment_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("credit_topup_requests", sa.Column("payment_method", sa.String(length=30), nullable=False, server_default="UPI"))


def downgrade() -> None:
    op.drop_column("credit_topup_requests", "payment_method")
