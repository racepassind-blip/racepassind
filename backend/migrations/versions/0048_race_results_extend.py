"""0048 — Extend race_results for timed-race result management.

Adds:
  - registration_id  FK → registrations.id (nullable; links result to a registration)
  - result_status    VARCHAR(20): Finished | DNS | DNF | DSQ
  - result_set_status VARCHAR(20): draft | published
  - updated_at       TIMESTAMPTZ (for edit tracking)
  - pace_seconds_per_km  INTEGER nullable (pre-calculated, running)
  - speed_kmh_x100   INTEGER nullable (pre-calculated ×100, cycling)

Revision ID: 0048
Revises: 0047
Create Date: 2026-09-20
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Link results to a registration row (optional — manual entries may not have one)
    op.add_column(
        "race_results",
        sa.Column(
            "registration_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("registrations.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_race_results_registration_id",
        "race_results",
        ["registration_id"],
    )

    # Participant finish status
    op.add_column(
        "race_results",
        sa.Column(
            "result_status",
            sa.String(20),
            nullable=False,
            server_default="Finished",
        ),
    )

    # Draft vs published (controls public visibility)
    op.add_column(
        "race_results",
        sa.Column(
            "result_set_status",
            sa.String(20),
            nullable=False,
            server_default="draft",
        ),
    )

    # Mutation tracking
    op.add_column(
        "race_results",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    # Pre-calculated pace (running): seconds per km, null for non-Finished
    op.add_column(
        "race_results",
        sa.Column("pace_seconds_per_km", sa.Integer(), nullable=True),
    )

    # Pre-calculated speed (cycling): km/h × 100, null for non-Finished
    op.add_column(
        "race_results",
        sa.Column("speed_kmh_x100", sa.Integer(), nullable=True),
    )

    # Index on event + result_set_status for fast public queries
    op.create_index(
        "ix_race_results_event_set_status",
        "race_results",
        ["event_id", "result_set_status"],
    )


def downgrade() -> None:
    op.drop_index("ix_race_results_event_set_status", table_name="race_results")
    op.drop_index("ix_race_results_registration_id", table_name="race_results")
    op.drop_column("race_results", "speed_kmh_x100")
    op.drop_column("race_results", "pace_seconds_per_km")
    op.drop_column("race_results", "updated_at")
    op.drop_column("race_results", "result_set_status")
    op.drop_column("race_results", "result_status")
    op.drop_column("race_results", "registration_id")
