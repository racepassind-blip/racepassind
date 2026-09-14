"""Update organizer pricing to the revised registration ladder."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0017_pricing_ladder_update"
down_revision: Union[str, None] = "0016_event_schedule"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _pricing_plans_table() -> sa.sql.expression.TableClause:
    return sa.table(
        "pricing_plans",
        sa.column("code", sa.String()),
        sa.column("min_confirmed_registrations", sa.Integer()),
        sa.column("max_confirmed_registrations", sa.Integer()),
        sa.column("price_paise", sa.Integer()),
        sa.column("billing_unit", sa.String()),
        sa.column("sort_order", sa.Integer()),
    )


def _update_plan(
    plans: sa.sql.expression.TableClause,
    *,
    code: str,
    minimum: int,
    maximum: int | None,
    price_paise: int,
    billing_unit: str,
    sort_order: int,
) -> None:
    op.execute(
        plans.update()
        .where(plans.c.code == code)
        .values(
            min_confirmed_registrations=minimum,
            max_confirmed_registrations=maximum,
            price_paise=price_paise,
            billing_unit=billing_unit,
            sort_order=sort_order,
        )
    )


def upgrade() -> None:
    """Apply the current organizer pricing ladder without replacing plan rows."""
    plans = _pricing_plans_table()
    _update_plan(
        plans,
        code="community",
        minimum=1,
        maximum=25,
        price_paise=0,
        billing_unit="per_event",
        sort_order=1,
    )
    _update_plan(
        plans,
        code="starter",
        minimum=26,
        maximum=60,
        price_paise=49_900,
        billing_unit="per_event",
        sort_order=2,
    )
    _update_plan(
        plans,
        code="growth",
        minimum=61,
        maximum=120,
        price_paise=89_900,
        billing_unit="per_event",
        sort_order=3,
    )
    _update_plan(
        plans,
        code="scale",
        minimum=121,
        maximum=250,
        price_paise=149_900,
        billing_unit="per_event",
        sort_order=4,
    )
    _update_plan(
        plans,
        code="marathon",
        minimum=251,
        maximum=None,
        price_paise=500,
        billing_unit="per_registration",
        sort_order=5,
    )


def downgrade() -> None:
    """Restore the organizer pricing values from migration 0015."""
    plans = _pricing_plans_table()
    _update_plan(
        plans,
        code="community",
        minimum=1,
        maximum=25,
        price_paise=0,
        billing_unit="per_event",
        sort_order=1,
    )
    _update_plan(
        plans,
        code="starter",
        minimum=26,
        maximum=60,
        price_paise=24_900,
        billing_unit="per_event",
        sort_order=2,
    )
    _update_plan(
        plans,
        code="growth",
        minimum=61,
        maximum=120,
        price_paise=49_900,
        billing_unit="per_event",
        sort_order=3,
    )
    _update_plan(
        plans,
        code="scale",
        minimum=121,
        maximum=250,
        price_paise=89_900,
        billing_unit="per_event",
        sort_order=4,
    )
    _update_plan(
        plans,
        code="marathon",
        minimum=251,
        maximum=None,
        price_paise=300,
        billing_unit="per_registration",
        sort_order=5,
    )
