"""Record privacy notice acceptance and account erasure state."""

from alembic import op
import sqlalchemy as sa


revision = "0081_dpdp_account_rights"
down_revision = "0080_remove_clerk_integration"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("privacy_policy_version", sa.String(length=40), nullable=True))
    op.add_column("users", sa.Column("privacy_policy_accepted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_users_deleted_at", "users", ["deleted_at"])
    op.add_column("organizer_applications", sa.Column("privacy_policy_version", sa.String(length=40), nullable=True))
    op.add_column("organizer_applications", sa.Column("privacy_policy_accepted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_index("ix_users_deleted_at", table_name="users")
    op.drop_column("organizer_applications", "privacy_policy_accepted_at")
    op.drop_column("organizer_applications", "privacy_policy_version")
    op.drop_column("users", "deleted_at")
    op.drop_column("users", "privacy_policy_accepted_at")
    op.drop_column("users", "privacy_policy_version")
