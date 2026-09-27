"""Add scheduling duration (existing matches reserve 30 minutes)."""
from alembic import op
import sqlalchemy as sa
revision = "0064_match_duration"
down_revision = "0063_match_result_approval"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("matches", sa.Column("duration_minutes", sa.Integer(), nullable=False, server_default="30"))

def downgrade():
    op.drop_column("matches", "duration_minutes")
