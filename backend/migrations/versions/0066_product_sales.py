"""Separate product listings, images, and orders."""
from alembic import op
import sqlalchemy as sa

revision = "0066_product_sales"
down_revision = "0065_repair_match_auto_advance"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("product_listings", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id"), nullable=False), sa.Column("name", sa.String(200), nullable=False), sa.Column("description", sa.Text(), nullable=False), sa.Column("catalog", sa.JSON(), nullable=False), sa.Column("status", sa.String(20), nullable=False), sa.Column("fee_bearer", sa.String(20), nullable=False), sa.Column("upi_id", sa.String(320), nullable=False), sa.Column("payee_name", sa.String(200), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index("ix_product_listings_organization_id", "product_listings", ["organization_id"])
    op.create_table("product_images", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("listing_id", sa.Uuid(), sa.ForeignKey("product_listings.id"), nullable=False), sa.Column("reference", sa.Text(), nullable=True))
    op.create_index("ix_product_images_listing_id", "product_images", ["listing_id"])
    op.create_table("product_orders", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("listing_id", sa.Uuid(), sa.ForeignKey("product_listings.id"), nullable=False), sa.Column("request_key", sa.String(64), nullable=False, unique=True), sa.Column("access_hash", sa.String(64), nullable=False), sa.Column("buyer_name", sa.String(160), nullable=False), sa.Column("buyer_email", sa.String(320), nullable=False), sa.Column("buyer_phone", sa.String(30), nullable=False), sa.Column("snapshot", sa.JSON(), nullable=False), sa.Column("status", sa.String(30), nullable=False), sa.Column("payment_reference", sa.String(120)), sa.Column("reserved_until", sa.DateTime(timezone=True)), sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index("ix_product_orders_listing_id", "product_orders", ["listing_id"])


def downgrade():
    op.drop_table("product_orders")
    op.drop_table("product_images")
    op.drop_table("product_listings")
