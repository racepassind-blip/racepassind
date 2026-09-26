"""Add admin-managed Credit top-up payment settings."""
from alembic import op
import sqlalchemy as sa

revision = "0056_credit_payment_settings"
down_revision = "0055_credit_balance_constraints"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "credit_payment_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("method", sa.String(length=30), nullable=False, server_default="UPI"),
        sa.Column("upi_id", sa.String(length=255), nullable=True),
        sa.Column("payee_name", sa.String(length=160), nullable=False, server_default="SportPass India"),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("credit_payment_settings")
