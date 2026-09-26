"""Enforce non-negative Credit balances and valid ledger amounts."""
from alembic import op

revision = "0055_credit_balance_constraints"
down_revision = "0054_credit_deduction_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("organizer_credit_accounts") as batch_op:
        batch_op.create_check_constraint("ck_organizer_credit_accounts_nonnegative_balance", "balance_paise >= 0")
    with op.batch_alter_table("credit_transactions") as batch_op:
        batch_op.create_check_constraint("ck_credit_transactions_positive_amount", "amount_paise > 0")
        batch_op.create_check_constraint("ck_credit_transactions_nonnegative_before", "balance_before_paise >= 0")
        batch_op.create_check_constraint("ck_credit_transactions_nonnegative_after", "balance_after_paise >= 0")


def downgrade() -> None:
    with op.batch_alter_table("credit_transactions") as batch_op:
        batch_op.drop_constraint("ck_credit_transactions_nonnegative_after", type_="check")
        batch_op.drop_constraint("ck_credit_transactions_nonnegative_before", type_="check")
        batch_op.drop_constraint("ck_credit_transactions_positive_amount", type_="check")
    with op.batch_alter_table("organizer_credit_accounts") as batch_op:
        batch_op.drop_constraint("ck_organizer_credit_accounts_nonnegative_balance", type_="check")
