"""Use per-registration Credits for every organizer going forward.

Historical manual settlement transactions are deliberately untouched. Any
previously confirmed registrations without a Credits debit require a separate
finance reconciliation; this migration must not invent charges.
"""

from alembic import op
import sqlalchemy as sa


revision = "0074_automatic_registration_credits"
down_revision = "0073_checkout_provider_binding_repair"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text(
        "UPDATE organizations SET credit_deduction_mode = 'AUTOMATIC_PER_REGISTRATION' "
        "WHERE credit_deduction_mode = 'MANUAL_EVENT_SETTLEMENT'"
    ))


def downgrade():
    # Prior modes cannot safely be reconstructed from ledger history.
    pass
