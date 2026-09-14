"""Add configurable participant fields, add-ons, and registration snapshots."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0018_dynamic_registration_config"
down_revision: Union[str, None] = "0017_pricing_ladder_update"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_JSON_CONFIG = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.add_column("events", sa.Column("field_config", _JSON_CONFIG, nullable=False, server_default=sa.text("'{}'")))
    op.add_column("events", sa.Column("addon_config", _JSON_CONFIG, nullable=False, server_default=sa.text("'{}'")))
    op.add_column("registrations", sa.Column("responses", _JSON_CONFIG, nullable=False, server_default=sa.text("'{}'")))
    op.add_column("registrations", sa.Column("selections", _JSON_CONFIG, nullable=False, server_default=sa.text("'{}'")))
    op.add_column("registrations", sa.Column("computed_total", _JSON_CONFIG, nullable=False, server_default=sa.text("'{}'")))

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.create_index("ix_events_field_config_gin", "events", ["field_config"], postgresql_using="gin")
        op.create_index("ix_events_addon_config_gin", "events", ["addon_config"], postgresql_using="gin")
        op.create_index("ix_registrations_responses_gin", "registrations", ["responses"], postgresql_using="gin")
        op.create_index("ix_registrations_selections_gin", "registrations", ["selections"], postgresql_using="gin")
    else:
        op.create_index("ix_events_field_config", "events", ["field_config"])
        op.create_index("ix_events_addon_config", "events", ["addon_config"])
        op.create_index("ix_registrations_responses", "registrations", ["responses"])
        op.create_index("ix_registrations_selections", "registrations", ["selections"])


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.drop_index("ix_registrations_selections_gin", table_name="registrations")
        op.drop_index("ix_registrations_responses_gin", table_name="registrations")
        op.drop_index("ix_events_addon_config_gin", table_name="events")
        op.drop_index("ix_events_field_config_gin", table_name="events")
    else:
        op.drop_index("ix_registrations_selections", table_name="registrations")
        op.drop_index("ix_registrations_responses", table_name="registrations")
        op.drop_index("ix_events_addon_config", table_name="events")
        op.drop_index("ix_events_field_config", table_name="events")
    op.drop_column("registrations", "computed_total")
    op.drop_column("registrations", "selections")
    op.drop_column("registrations", "responses")
    op.drop_column("events", "addon_config")
    op.drop_column("events", "field_config")
