"""Durable waitlist invitation and notification state."""
from alembic import op
import sqlalchemy as sa

revision = "0086_waitlist_offers"
down_revision = "0085_waitlist_entries"
branch_labels = None
depends_on = None

def upgrade():
    for name in ("waive_payment", "joined_email_sent", "offer_email_sent"):
        op.add_column("waitlist_entries", sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("waitlist_entries", sa.Column("email_retry_after", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE waitlist_entries SET status = CASE WHEN registration_id IS NULL THEN 'waiting' ELSE 'booked' END WHERE status = 'promoted'")
    with op.batch_alter_table("waitlist_entries") as batch:
        batch.create_unique_constraint("uq_waitlist_event_position", ["event_id", "position"])
        batch.create_check_constraint("ck_waitlist_position", "position > 0")
        batch.create_check_constraint("ck_waitlist_status", "status IN ('waiting', 'offered', 'redeeming', 'booked', 'confirmed', 'expired', 'cancelled')")

def downgrade():
    with op.batch_alter_table("waitlist_entries") as batch:
        batch.drop_constraint("ck_waitlist_status", type_="check")
        batch.drop_constraint("ck_waitlist_position", type_="check")
        batch.drop_constraint("uq_waitlist_event_position", type_="unique")
    op.drop_column("waitlist_entries", "email_retry_after")
    for name in ("offer_email_sent", "joined_email_sent", "waive_payment"):
        op.drop_column("waitlist_entries", name)
