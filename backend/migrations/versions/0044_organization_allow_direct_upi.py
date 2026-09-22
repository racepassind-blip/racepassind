"""Add allow_direct_upi to organizations.

Controls whether the organizer may use the Direct UPI payment flow
where participant money goes directly to the organizer's UPI account.
Default false for all existing and new organizations; admin enables
per-organizer after manual review.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0044_organization_allow_direct_upi"
down_revision: Union[str, None] = "0043_platform_fee_bearer"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column(
            "allow_direct_upi",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("organizations", "allow_direct_upi")
