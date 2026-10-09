"""Refund concurrency, persisted initiators, and paid-booking resolution history."""
from alembic import op
import sqlalchemy as sa

revision = "0076_cashfree_resolution_audit"
down_revision = "0075_organizer_cashfree_access"
branch_labels = None
depends_on = None

PREDICATE = "registration_id IS NOT NULL AND status IN ('REQUESTED','APPROVED','PROCESSING','REFUND_SENT','REFUNDED')"


def upgrade():
    # Never silently merge/delete financial history to make a constraint fit.
    duplicates = op.get_bind().execute(sa.text(
        f"SELECT registration_id FROM refunds WHERE {PREDICATE} GROUP BY registration_id HAVING count(*) > 1 LIMIT 1"
    )).first()
    if duplicates:
        raise RuntimeError("Resolve duplicate open/completed refunds before applying 0076; no records were changed")
    op.create_index("uq_refund_registration_open_or_completed", "refunds", ["registration_id"], unique=True,
                    postgresql_where=sa.text(PREDICATE), sqlite_where=sa.text(PREDICATE))
    op.add_column("refunds", sa.Column("initiated_by", sa.Uuid(), nullable=True))
    op.add_column("refunds", sa.Column("initiated_at", sa.DateTime(timezone=True), nullable=True))
    if op.get_bind().dialect.name == "postgresql":
        op.create_foreign_key("fk_refund_initiated_by", "refunds", "users", ["initiated_by"], ["id"])
    op.create_table("cashfree_payment_resolutions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("checkout_payment_id", sa.Uuid(), sa.ForeignKey("checkout_payments.id"), nullable=False, unique=True),
        sa.Column("receipt_id", sa.Uuid(), sa.ForeignKey("checkout_receipts.id"), nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("amount_paise", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(1000), nullable=False),
        sa.Column("initiated_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("provider_refund_id", sa.String(120), unique=True),
        sa.Column("provider_status", sa.String(32)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("action IN ('FULFILL','REFUND')", name="ck_cashfree_resolution_action"),
        sa.CheckConstraint("status IN ('FULFILLED','PENDING','REFUNDED','NEEDS_REVIEW')", name="ck_cashfree_resolution_status"),
        sa.CheckConstraint("amount_paise > 0", name="ck_cashfree_resolution_amount"),
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute("""
            CREATE FUNCTION protect_cashfree_resolution() RETURNS trigger AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payment resolution history cannot be deleted'; END IF;
                IF OLD.status IN ('FULFILLED','REFUNDED') OR
                   ROW(NEW.checkout_payment_id,NEW.receipt_id,NEW.action,NEW.amount_paise,NEW.reason,NEW.initiated_by,NEW.provider_refund_id,NEW.created_at)
                   IS DISTINCT FROM
                   ROW(OLD.checkout_payment_id,OLD.receipt_id,OLD.action,OLD.amount_paise,OLD.reason,OLD.initiated_by,OLD.provider_refund_id,OLD.created_at)
                THEN RAISE EXCEPTION 'Payment resolution decision is immutable'; END IF;
                RETURN NEW;
            END; $$ LANGUAGE plpgsql
        """)
        op.execute("CREATE TRIGGER protect_cashfree_resolution BEFORE UPDATE OR DELETE ON cashfree_payment_resolutions FOR EACH ROW EXECUTE FUNCTION protect_cashfree_resolution()")
        op.execute("""
            CREATE FUNCTION protect_cashfree_refund_initiator() RETURNS trigger AS $$
            BEGIN
                IF OLD.initiated_at IS NOT NULL AND
                   ROW(NEW.initiated_by,NEW.initiated_at,NEW.provider_refund_id,NEW.approved_refund_amount)
                   IS DISTINCT FROM ROW(OLD.initiated_by,OLD.initiated_at,OLD.provider_refund_id,OLD.approved_refund_amount)
                THEN RAISE EXCEPTION 'Authorized refund identity and amount cannot change'; END IF;
                RETURN NEW;
            END; $$ LANGUAGE plpgsql
        """)
        op.execute("CREATE TRIGGER protect_cashfree_refund_initiator BEFORE UPDATE ON refunds FOR EACH ROW EXECUTE FUNCTION protect_cashfree_refund_initiator()")


def downgrade():
    if op.get_bind().execute(sa.text("SELECT 1 FROM cashfree_payment_resolutions LIMIT 1")).first():
        raise RuntimeError("Cannot remove payment resolution history")
    if op.get_bind().execute(sa.text("SELECT 1 FROM refunds WHERE initiated_at IS NOT NULL LIMIT 1")).first():
        raise RuntimeError("Cannot remove refund initiation history")
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP TRIGGER protect_cashfree_refund_initiator ON refunds")
        op.execute("DROP FUNCTION protect_cashfree_refund_initiator()")
    op.drop_table("cashfree_payment_resolutions")
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP FUNCTION protect_cashfree_resolution()")
        op.drop_constraint("fk_refund_initiated_by", "refunds", type_="foreignkey")
    op.drop_column("refunds", "initiated_at")
    op.drop_column("refunds", "initiated_by")
    op.drop_index("uq_refund_registration_open_or_completed", table_name="refunds")
