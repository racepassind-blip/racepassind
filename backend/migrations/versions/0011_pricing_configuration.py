"""Add configurable organizer pricing and founding program."""

from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa

revision: str = "0011_pricing_configuration"
down_revision: Union[str, None] = "0010_organizer_applications"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_STARTER_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
_COMMUNITY_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
_GROWTH_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")


def upgrade() -> None:
    op.create_table(
        "pricing_plans",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("min_confirmed_registrations", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("max_confirmed_registrations", sa.Integer(), nullable=True),
        sa.Column("price_paise", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(), nullable=False, server_default="INR"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code", name="uq_pricing_plans_code"),
    )
    op.create_index("ix_pricing_plans_active_sort_order", "pricing_plans", ["active", "sort_order"])
    op.create_table(
        "founding_programs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("free_races_count", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("default_discount_basis_points", sa.Integer(), nullable=False, server_default="10000"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "founding_program_organizations",
        sa.Column("program_id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["program_id"], ["founding_programs.id"]),
        sa.PrimaryKeyConstraint("program_id", "organization_id"),
    )
    op.create_index("ix_founding_program_organizations_organization_id", "founding_program_organizations", ["organization_id"])

    op.bulk_insert(
        sa.table(
            "pricing_plans",
            sa.column("id", sa.Uuid(as_uuid=True)), sa.column("code", sa.String()), sa.column("name", sa.String()),
            sa.column("min_confirmed_registrations", sa.Integer()), sa.column("max_confirmed_registrations", sa.Integer()),
            sa.column("price_paise", sa.Integer()), sa.column("currency", sa.String()), sa.column("active", sa.Boolean()), sa.column("sort_order", sa.Integer()),
        ),
        [
            {"id": _STARTER_ID, "code": "starter", "name": "Starter", "min_confirmed_registrations": 1, "max_confirmed_registrations": 50, "price_paise": 29_900, "currency": "INR", "active": True, "sort_order": 1},
            {"id": _COMMUNITY_ID, "code": "community", "name": "Community", "min_confirmed_registrations": 51, "max_confirmed_registrations": 100, "price_paise": 49_900, "currency": "INR", "active": True, "sort_order": 2},
            {"id": _GROWTH_ID, "code": "growth", "name": "Growth", "min_confirmed_registrations": 101, "max_confirmed_registrations": 250, "price_paise": 99_900, "currency": "INR", "active": True, "sort_order": 3},
        ],
    )
    op.bulk_insert(
        sa.table("founding_programs", sa.column("id", sa.Integer()), sa.column("enabled", sa.Boolean()), sa.column("free_races_count", sa.Integer()), sa.column("default_discount_basis_points", sa.Integer())),
        [{"id": 1, "enabled": True, "free_races_count": 2, "default_discount_basis_points": 10_000}],
    )


def downgrade() -> None:
    op.drop_index("ix_founding_program_organizations_organization_id", table_name="founding_program_organizations")
    op.drop_table("founding_program_organizations")
    op.drop_table("founding_programs")
    op.drop_index("ix_pricing_plans_active_sort_order", table_name="pricing_plans")
    op.drop_table("pricing_plans")
