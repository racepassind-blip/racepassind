"""Store structured organizer onboarding verification data."""

from alembic import op
import sqlalchemy as sa

revision = "0082_organizer_application_verification"
down_revision = "0081_dpdp_account_rights"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name, column in (
        ("organization_type", sa.String(length=80)), ("address", sa.Text()),
        ("city", sa.String(length=120)), ("state", sa.String(length=120)),
        ("pincode", sa.String(length=10)), ("event_history", sa.Text()),
        ("discovery_source", sa.String(length=80)), ("payment_preference", sa.String(length=32)),
        ("id_proof_type", sa.String(length=40)), ("id_proof_filename", sa.String(length=255)),
        ("id_proof_object_key", sa.String(length=500)), ("id_proof_content_type", sa.String(length=100)),
        ("id_proof_size_bytes", sa.Integer()),
        ("payment_details", sa.JSON()),
        ("recovery_token_hash", sa.String(length=64)),
        ("recovery_expires_at", sa.DateTime(timezone=True)),
    ):
        op.add_column("organizer_applications", sa.Column(name, column, nullable=True))


def downgrade() -> None:
    op.drop_column("organizer_applications", "recovery_expires_at")
    op.drop_column("organizer_applications", "recovery_token_hash")
    op.drop_column("organizer_applications", "payment_details")
    for name in ("id_proof_size_bytes", "id_proof_content_type", "id_proof_object_key", "id_proof_filename", "id_proof_type", "payment_preference", "discovery_source", "event_history", "pincode", "state", "city", "address", "organization_type"):
        op.drop_column("organizer_applications", name)
