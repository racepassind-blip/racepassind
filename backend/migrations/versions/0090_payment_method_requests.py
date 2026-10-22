"""Store payment methods requested during paid verification."""
from alembic import op
import sqlalchemy as sa

revision = "0090_payment_method_requests"
down_revision = "0089_admin_bills"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("organizations", sa.Column("requested_payment_methods", sa.JSON(), nullable=True))

def downgrade():
    op.drop_column("organizations", "requested_payment_methods")
