"""Map Clerk identities to existing local users without changing business FKs."""
from alembic import op
import sqlalchemy as sa

revision = "0069_clerk_identity"
down_revision = "0068_organizer_verification_security"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("clerk_user_id", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("clerk_deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_users_clerk_user_id", "users", ["clerk_user_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_clerk_user_id", table_name="users")
    op.drop_column("users", "clerk_user_id")
    op.drop_column("users", "clerk_deleted_at")
