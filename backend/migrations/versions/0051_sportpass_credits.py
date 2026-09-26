"""Add prepaid SportPass Credits account and immutable ledger."""
from alembic import op
import sqlalchemy as sa

revision = "0051_sportpass_credits"
down_revision = "0050_platform_fee_bounds"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        "organizer_credit_accounts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("balance_paise", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("organization_id", name="uq_organizer_credit_accounts_organization_id"),
    )
    op.create_index("ix_organizer_credit_accounts_organization_id", "organizer_credit_accounts", ["organization_id"], unique=True)
    op.create_table(
        "credit_transactions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("type", sa.String(length=40), nullable=False),
        sa.Column("amount_paise", sa.Integer(), nullable=False),
        sa.Column("balance_before_paise", sa.Integer(), nullable=False),
        sa.Column("balance_after_paise", sa.Integer(), nullable=False),
        sa.Column("event_id", sa.Uuid(), sa.ForeignKey("events.id"), nullable=True),
        sa.Column("registration_id", sa.Uuid(), sa.ForeignKey("registrations.id"), nullable=True),
        sa.Column("source_type", sa.String(length=80), nullable=True),
        sa.Column("source_id", sa.String(length=200), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_credit_transactions_organization_created_at", "credit_transactions", ["organization_id", "created_at"])

def downgrade() -> None:
    op.drop_table("credit_transactions")
    op.drop_index("ix_organizer_credit_accounts_organization_id", table_name="organizer_credit_accounts")
    op.drop_table("organizer_credit_accounts")
