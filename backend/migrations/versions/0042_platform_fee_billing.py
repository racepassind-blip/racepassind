"""Add SportPass organizer platform-fee configuration and billing ledger.

This is an additive, standalone flow that lives alongside the existing
organizer_event_billings ledger. It does not modify any existing table.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0042_platform_fee_billing"
down_revision: Union[str, None] = "0041_organization_verification_details"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "platform_fee_configs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(), nullable=False, server_default="Introductory Pricing"),
        sa.Column("percentage_basis_points", sa.Integer(), nullable=False, server_default="500"),
        sa.Column("per_registration_paise", sa.Integer(), nullable=False, server_default="1000"),
        sa.Column("currency", sa.String(), nullable=False, server_default="INR"),
        sa.Column("default_due_days", sa.Integer(), nullable=False, server_default="14"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )

    # Seed the singleton config row with the introductory pricing:
    # 5% (500 basis points) of registration revenue + ₹10 (1000 paise) per paid registration.
    op.bulk_insert(
        sa.table(
            "platform_fee_configs",
            sa.column("id", sa.Integer),
            sa.column("label", sa.String),
            sa.column("percentage_basis_points", sa.Integer),
            sa.column("per_registration_paise", sa.Integer),
            sa.column("currency", sa.String),
            sa.column("default_due_days", sa.Integer),
        ),
        [
            {
                "id": 1,
                "label": "Introductory Pricing",
                "percentage_basis_points": 500,
                "per_registration_paise": 1000,
                "currency": "INR",
                "default_due_days": 14,
            }
        ],
    )

    op.create_table(
        "organizer_platform_fee_billings",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("event_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("organization_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("invoice_number", sa.String(), nullable=True),
        sa.Column("paid_registration_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("registration_revenue_paise", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("percentage_basis_points", sa.Integer(), nullable=False, server_default="500"),
        sa.Column("per_registration_paise", sa.Integer(), nullable=False, server_default="1000"),
        sa.Column("gross_fee_paise", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("discount_paise", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("final_amount_paise", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(), nullable=False, server_default="INR"),
        sa.Column("billing_status", sa.String(), nullable=False, server_default="payment_due"),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payment_reference", sa.String(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", name="uq_organizer_platform_fee_billings_event_id"),
        sa.UniqueConstraint("invoice_number", name="uq_organizer_platform_fee_billings_invoice_number"),
    )
    op.create_index(
        "ix_platform_fee_billings_org_status",
        "organizer_platform_fee_billings",
        ["organization_id", "billing_status"],
    )
    op.create_index("ix_platform_fee_billings_due_at", "organizer_platform_fee_billings", ["due_at"])


def downgrade() -> None:
    op.drop_index("ix_platform_fee_billings_due_at", table_name="organizer_platform_fee_billings")
    op.drop_index("ix_platform_fee_billings_org_status", table_name="organizer_platform_fee_billings")
    op.drop_table("organizer_platform_fee_billings")
    op.drop_table("platform_fee_configs")
