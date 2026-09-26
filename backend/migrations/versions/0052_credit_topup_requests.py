"""Add organizer UPI Credit top-up requests."""
from alembic import op
import sqlalchemy as sa

revision = "0052_credit_topup_requests"
down_revision = "0051_sportpass_credits"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        "credit_topup_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("amount_paise", sa.Integer(), nullable=False),
        sa.Column("credits_paise", sa.Integer(), nullable=False),
        sa.Column("utr_reference", sa.String(length=160), nullable=False),
        sa.Column("screenshot", sa.String(length=2000), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="PENDING"),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.UniqueConstraint("utr_reference", name="uq_credit_topup_requests_utr_reference"),
    )
    op.create_index("ix_credit_topup_requests_organization_status", "credit_topup_requests", ["organization_id", "status"])

def downgrade() -> None:
    op.drop_table("credit_topup_requests")
