"""Add event-level organizer billing ledger."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0012_organizer_event_billing"
down_revision: Union[str, None] = "0011_pricing_configuration"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "organizer_event_billings",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("event_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("organization_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("plan_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("plan_code", sa.String(), nullable=True),
        sa.Column("plan_name", sa.String(), nullable=True),
        sa.Column("confirmed_registrations", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("applicable_price_paise", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("discount_paise", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("final_amount_paise", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(), nullable=False, server_default="INR"),
        sa.Column("billing_status", sa.String(), nullable=False, server_default="not_billed"),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payment_reference", sa.String(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"]),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["plan_id"], ["pricing_plans.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", name="uq_organizer_event_billings_event_id"),
    )
    op.create_index(
        "ix_organizer_event_billings_organization_status",
        "organizer_event_billings",
        ["organization_id", "billing_status"],
    )
    op.create_index("ix_organizer_event_billings_due_at", "organizer_event_billings", ["due_at"])
    op.create_index("ix_organizer_event_billings_plan_id", "organizer_event_billings", ["plan_id"])


def downgrade() -> None:
    op.drop_index("ix_organizer_event_billings_plan_id", table_name="organizer_event_billings")
    op.drop_index("ix_organizer_event_billings_due_at", table_name="organizer_event_billings")
    op.drop_index("ix_organizer_event_billings_organization_status", table_name="organizer_event_billings")
    op.drop_table("organizer_event_billings")
