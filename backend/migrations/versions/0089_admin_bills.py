"""Independent admin bills with immutable issue details."""
from alembic import op
import sqlalchemy as sa

revision = "0089_admin_bills"
down_revision = "0088_ai_inference_leases"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "admin_bills",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("event_id", sa.Uuid(), sa.ForeignKey("events.id"), nullable=True),
        sa.Column("idempotency_key", sa.Uuid(), nullable=False, unique=True),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("total_paise", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("payment_reference", sa.String(200), nullable=True),
        sa.Column("paid_on", sa.Date(), nullable=True),
        sa.Column("cancellation_reason", sa.String(1000), nullable=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("total_paise >= 0", name="ck_admin_bill_total"),
        sa.CheckConstraint("status IN ('PENDING', 'PAID', 'CANCELLED')", name="ck_admin_bill_status"),
    )
    op.create_index("ix_admin_bills_organization_id", "admin_bills", ["organization_id"])


def downgrade():
    op.drop_table("admin_bills")
