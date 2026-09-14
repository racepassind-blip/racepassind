from alembic import op
import sqlalchemy as sa

revision = "0022_manual_registration_payment"
down_revision = "0021_registration_event_order_index"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "registrations",
        sa.Column("source", sa.String(), nullable=False, server_default=sa.text("'online'")),
    )
    op.create_index("ix_registrations_source", "registrations", ["source"])
    op.add_column("payments", sa.Column("received_amount_paise", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("payments", "received_amount_paise")
    op.drop_index("ix_registrations_source", table_name="registrations")
    op.drop_column("registrations", "source")
