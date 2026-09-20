"""Add platform_fee_bearer to events and fee snapshot columns to registrations.

Existing paid events default to ORGANIZER (organizer absorbs the SportPass fee).
Registration snapshot columns freeze the fee/bearer/participant total at
registration time so later pricing changes never recompute old registrations.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0043_platform_fee_bearer"
down_revision: Union[str, None] = "0042_platform_fee_billing"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("platform_fee_bearer", sa.String(length=20), nullable=False, server_default="ORGANIZER"),
    )
    op.add_column(
        "registrations",
        sa.Column("platform_fee_bearer", sa.String(length=20), nullable=False, server_default="ORGANIZER"),
    )
    op.add_column(
        "registrations",
        sa.Column("platform_fee_paise", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "registrations",
        sa.Column("participant_total_paise", sa.Integer(), nullable=True),
    )
    # Backfill: for existing registrations the participant total equals the base
    # amount (no fee was ever passed on before this feature existed).
    op.execute("UPDATE registrations SET participant_total_paise = total_amount_paise")


def downgrade() -> None:
    op.drop_column("registrations", "participant_total_paise")
    op.drop_column("registrations", "platform_fee_paise")
    op.drop_column("registrations", "platform_fee_bearer")
    op.drop_column("events", "platform_fee_bearer")
