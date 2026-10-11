"""Persist registration marketing attribution."""

from alembic import op
import sqlalchemy as sa


revision = "0077_registration_attribution"
down_revision = "0076_cashfree_resolution_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name in ("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"):
        op.add_column("registrations", sa.Column(name, sa.String(160), nullable=True))
    op.add_column("registrations", sa.Column("attribution_captured_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_registrations_utm_source", "registrations", ["utm_source"])
    op.create_index("ix_registrations_utm_medium", "registrations", ["utm_medium"])
    op.create_index("ix_registrations_utm_campaign", "registrations", ["utm_campaign"])


def downgrade() -> None:
    op.drop_index("ix_registrations_utm_campaign", table_name="registrations")
    op.drop_index("ix_registrations_utm_medium", table_name="registrations")
    op.drop_index("ix_registrations_utm_source", table_name="registrations")
    for name in ("attribution_captured_at", "utm_content", "utm_term", "utm_campaign", "utm_medium", "utm_source"):
        op.drop_column("registrations", name)
