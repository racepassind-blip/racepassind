"""Add shared capacity leases for the private AI server."""

from alembic import op
import sqlalchemy as sa


revision = "0088_ai_inference_leases"
down_revision = "0087_waitlist_offer_window"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ai_inference_guards",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("load_test_active_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("load_test_job_id", sa.String(length=36), nullable=True),
        sa.Column("last_load_test_finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("load_test_snapshot", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("key"),
    )
    op.bulk_insert(
        sa.table("ai_inference_guards", sa.column("key", sa.String(length=64))),
        [{"key": "home-ai"}],
    )
    op.create_table(
        "ai_inference_leases",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("purpose", sa.String(length=64), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_inference_leases_organization_id", "ai_inference_leases", ["organization_id"])
    op.create_index("ix_ai_inference_leases_expires_at", "ai_inference_leases", ["expires_at"])


def downgrade():
    op.drop_index("ix_ai_inference_leases_expires_at", table_name="ai_inference_leases")
    op.drop_index("ix_ai_inference_leases_organization_id", table_name="ai_inference_leases")
    op.drop_table("ai_inference_leases")
    op.drop_table("ai_inference_guards")
