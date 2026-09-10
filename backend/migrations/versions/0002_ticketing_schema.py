from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0002_ticketing_schema"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("ticket_tiers")
    op.drop_table("events")

    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "organizations",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("website", sa.String(), nullable=True),
        sa.Column("logo_url", sa.String(), nullable=True),
        sa.Column("created_by", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_organizations_created_by", "organizations", ["created_by"])

    op.create_table(
        "events",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("organization_id", sa.Uuid(as_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("location_name", sa.String(), nullable=True),
        sa.Column("address", sa.String(), nullable=True),
        sa.Column("city", sa.String(), nullable=True),
        sa.Column("state", sa.String(), nullable=True),
        sa.Column("country", sa.String(), nullable=True),
        sa.Column("latitude", sa.Numeric(), nullable=True),
        sa.Column("longitude", sa.Numeric(), nullable=True),
        sa.Column("banner_url", sa.String(), nullable=True),
        sa.Column("start_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("registration_open", sa.DateTime(timezone=True), nullable=True),
        sa.Column("registration_close", sa.DateTime(timezone=True), nullable=True),
        sa.Column("max_participants", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("distance", sa.String(), nullable=False),
        sa.Column("participants", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("rules", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("idx_events_org", "events", ["organization_id"])

    op.create_table(
        "event_categories",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("event_id", sa.Uuid(as_uuid=True), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("age_min", sa.Integer(), nullable=True),
        sa.Column("age_max", sa.Integer(), nullable=True),
        sa.Column("gender", sa.String(), nullable=True),
        sa.Column("max_participants", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_event_categories_event_id", "event_categories", ["event_id"])

    op.create_table(
        "tickets",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("event_id", sa.Uuid(as_uuid=True), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("price", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(), nullable=False),
        sa.Column("quantity_total", sa.Integer(), nullable=False),
        sa.Column("quantity_sold", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("sale_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sale_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("max_per_user", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("idx_ticket_event", "tickets", ["event_id"])

    op.create_table(
        "participants",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("date_of_birth", sa.Date(), nullable=True),
        sa.Column("gender", sa.String(), nullable=True),
        sa.Column("jersey_size", sa.String(), nullable=True),
        sa.Column("team_name", sa.String(), nullable=True),
        sa.Column("emergency_contact", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_participants_email", "participants", ["email"])

    op.create_table(
        "registrations",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("event_id", sa.Uuid(as_uuid=True), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("participant_id", sa.Uuid(as_uuid=True), sa.ForeignKey("participants.id"), nullable=False),
        sa.Column("ticket_id", sa.Uuid(as_uuid=True), sa.ForeignKey("tickets.id"), nullable=False),
        sa.Column("category_id", sa.Uuid(as_uuid=True), sa.ForeignKey("event_categories.id"), nullable=True),
        sa.Column("bib_number", sa.Integer(), nullable=True),
        sa.Column("qr_code", sa.Text(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("checked_in", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("checked_in_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("idx_reg_event", "registrations", ["event_id"])
    op.create_index("idx_reg_participant", "registrations", ["participant_id"])
    op.create_index("ix_registrations_ticket_id", "registrations", ["ticket_id"])
    op.create_index("ix_registrations_category_id", "registrations", ["category_id"])

    op.create_table(
        "orders",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("total_amount", sa.Numeric(), nullable=False),
        sa.Column("currency", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_orders_user_id", "orders", ["user_id"])

    op.create_table(
        "order_items",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("order_id", sa.Uuid(as_uuid=True), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("registration_id", sa.Uuid(as_uuid=True), sa.ForeignKey("registrations.id"), nullable=False),
        sa.Column("price", sa.Numeric(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_order_items_order_id", "order_items", ["order_id"])
    op.create_index("ix_order_items_registration_id", "order_items", ["registration_id"])

    op.create_table(
        "payments",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("order_id", sa.Uuid(as_uuid=True), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("amount", sa.Numeric(), nullable=False),
        sa.Column("currency", sa.String(), nullable=False),
        sa.Column("payment_gateway", sa.String(), nullable=False),
        sa.Column("gateway_order_id", sa.String(), nullable=True),
        sa.Column("transaction_id", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_payments_order_id", "payments", ["order_id"])

    op.create_table(
        "checkins",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("registration_id", sa.Uuid(as_uuid=True), sa.ForeignKey("registrations.id"), nullable=False),
        sa.Column("checked_in_by", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("checked_in_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("device_info", sa.Text(), nullable=True),
    )
    op.create_index("ix_checkins_registration_id", "checkins", ["registration_id"])
    op.create_index("ix_checkins_checked_in_by", "checkins", ["checked_in_by"])

    op.create_table(
        "event_documents",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("event_id", sa.Uuid(as_uuid=True), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("file_url", sa.String(), nullable=False),
        sa.Column("file_type", sa.String(), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_event_documents_event_id", "event_documents", ["event_id"])

    op.create_table(
        "discount_codes",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("event_id", sa.Uuid(as_uuid=True), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("discount_type", sa.String(), nullable=False),
        sa.Column("discount_value", sa.Numeric(), nullable=False),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column("used_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_discount_codes_event_id", "discount_codes", ["event_id"])
    op.create_index("ix_discount_codes_event_id_code", "discount_codes", ["event_id", "code"], unique=True)

    op.create_table(
        "race_results",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("event_id", sa.Uuid(as_uuid=True), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("participant_id", sa.Uuid(as_uuid=True), sa.ForeignKey("participants.id"), nullable=False),
        sa.Column("category_id", sa.Uuid(as_uuid=True), sa.ForeignKey("event_categories.id"), nullable=True),
        sa.Column("finish_time", sa.Interval(), nullable=True),
        sa.Column("rank", sa.Integer(), nullable=True),
        sa.Column("laps_completed", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    op.create_index("ix_race_results_event_id", "race_results", ["event_id"])
    op.create_index("ix_race_results_participant_id", "race_results", ["participant_id"])
    op.create_index("ix_race_results_category_id", "race_results", ["category_id"])


def downgrade() -> None:
    op.drop_table("race_results")
    op.drop_table("discount_codes")
    op.drop_table("event_documents")
    op.drop_table("checkins")
    op.drop_table("payments")
    op.drop_table("order_items")
    op.drop_table("orders")
    op.drop_table("registrations")
    op.drop_table("participants")
    op.drop_table("tickets")
    op.drop_table("event_categories")
    op.drop_table("events")
    op.drop_table("organizations")
    op.drop_table("users")

    op.create_table(
        "events",
        sa.Column("id", sa.String(), primary_key=True, nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("date", sa.String(), nullable=False),
        sa.Column("location", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("image", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("distance", sa.String(), nullable=False),
        sa.Column("participants", sa.Integer(), nullable=False),
        sa.Column("maxParticipants", sa.Integer(), nullable=False),
        sa.Column("organizer", sa.String(), nullable=False),
        sa.Column("rules", sa.JSON(), nullable=False),
    )
    op.create_table(
        "ticket_tiers",
        sa.Column("id", sa.String(), primary_key=True, nullable=False),
        sa.Column("event_id", sa.String(), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("price", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("available", sa.Integer(), nullable=False),
    )
    op.create_index("ix_ticket_tiers_event_id", "ticket_tiers", ["event_id"])
