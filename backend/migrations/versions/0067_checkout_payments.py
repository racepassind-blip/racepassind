"""Add shared payment identities and immutable receipt records."""
from alembic import op
import sqlalchemy as sa

revision = "0067_checkout_payments"
down_revision = "0066_product_sales"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("product_orders", sa.Column("archived_at", sa.DateTime(timezone=True)))
    op.create_table("checkout_payments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("product_order_id", sa.Uuid(), sa.ForeignKey("product_orders.id"), unique=True),
        sa.Column("event_order_id", sa.Uuid(), sa.ForeignKey("orders.id"), unique=True),
        sa.Column("mode", sa.String(32), nullable=False),
        sa.Column("amount_paise", sa.Integer(), nullable=False),
        sa.Column("fee_paise", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("fee_funding", sa.String(24), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("settlement_status", sa.String(32), nullable=False),
        sa.Column("vendor_id", sa.String(120)),
        sa.Column("provider_account", sa.String(120)),
        sa.Column("provider_environment", sa.String(16)),
        sa.Column("provider_order_id", sa.String(120)),
        sa.Column("request_fingerprint", sa.String(64)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("(product_order_id IS NULL) <> (event_order_id IS NULL)", name="ck_checkout_one_owner"),
        sa.CheckConstraint("amount_paise >= 0 AND fee_paise >= 0 AND fee_paise <= amount_paise", name="ck_checkout_amounts"),
        sa.CheckConstraint("mode IN ('DIRECT_UPI', 'MANUAL_OFFLINE', 'CASHFREE_PLATFORM', 'CASHFREE_SPLIT')", name="ck_checkout_mode"),
        sa.UniqueConstraint("provider_account", "provider_environment", "provider_order_id", name="uq_checkout_provider_order"))
    op.create_table("checkout_receipts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("checkout_payment_id", sa.Uuid(), sa.ForeignKey("checkout_payments.id"), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("account", sa.String(120), nullable=False),
        sa.Column("environment", sa.String(16), nullable=False),
        sa.Column("payment_id", sa.String(120), nullable=False),
        sa.Column("amount_paise", sa.Integer(), nullable=False),
        sa.Column("disposition", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("provider", "account", "environment", "payment_id", name="uq_checkout_receipt"))


def downgrade():
    # Financial data must not be discarded by a routine rollback.
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT count(*) FROM checkout_payments")):
        raise RuntimeError("Shared payment data exists; disable new checkout instead of dropping financial records")
    op.drop_table("checkout_receipts")
    op.drop_table("checkout_payments")
    op.drop_column("product_orders", "archived_at")
