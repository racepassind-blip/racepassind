"""Organizer verification security V1."""
import uuid

from alembic import op
import sqlalchemy as sa

revision = "0068_organizer_verification_security"
down_revision = "0067_checkout_payments"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("organizations", sa.Column("paid_verification_suspended_at", sa.DateTime(timezone=True)))
    op.add_column("organizations", sa.Column("paid_verification_suspended_by", sa.Uuid(), sa.ForeignKey("users.id")))
    op.add_column("organizations", sa.Column("paid_verification_suspension_reason", sa.Text()))
    op.create_table(
        "organization_verification_submissions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id"), nullable=False, index=True),
        sa.Column("organization_type", sa.String(80)),
        sa.Column("pan_number", sa.String(10), nullable=False),
        sa.Column("name_as_per_pan", sa.String(200), nullable=False),
        sa.Column("gst_registered", sa.Boolean(), nullable=False),
        sa.Column("gst_number", sa.String(15)),
        sa.Column("billing_name", sa.String(200), nullable=False),
        sa.Column("billing_address", sa.Text(), nullable=False),
        sa.Column("billing_city", sa.String(120), nullable=False),
        sa.Column("billing_state", sa.String(120), nullable=False),
        sa.Column("billing_pincode", sa.String(10), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("reviewed_by", sa.Uuid(), sa.ForeignKey("users.id")),
        sa.Column("rejection_reason", sa.Text()),
        sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("terms_version", sa.String(40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    bind = op.get_bind()
    verification_submissions = sa.table("organization_verification_submissions",
        sa.column("id", sa.Uuid()), sa.column("organization_id", sa.Uuid()), sa.column("organization_type", sa.String()),
        sa.column("pan_number", sa.String()), sa.column("name_as_per_pan", sa.String()), sa.column("gst_registered", sa.Boolean()),
        sa.column("gst_number", sa.String()), sa.column("billing_name", sa.String()), sa.column("billing_address", sa.Text()),
        sa.column("billing_city", sa.String()), sa.column("billing_state", sa.String()), sa.column("billing_pincode", sa.String()),
        sa.column("status", sa.String()), sa.column("submitted_at", sa.DateTime(timezone=True)), sa.column("reviewed_at", sa.DateTime(timezone=True)),
        sa.column("reviewed_by", sa.Uuid()), sa.column("rejection_reason", sa.Text()), sa.column("terms_accepted_at", sa.DateTime(timezone=True)),
        sa.column("terms_version", sa.String()))
    existing_verifications = bind.execute(sa.text("""
        SELECT id, organization_type, pan_number, name_as_per_pan, gst_registered, gst_number,
               billing_name, billing_address, billing_city, billing_state, billing_pincode,
               paid_verification_status, paid_verification_submitted_at, paid_verification_reviewed_at,
               paid_verification_reviewed_by, paid_verification_rejection_reason, created_at
        FROM organizations
        WHERE paid_verification_status <> 'NOT_SUBMITTED'
          AND pan_number IS NOT NULL AND name_as_per_pan IS NOT NULL
          AND billing_name IS NOT NULL AND billing_address IS NOT NULL
          AND billing_city IS NOT NULL AND billing_state IS NOT NULL
          AND billing_pincode IS NOT NULL
    """)).mappings().all()
    for row in existing_verifications:
        submitted_at = row["paid_verification_submitted_at"] or row["created_at"]
        bind.execute(verification_submissions.insert().values(
            id=uuid.uuid4(), organization_id=row["id"], organization_type=row["organization_type"],
            pan_number=row["pan_number"], name_as_per_pan=row["name_as_per_pan"], gst_registered=row["gst_registered"],
            gst_number=row["gst_number"], billing_name=row["billing_name"], billing_address=row["billing_address"],
            billing_city=row["billing_city"], billing_state=row["billing_state"], billing_pincode=row["billing_pincode"],
            status=row["paid_verification_status"], submitted_at=submitted_at, reviewed_at=row["paid_verification_reviewed_at"],
            reviewed_by=row["paid_verification_reviewed_by"], rejection_reason=row["paid_verification_rejection_reason"],
            terms_accepted_at=submitted_at, terms_version="legacy-import"))
    op.create_table(
        "organization_payment_destinations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id"), nullable=False, index=True),
        sa.Column("upi_id", sa.String(320), nullable=False),
        sa.Column("payee_name", sa.String(200), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("reviewed_by", sa.Uuid(), sa.ForeignKey("users.id")),
        sa.Column("rejection_reason", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_payment_destination_org_created", "organization_payment_destinations", ["organization_id", "created_at"])
    op.create_table(
        "organization_verification_documents",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organization_id", sa.Uuid(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("document_type", sa.String(40), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("object_key", sa.String(500), nullable=False, unique=True),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("uploaded_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_organization_verification_documents_organization_id", "organization_verification_documents", ["organization_id"])
    op.add_column("event_payment_settings", sa.Column("payment_destination_id", sa.Uuid(), sa.ForeignKey("organization_payment_destinations.id")))
    op.create_index("ix_event_payment_settings_payment_destination_id", "event_payment_settings", ["payment_destination_id"])
    op.add_column("product_listings", sa.Column("payment_destination_id", sa.Uuid(), sa.ForeignKey("organization_payment_destinations.id")))
    op.create_index("ix_product_listings_payment_destination_id", "product_listings", ["payment_destination_id"])

    destinations = sa.table("organization_payment_destinations", sa.column("id", sa.Uuid()), sa.column("organization_id", sa.Uuid()), sa.column("upi_id", sa.String()), sa.column("payee_name", sa.String()), sa.column("status", sa.String()))
    rows = bind.execute(sa.text("""
        SELECT eps.id AS settings_id, e.organization_id, eps.upi_id, eps.payee_name,
               o.paid_verification_status, o.allow_direct_upi
        FROM event_payment_settings eps JOIN events e ON e.id=eps.event_id
        JOIN organizations o ON o.id=e.organization_id
    """)).mappings().all()
    cached = {}
    for row in rows:
        key = (row["organization_id"], row["upi_id"], row["payee_name"])
        destination_id = cached.get(key)
        if destination_id is None:
            destination_id = uuid.uuid4()
            status = "LEGACY_APPROVED" if row["paid_verification_status"] == "VERIFIED" and row["allow_direct_upi"] else "UNDER_REVIEW"
            bind.execute(destinations.insert().values(id=destination_id, organization_id=row["organization_id"], upi_id=row["upi_id"], payee_name=row["payee_name"], status=status))
            cached[key] = destination_id
        bind.execute(sa.text("UPDATE event_payment_settings SET payment_destination_id=:destination_id WHERE id=:settings_id"), {"destination_id": destination_id, "settings_id": row["settings_id"]})
    product_rows = bind.execute(sa.text("SELECT id, organization_id, upi_id, payee_name FROM product_listings")).mappings().all()
    for row in product_rows:
        key = (row["organization_id"], row["upi_id"], row["payee_name"])
        destination_id = cached.get(key)
        if destination_id is None:
            destination_id = uuid.uuid4()
            org = bind.execute(sa.text("SELECT paid_verification_status, allow_direct_upi FROM organizations WHERE id=:id"), {"id": row["organization_id"]}).mappings().one()
            status = "LEGACY_APPROVED" if org["paid_verification_status"] == "VERIFIED" and org["allow_direct_upi"] else "UNDER_REVIEW"
            bind.execute(destinations.insert().values(id=destination_id, organization_id=row["organization_id"], upi_id=row["upi_id"], payee_name=row["payee_name"], status=status))
            cached[key] = destination_id
        bind.execute(sa.text("UPDATE product_listings SET payment_destination_id=:destination_id WHERE id=:id"), {"destination_id": destination_id, "id": row["id"]})


def downgrade():
    op.drop_index("ix_product_listings_payment_destination_id", table_name="product_listings")
    op.drop_column("product_listings", "payment_destination_id")
    op.drop_index("ix_event_payment_settings_payment_destination_id", table_name="event_payment_settings")
    op.drop_column("event_payment_settings", "payment_destination_id")
    op.drop_index("ix_payment_destination_org_created", table_name="organization_payment_destinations")
    op.drop_index("ix_organization_verification_documents_organization_id", table_name="organization_verification_documents")
    op.drop_table("organization_verification_documents")
    op.drop_table("organization_payment_destinations")
    op.drop_table("organization_verification_submissions")
    op.drop_column("organizations", "paid_verification_suspension_reason")
    op.drop_column("organizations", "paid_verification_suspended_by")
    op.drop_column("organizations", "paid_verification_suspended_at")
