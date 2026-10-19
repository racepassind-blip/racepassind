"""Add configurable waitlist invitation windows."""
from alembic import op
import sqlalchemy as sa

revision = "0087_waitlist_offer_window"
down_revision = "0086_waitlist_offers"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("events", sa.Column("waitlist_offer_window", sa.String(length=20), nullable=False, server_default="30"))

def downgrade():
    op.drop_column("events", "waitlist_offer_window")
