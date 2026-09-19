"""Add communication configuration schema.

This adds the communication_config table for centralized management
of communication channels (email, WhatsApp, SMS, etc.).

- CommunicationConfig: stores channel configuration with JSON field for extensibility
- Currently supports EMAIL channel with Gmail integration
- Future channels: WHATSAPP, SMS
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0034_communication_config"
down_revision = "0033_allocation_number"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "communication_config",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("channel", sa.String(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("configuration", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("channel"),
    )
    op.create_index(
        "ix_communication_config_channel",
        "communication_config",
        ["channel"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_communication_config_channel",
        table_name="communication_config",
    )
    op.drop_table("communication_config")
