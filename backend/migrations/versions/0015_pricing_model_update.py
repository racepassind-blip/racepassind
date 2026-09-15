"""Update organizer pricing to the event-based SportPass model."""

from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa

revision: str = "0015_pricing_model_update"
down_revision: Union[str, None] = "0014_organizer_profile_location"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_STARTER_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
_COMMUNITY_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
_GROWTH_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")
_SCALE_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")
_MARATHON_ID = uuid.UUID("55555555-5555-5555-5555-555555555555")


def upgrade() -> None:
    op.add_column(
        "pricing_plans",
        sa.Column("billing_unit", sa.String(), nullable=False, server_default="per_event"),
    )

    plans = sa.table(
        "pricing_plans",
        sa.column("id", sa.Uuid(as_uuid=True)),
        sa.column("code", sa.String()),
        sa.column("name", sa.String()),
        sa.column("min_confirmed_registrations", sa.Integer()),
        sa.column("max_confirmed_registrations", sa.Integer()),
        sa.column("price_paise", sa.Integer()),
        sa.column("billing_unit", sa.String()),
        sa.column("currency", sa.String()),
        sa.column("active", sa.Boolean()),
        sa.column("sort_order", sa.Integer()),
    )
    op.execute(
        plans.update()
        .where(plans.c.code == "community")
        .values(name="Community", min_confirmed_registrations=1, max_confirmed_registrations=25, price_paise=0, billing_unit="per_event", sort_order=1)
    )
    op.execute(
        plans.update()
        .where(plans.c.code == "starter")
        .values(name="Starter", min_confirmed_registrations=26, max_confirmed_registrations=60, price_paise=24_900, billing_unit="per_event", sort_order=2)
    )
    op.execute(
        plans.update()
        .where(plans.c.code == "growth")
        .values(name="Growth", min_confirmed_registrations=61, max_confirmed_registrations=120, price_paise=49_900, billing_unit="per_event", sort_order=3)
    )
    op.bulk_insert(
        plans,
        [
            {"id": _SCALE_ID, "code": "scale", "name": "Scale", "min_confirmed_registrations": 121, "max_confirmed_registrations": 250, "price_paise": 89_900, "billing_unit": "per_event", "currency": "INR", "active": True, "sort_order": 4},
            {"id": _MARATHON_ID, "code": "marathon", "name": "Marathon", "min_confirmed_registrations": 251, "max_confirmed_registrations": None, "price_paise": 300, "billing_unit": "per_registration", "currency": "INR", "active": True, "sort_order": 5},
        ],
    )

    founding_programs = sa.table(
        "founding_programs",
        sa.column("id", sa.Integer()),
        sa.column("free_races_count", sa.Integer()),
    )
    op.execute(founding_programs.update().where(founding_programs.c.id == 1).values(free_races_count=1))


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM pricing_plans WHERE code IN ('scale', 'marathon')"))
    plans = sa.table(
        "pricing_plans",
        sa.column("code", sa.String()),
        sa.column("min_confirmed_registrations", sa.Integer()),
        sa.column("max_confirmed_registrations", sa.Integer()),
        sa.column("price_paise", sa.Integer()),
        sa.column("sort_order", sa.Integer()),
    )
    op.execute(plans.update().where(plans.c.code == "starter").values(min_confirmed_registrations=1, max_confirmed_registrations=50, price_paise=29_900, sort_order=1))
    op.execute(plans.update().where(plans.c.code == "community").values(min_confirmed_registrations=51, max_confirmed_registrations=100, price_paise=49_900, sort_order=2))
    op.execute(plans.update().where(plans.c.code == "growth").values(min_confirmed_registrations=101, max_confirmed_registrations=250, price_paise=99_900, sort_order=3))

    op.execute(sa.text("UPDATE founding_programs SET free_races_count = 2 WHERE id = 1"))
    op.drop_column("pricing_plans", "billing_unit")
