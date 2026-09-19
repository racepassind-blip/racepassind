"""Add allocation number schema.

This adds the allocation_number module which generalizes bib numbers
for use across all sports (running, cycling, badminton, etc.).

- Registration.allocation_number: nullable integer for the allocated number
- Registration.allocation_status: enum (unassigned, draft, published)
- Registration.allocation_assigned_at, allocation_updated_at: timestamps
- EventCategory.number_range_start/end: optional range constraints per category
- AllocationHistory: audit table for tracking all number changes
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0033_allocation_number"
down_revision = "0032_match_player_selection"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add allocation columns to registrations
    op.add_column(
        "registrations",
        sa.Column("allocation_number", sa.Integer(), nullable=True),
    )
    op.add_column(
        "registrations",
        sa.Column(
            "allocation_status",
            sa.String(length=20),
            nullable=False,
            server_default="unassigned",
        ),
    )
    op.add_column(
        "registrations",
        sa.Column(
            "allocation_assigned_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "registrations",
        sa.Column(
            "allocation_updated_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    # Add number range columns to event_categories
    op.add_column(
        "event_categories",
        sa.Column("number_range_start", sa.Integer(), nullable=True),
    )
    op.add_column(
        "event_categories",
        sa.Column("number_range_end", sa.Integer(), nullable=True),
    )

    # Create allocation_history table
    op.create_table(
        "allocation_history",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("event_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("registration_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("old_number", sa.Integer(), nullable=True),
        sa.Column("new_number", sa.Integer(), nullable=True),
        sa.Column("changed_by", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column(
            "changed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
        ),
        sa.ForeignKeyConstraint(
            ["registration_id"],
            ["registrations.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["changed_by"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_allocation_history_event_id",
        "allocation_history",
        ["event_id"],
        unique=False,
    )
    op.create_index(
        "ix_allocation_history_registration_id",
        "allocation_history",
        ["registration_id"],
        unique=False,
    )
    op.create_index(
        "ix_allocation_history_changed_by",
        "allocation_history",
        ["changed_by"],
        unique=False,
    )

    # Create unique index for draft/published numbers per event
    # This ensures no duplicates for active allocations
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS
        ix_registrations_event_allocation_number_active
        ON registrations (event_id, allocation_number)
        WHERE allocation_number IS NOT NULL
        AND allocation_status IN ('draft', 'published')
        """
    )


def downgrade() -> None:
    op.drop_index(
        "ix_registrations_event_allocation_number_active",
        table_name="registrations",
    )

    op.drop_index(
        "ix_allocation_history_changed_by",
        table_name="allocation_history",
    )
    op.drop_index(
        "ix_allocation_history_registration_id",
        table_name="allocation_history",
    )
    op.drop_index(
        "ix_allocation_history_event_id",
        table_name="allocation_history",
    )
    op.drop_table("allocation_history")

    op.drop_column("event_categories", "number_range_end")
    op.drop_column("event_categories", "number_range_start")

    op.drop_column("registrations", "allocation_updated_at")
    op.drop_column("registrations", "allocation_assigned_at")
    op.drop_column("registrations", "allocation_status")
    op.drop_column("registrations", "allocation_number")
