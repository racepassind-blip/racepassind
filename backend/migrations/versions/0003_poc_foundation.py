"""Add RacePass POC security, ownership, and manual-payment primitives."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0003_poc_foundation"
down_revision = "0002_ticketing_schema"
branch_labels = None
depends_on = None


def _inspector():
    return sa.inspect(op.get_bind())


def _is_sqlite() -> bool:
    return _inspector().dialect.name == "sqlite"


def _add_column(table_name: str, column: sa.Column) -> None:
    if column.name in {column_info["name"] for column_info in _inspector().get_columns(table_name)}:
        return
    if _is_sqlite() and column.foreign_keys:
        # SQLite cannot ALTER TABLE to add a separately managed FK constraint.
        # The production PostgreSQL migration keeps the FK; SQLite remains a
        # local convenience database and gets the column without that constraint.
        column = sa.Column(
            column.name,
            column.type,
            nullable=column.nullable,
            server_default=column.server_default,
        )
    op.add_column(table_name, column)


def _create_index(index_name: str, table_name: str, columns: list[str], **kwargs: object) -> None:
    if index_name not in {index_info["name"] for index_info in _inspector().get_indexes(table_name)}:
        op.create_index(index_name, table_name, columns, **kwargs)


def _create_table(table_name: str, *args: object, **kwargs: object) -> None:
    if not _inspector().has_table(table_name):
        op.create_table(table_name, *args, **kwargs)


def upgrade() -> None:
    _add_column("users", sa.Column("normalized_email", sa.String(), nullable=True))
    _add_column("users", sa.Column("normalized_phone", sa.String(), nullable=True))
    _add_column("users", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))
    _add_column("users", sa.Column("phone_verified_at", sa.DateTime(timezone=True), nullable=True))
    _create_index("ix_users_normalized_email", "users", ["normalized_email"], unique=True)
    _create_index("ix_users_normalized_phone", "users", ["normalized_phone"], unique=True)

    _add_column("organizations", sa.Column("status", sa.String(), nullable=False, server_default="active"))
    _add_column("organizations", sa.Column("fee_type", sa.String(), nullable=False, server_default="none"))
    _add_column("organizations", sa.Column("fee_value_paise", sa.Integer(), nullable=False, server_default="0"))
    _add_column("organizations", sa.Column("fee_percentage_basis_points", sa.Integer(), nullable=False, server_default="0"))

    _create_table(
        "organization_members",
        sa.Column("organization_id", sa.Uuid(as_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("member_role", sa.String(), nullable=False, server_default="organizer"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("organization_id", "user_id"),
    )
    _create_index("ix_organization_members_user_id", "organization_members", ["user_id"])

    _add_column("events", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))

    _add_column("event_categories", sa.Column("distance", sa.String(), nullable=True))

    _add_column("tickets", sa.Column("category_id", sa.Uuid(as_uuid=True), sa.ForeignKey("event_categories.id"), nullable=True))
    _add_column("tickets", sa.Column("quantity_reserved", sa.Integer(), nullable=False, server_default="0"))
    _create_index("ix_tickets_category_id", "tickets", ["category_id"])

    _create_table(
        "event_payment_settings",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("event_id", sa.Uuid(as_uuid=True), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("method", sa.String(), nullable=False, server_default="manual_upi"),
        sa.Column("upi_id", sa.String(), nullable=False),
        sa.Column("payee_name", sa.String(), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False, server_default="Pay using the UPI details shown below."),
        sa.Column("qr_image_url", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("event_id", name="uq_event_payment_settings_event_id"),
    )
    _create_index("ix_event_payment_settings_event_id", "event_payment_settings", ["event_id"])

    _add_column("participants", sa.Column("normalized_email", sa.String(), nullable=True))
    _add_column("participants", sa.Column("normalized_phone", sa.String(), nullable=True))
    _create_index("ix_participants_normalized_email", "participants", ["normalized_email"])
    _create_index("ix_participants_normalized_phone", "participants", ["normalized_phone"])

    _add_column("registrations", sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id"), nullable=True))
    _add_column("registrations", sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"))
    _add_column("registrations", sa.Column("unit_price_paise", sa.Integer(), nullable=True))
    _add_column("registrations", sa.Column("total_amount_paise", sa.Integer(), nullable=True))
    _add_column("registrations", sa.Column("registration_reference", sa.String(), nullable=True))
    _add_column("registrations", sa.Column("confirmation_token_hash", sa.String(), nullable=True))
    _add_column("registrations", sa.Column("claim_code_hash", sa.String(), nullable=True))
    _add_column("registrations", sa.Column("ticket_token_hash", sa.String(), nullable=True))
    _add_column("registrations", sa.Column("payment_status", sa.String(), nullable=False, server_default="pending"))
    _add_column("registrations", sa.Column("reserved_until", sa.DateTime(timezone=True), nullable=True))
    _add_column("registrations", sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))
    _create_index("ix_registrations_user_id", "registrations", ["user_id"])
    _create_index("ix_registrations_reference", "registrations", ["registration_reference"], unique=True)
    _create_index("ix_registrations_confirmation_token_hash", "registrations", ["confirmation_token_hash"], unique=True)
    _create_index("ix_registrations_ticket_token_hash", "registrations", ["ticket_token_hash"], unique=True)
    _create_index("ix_registrations_payment_status", "registrations", ["payment_status"])

    _add_column("orders", sa.Column("idempotency_key", sa.String(), nullable=True))
    _add_column("orders", sa.Column("total_amount_paise", sa.Integer(), nullable=True))
    _create_index("ix_orders_idempotency_key", "orders", ["idempotency_key"], unique=True)

    _add_column("payments", sa.Column("registration_id", sa.Uuid(as_uuid=True), sa.ForeignKey("registrations.id"), nullable=True))
    _add_column("payments", sa.Column("method", sa.String(), nullable=False, server_default="manual_upi"))
    _add_column("payments", sa.Column("expected_amount_paise", sa.Integer(), nullable=True))
    _add_column("payments", sa.Column("utr_reference", sa.String(), nullable=True))
    _add_column("payments", sa.Column("decision_reason", sa.Text(), nullable=True))
    _add_column("payments", sa.Column("reviewed_by", sa.Uuid(as_uuid=True), nullable=True))
    if not _is_sqlite() and "fk_payments_reviewed_by_users" not in {
        foreign_key["name"] for foreign_key in _inspector().get_foreign_keys("payments")
    }:
        op.create_foreign_key("fk_payments_reviewed_by_users", "payments", "users", ["reviewed_by"], ["id"])
    _add_column("payments", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))
    _add_column("payments", sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True))
    _create_index("ix_payments_registration_id", "payments", ["registration_id"], unique=True)
    _create_index("ix_payments_utr_reference", "payments", ["utr_reference"])
    _create_index("ix_payments_status", "payments", ["status"])

    _create_index("ix_checkins_registration_id_unique", "checkins", ["registration_id"], unique=True)

    _create_table(
        "auth_sessions",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("user_agent", sa.String(), nullable=True),
        sa.Column("ip_hash", sa.String(), nullable=True),
    )
    _create_index("ix_auth_sessions_token_hash", "auth_sessions", ["token_hash"], unique=True)
    _create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])

    _create_table(
        "audit_logs",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("actor_user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("resource_type", sa.String(), nullable=False),
        sa.Column("resource_id", sa.String(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    _create_index("ix_audit_logs_actor_user_id", "audit_logs", ["actor_user_id"])
    _create_index("ix_audit_logs_resource", "audit_logs", ["resource_type", "resource_id"])
    _create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_audit_logs_created_at", table_name="audit_logs")
    op.drop_index("ix_audit_logs_resource", table_name="audit_logs")
    op.drop_index("ix_audit_logs_actor_user_id", table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_index("ix_auth_sessions_user_id", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_token_hash", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_index("ix_checkins_registration_id_unique", table_name="checkins")

    op.drop_index("ix_payments_status", table_name="payments")
    op.drop_index("ix_payments_utr_reference", table_name="payments")
    op.drop_index("ix_payments_registration_id", table_name="payments")
    for column in ("submitted_at", "reviewed_at", "reviewed_by", "decision_reason", "utr_reference", "expected_amount_paise", "method", "registration_id"):
        op.drop_column("payments", column)

    op.drop_index("ix_orders_idempotency_key", table_name="orders")
    op.drop_column("orders", "total_amount_paise")
    op.drop_column("orders", "idempotency_key")

    for index in (
        "ix_registrations_payment_status",
        "ix_registrations_ticket_token_hash",
        "ix_registrations_confirmation_token_hash",
        "ix_registrations_reference",
        "ix_registrations_user_id",
    ):
        op.drop_index(index, table_name="registrations")
    for column in (
        "updated_at",
        "reserved_until",
        "payment_status",
        "ticket_token_hash",
        "claim_code_hash",
        "confirmation_token_hash",
        "registration_reference",
        "total_amount_paise",
        "unit_price_paise",
        "quantity",
        "user_id",
    ):
        op.drop_column("registrations", column)

    op.drop_index("ix_participants_normalized_phone", table_name="participants")
    op.drop_index("ix_participants_normalized_email", table_name="participants")
    op.drop_column("participants", "normalized_phone")
    op.drop_column("participants", "normalized_email")

    op.drop_index("ix_event_payment_settings_event_id", table_name="event_payment_settings")
    op.drop_table("event_payment_settings")
    op.drop_index("ix_tickets_category_id", table_name="tickets")
    op.drop_column("tickets", "quantity_reserved")
    op.drop_column("tickets", "category_id")
    op.drop_column("event_categories", "distance")
    op.drop_column("events", "archived_at")
    op.drop_index("ix_organization_members_user_id", table_name="organization_members")
    op.drop_table("organization_members")
    op.drop_column("organizations", "fee_percentage_basis_points")
    op.drop_column("organizations", "fee_value_paise")
    op.drop_column("organizations", "fee_type")
    op.drop_column("organizations", "status")
    op.drop_index("ix_users_normalized_phone", table_name="users")
    op.drop_index("ix_users_normalized_email", table_name="users")
    op.drop_column("users", "phone_verified_at")
    op.drop_column("users", "email_verified_at")
    op.drop_column("users", "normalized_phone")
    op.drop_column("users", "normalized_email")
