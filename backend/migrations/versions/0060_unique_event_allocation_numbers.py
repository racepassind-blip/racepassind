"""Prevent duplicate allocation numbers within an event."""

from alembic import op
import sqlalchemy as sa

revision = "0060_unique_event_allocation_numbers"
down_revision = "0059_credit_topup_utr_case_insensitive"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "CREATE UNIQUE INDEX uq_registrations_event_allocation_number "
            "ON registrations (event_id, allocation_number) "
            "WHERE allocation_number IS NOT NULL"
        )
    )


def downgrade() -> None:
    op.drop_index("uq_registrations_event_allocation_number", table_name="registrations")
