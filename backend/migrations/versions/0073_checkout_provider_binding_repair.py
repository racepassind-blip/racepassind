"""Repair checkout provider binding columns on databases with an older 0067.

The original 0067 revision was applied to production before the provider
binding fields were added to its source file.  Alembic does not rerun an
already-applied revision, so this additive migration reconciles that historical
schema drift without touching existing checkout rows.
"""

from alembic import op
import sqlalchemy as sa


revision = "0073_checkout_provider_binding_repair"
down_revision = "0072_organizer_settlement_ledger"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("checkout_payments")}

    if "provider_account" not in columns:
        op.add_column("checkout_payments", sa.Column("provider_account", sa.String(120)))
    if "provider_environment" not in columns:
        op.add_column("checkout_payments", sa.Column("provider_environment", sa.String(16)))
    if "provider_order_id" not in columns:
        op.add_column("checkout_payments", sa.Column("provider_order_id", sa.String(120)))

    constraint_names = {
        constraint.get("name")
        for constraint in sa.inspect(bind).get_unique_constraints("checkout_payments")
    }
    if "uq_checkout_provider_order" not in constraint_names:
        op.create_unique_constraint(
            "uq_checkout_provider_order",
            "checkout_payments",
            ["provider_account", "provider_environment", "provider_order_id"],
        )


def downgrade():
    # These columns are part of the canonical 0067 schema.  A downgrade must
    # not remove them from databases where 0067 created them originally.
    pass
