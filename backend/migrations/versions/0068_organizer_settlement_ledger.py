"""Add manual organizer settlement and adjustment ledgers."""
from alembic import op
import sqlalchemy as sa

revision = "0072_organizer_settlement_ledger"
down_revision = "0071_password_reset_tokens"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("managed_registration_collections",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("registration_id", sa.Uuid(), sa.ForeignKey("registrations.id"), nullable=False, unique=True),
        sa.Column("receipt_id", sa.Uuid(), sa.ForeignKey("checkout_receipts.id"), nullable=False),
        sa.Column("event_id", sa.Uuid(), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("organizer_id", sa.Uuid(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("registration_amount_paise", sa.Integer(), nullable=False),
        sa.Column("platform_fee_paise", sa.Integer(), nullable=False),
        sa.Column("total_paid_paise", sa.Integer(), nullable=False),
        sa.Column("organizer_payable_paise", sa.Integer(), nullable=False),
        sa.Column("participant_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("registration_amount_paise >= 0 AND platform_fee_paise >= 0 AND total_paid_paise >= 0 AND organizer_payable_paise = total_paid_paise - platform_fee_paise AND organizer_payable_paise >= 0", name="ck_managed_collection_amounts"))
    op.create_index("ix_managed_registration_collections_event_id", "managed_registration_collections", ["event_id"])
    op.execute("UPDATE events SET payment_collection_method = 'CASHFREE_MANAGED' WHERE payment_collection_method = 'PAYMENT_GATEWAY'")
    op.create_table(
        "organizer_settlements",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organizer_id", sa.Uuid(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("event_id", sa.Uuid(), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("amount_paise", sa.Integer(), nullable=False),
        sa.Column("method", sa.String(24), nullable=False),
        sa.Column("reference_number", sa.String(160)),
        sa.Column("settlement_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("notes", sa.Text()),
        sa.Column("idempotency_key", sa.String(120), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("provider", sa.String(32), nullable=False, server_default="MANUAL"),
        sa.Column("provider_transfer_id", sa.String(160)),
        sa.Column("provider_status", sa.String(60)),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("amount_paise > 0", name="ck_organizer_settlement_positive_amount"),
        sa.CheckConstraint("amount_paise >= 100", name="ck_settlement_minimum"),
        sa.CheckConstraint("status <> 'PAID' OR (reference_number IS NOT NULL AND length(trim(reference_number)) > 0)", name="ck_paid_reference"),
        sa.CheckConstraint("method IN ('BANK_TRANSFER', 'UPI', 'OTHER')", name="ck_organizer_settlement_method"),
        sa.CheckConstraint("status IN ('PENDING', 'PAID', 'FAILED', 'CANCELLED')", name="ck_organizer_settlement_status"),
        sa.UniqueConstraint("event_id", "idempotency_key", name="uq_organizer_settlement_event_idempotency"),
        sa.UniqueConstraint("reference_number", name="uq_manual_settlement_reference"),
    )
    op.create_index("ix_organizer_settlements_event_status", "organizer_settlements", ["event_id", "status"])
    op.create_index("ix_organizer_settlements_organizer_event", "organizer_settlements", ["organizer_id", "event_id"])
    op.create_table(
        "organizer_payable_adjustments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("organizer_id", sa.Uuid(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("event_id", sa.Uuid(), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("amount_paise", sa.Integer(), nullable=False),
        sa.Column("idempotency_key", sa.String(120), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("settlement_id", sa.Uuid(), sa.ForeignKey("organizer_settlements.id")),
        sa.Column("kind", sa.String(32), nullable=False, server_default="PAYABLE"),
        sa.UniqueConstraint("event_id", "idempotency_key", name="uq_adjustment_request"),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("amount_paise <> 0", name="ck_organizer_adjustment_nonzero"),
        sa.CheckConstraint("(kind = 'PAYABLE' AND settlement_id IS NULL) OR (kind = 'SETTLEMENT_REVERSAL' AND settlement_id IS NOT NULL AND amount_paise > 0)", name="ck_adjustment_kind"),
    )
    op.create_index("ix_organizer_adjustments_event", "organizer_payable_adjustments", ["event_id", "created_at"])
    if op.get_bind().dialect.name == "postgresql":
        op.execute("""
            CREATE FUNCTION protect_organizer_ledger() RETURNS trigger AS $$
            BEGIN
                IF TG_OP = 'DELETE' OR TG_TABLE_NAME <> 'organizer_settlements' THEN
                    RAISE EXCEPTION 'Financial ledger records are immutable; use a correction entry';
                END IF;
                IF OLD.status <> 'PENDING' THEN
                    RAISE EXCEPTION 'Financial ledger records are immutable; use a correction entry';
                END IF;
                IF NEW.event_id <> OLD.event_id OR NEW.organizer_id <> OLD.organizer_id
                    OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.request_fingerprint <> OLD.request_fingerprint
                    OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
                    RAISE EXCEPTION 'Settlement identity cannot change';
                END IF;
                RETURN NEW;
            END; $$ LANGUAGE plpgsql
        """)
        for table in ("managed_registration_collections", "organizer_payable_adjustments", "organizer_settlements"):
            op.execute(f"CREATE TRIGGER protect_{table} BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION protect_organizer_ledger()")
        # Any refund writer, including a future provider callback, serializes
        # with settlement decisions on the event row. A completed refund cannot
        # be silently edited away after affecting the balance.
        op.execute("""
            CREATE FUNCTION lock_managed_refund_event() RETURNS trigger AS $$
            BEGIN
                IF TG_OP <> 'INSERT' AND OLD.payment_provider = 'CASHFREE' AND OLD.status = 'REFUNDED' THEN
                    RAISE EXCEPTION 'Completed managed refunds are immutable';
                END IF;
                IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                IF NEW.payment_provider = 'CASHFREE' THEN
                    PERFORM id FROM events WHERE id = NEW.event_id FOR UPDATE;
                END IF;
                RETURN NEW;
            END; $$ LANGUAGE plpgsql
        """)
        op.execute("CREATE TRIGGER managed_refund_event BEFORE INSERT OR UPDATE OR DELETE ON refunds FOR EACH ROW EXECUTE FUNCTION lock_managed_refund_event()")


def downgrade():
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT count(*) FROM organizer_settlements")) or connection.scalar(sa.text("SELECT count(*) FROM organizer_payable_adjustments")) or connection.scalar(sa.text("SELECT count(*) FROM managed_registration_collections")):
        raise RuntimeError("Settlement ledger contains financial records and cannot be dropped")
    op.drop_table("organizer_payable_adjustments")
    op.drop_table("organizer_settlements")
    op.drop_table("managed_registration_collections")
    if connection.dialect.name == "postgresql":
        op.execute("DROP TRIGGER managed_refund_event ON refunds")
        op.execute("DROP FUNCTION lock_managed_refund_event()")
        op.execute("DROP FUNCTION protect_organizer_ledger()")
