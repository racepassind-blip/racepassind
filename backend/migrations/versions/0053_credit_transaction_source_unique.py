"""Make credit transaction sources idempotent."""
from alembic import op

revision = "0053_credit_transaction_source_unique"
down_revision = "0052_credit_topup_requests"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_unique_constraint("uq_credit_transactions_source", "credit_transactions", ["source_type", "source_id"])

def downgrade() -> None:
    op.drop_constraint("uq_credit_transactions_source", "credit_transactions", type_="unique")
