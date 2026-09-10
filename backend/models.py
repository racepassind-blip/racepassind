from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Index, Integer, Interval, Numeric, String, Text, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    normalized_email: Mapped[str | None] = mapped_column(String, nullable=True, unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String, nullable=True)
    normalized_phone: Mapped[str | None] = mapped_column(String, nullable=True, unique=True, index=True)
    email_verified_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    phone_verified_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    organizations: Mapped[list["Organization"]] = relationship(back_populates="creator")
    memberships: Mapped[list["OrganizationMember"]] = relationship(back_populates="user")
    sessions: Mapped[list["AuthSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    registrations: Mapped[list["Registration"]] = relationship(back_populates="user")


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    website: Mapped[str | None] = mapped_column(String, nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String, nullable=False, server_default="active")
    fee_type: Mapped[str] = mapped_column(String, nullable=False, server_default="none")
    fee_value_paise: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    fee_percentage_basis_points: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    creator: Mapped[User | None] = relationship(back_populates="organizations")
    members: Mapped[list["OrganizationMember"]] = relationship(back_populates="organization", cascade="all, delete-orphan")
    events: Mapped[list["Event"]] = relationship(back_populates="organization")


class Event(Base):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String, nullable=False)
    location_name: Mapped[str | None] = mapped_column(String, nullable=True)
    address: Mapped[str | None] = mapped_column(String, nullable=True)
    city: Mapped[str | None] = mapped_column(String, nullable=True)
    state: Mapped[str | None] = mapped_column(String, nullable=True)
    country: Mapped[str | None] = mapped_column(String, nullable=True)
    latitude: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    banner_url: Mapped[str | None] = mapped_column(String, nullable=True)
    start_date: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_date: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    registration_open: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    registration_close: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    max_participants: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    distance: Mapped[str] = mapped_column(String, nullable=False)
    participants: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    rules: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
    archived_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    organization: Mapped[Organization] = relationship(back_populates="events")
    tickets: Mapped[list["Ticket"]] = relationship(back_populates="event", cascade="all, delete-orphan")
    categories: Mapped[list["EventCategory"]] = relationship(back_populates="event", cascade="all, delete-orphan")
    documents: Mapped[list["EventDocument"]] = relationship(back_populates="event", cascade="all, delete-orphan")
    discount_codes: Mapped[list["DiscountCode"]] = relationship(back_populates="event", cascade="all, delete-orphan")
    payment_settings: Mapped["EventPaymentSettings | None"] = relationship(
        back_populates="event", cascade="all, delete-orphan", uselist=False
    )

    @property
    def title(self) -> str:
        return self.name

    @property
    def date(self) -> str:
        if self.start_date is None:
            return ""
        return self.start_date.date().isoformat()

    @property
    def location(self) -> str:
        if self.location_name:
            return self.location_name
        parts = [p for p in [self.city, self.country] if p]
        return ", ".join(parts)

    @property
    def image(self) -> str:
        return self.banner_url or "/placeholder.svg"

    @property
    def maxParticipants(self) -> int:
        return self.max_participants

    @property
    def organizer(self) -> str:
        return self.organization.name

    @property
    def tiers(self) -> list["Ticket"]:
        return self.tickets


class EventCategory(Base):
    __tablename__ = "event_categories"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    distance: Mapped[str | None] = mapped_column(String, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    age_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    age_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gender: Mapped[str | None] = mapped_column(String, nullable=True)
    max_participants: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    event: Mapped[Event] = relationship(back_populates="categories")
    tickets: Mapped[list["Ticket"]] = relationship(back_populates="category")


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, index=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("event_categories.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    price: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String, nullable=False)
    quantity_total: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity_sold: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    quantity_reserved: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    sale_start: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sale_end: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    max_per_user: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    event: Mapped[Event] = relationship(back_populates="tickets")
    category: Mapped[EventCategory | None] = relationship(back_populates="tickets")
    registrations: Mapped[list["Registration"]] = relationship(back_populates="ticket")

    @property
    def available(self) -> int:
        return max(0, self.quantity_total - self.quantity_sold - self.quantity_reserved)


class Participant(Base):
    __tablename__ = "participants"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    normalized_email: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    phone: Mapped[str | None] = mapped_column(String, nullable=True)
    normalized_phone: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    date_of_birth: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    gender: Mapped[str | None] = mapped_column(String, nullable=True)
    jersey_size: Mapped[str | None] = mapped_column(String, nullable=True)
    team_name: Mapped[str | None] = mapped_column(String, nullable=True)
    emergency_contact: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    registrations: Mapped[list["Registration"]] = relationship(back_populates="participant")


class Registration(Base):
    __tablename__ = "registrations"
    __table_args__ = (
        Index("ix_registrations_event_status_created_id", "event_id", "status", "created_at", "id"),
        Index("ix_registrations_event_checked_created_id", "event_id", "checked_in", "created_at", "id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, index=True)
    participant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("participants.id"), nullable=False, index=True)
    ticket_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tickets.id"), nullable=False, index=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("event_categories.id"), nullable=True, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    bib_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    qr_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    payment_status: Mapped[str] = mapped_column(String, nullable=False, server_default="pending")
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    unit_price_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_amount_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    registration_reference: Mapped[str | None] = mapped_column(String, nullable=True, unique=True, index=True)
    confirmation_token_hash: Mapped[str | None] = mapped_column(String, nullable=True, unique=True, index=True)
    claim_code_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    claim_code_expires_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claim_code_claimed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ticket_token_hash: Mapped[str | None] = mapped_column(String, nullable=True, unique=True, index=True)
    reserved_until: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    checked_in: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    checked_in_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    participant: Mapped[Participant] = relationship(back_populates="registrations")
    user: Mapped[User | None] = relationship(back_populates="registrations")
    ticket: Mapped[Ticket] = relationship(back_populates="registrations")
    order_items: Mapped[list["OrderItem"]] = relationship(back_populates="registration")
    checkins: Mapped[list["Checkin"]] = relationship(back_populates="registration")
    payment: Mapped["Payment | None"] = relationship(back_populates="registration", uselist=False)


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    total_amount: Mapped[float] = mapped_column(Numeric, nullable=False)
    total_amount_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String, nullable=True, unique=True, index=True)
    currency: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    items: Mapped[list["OrderItem"]] = relationship(back_populates="order", cascade="all, delete-orphan")
    payments: Mapped[list["Payment"]] = relationship(back_populates="order", cascade="all, delete-orphan")


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("orders.id"), nullable=False, index=True)
    registration_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("registrations.id"), nullable=False, index=True)
    price: Mapped[float] = mapped_column(Numeric, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    order: Mapped[Order] = relationship(back_populates="items")
    registration: Mapped[Registration] = relationship(back_populates="order_items")


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("orders.id"), nullable=False, index=True)
    registration_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("registrations.id"), nullable=True, unique=True, index=True)
    amount: Mapped[float] = mapped_column(Numeric, nullable=False)
    expected_amount_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    method: Mapped[str] = mapped_column(String, nullable=False, server_default="manual_upi")
    currency: Mapped[str] = mapped_column(String, nullable=False)
    payment_gateway: Mapped[str] = mapped_column(String, nullable=False)
    gateway_order_id: Mapped[str | None] = mapped_column(String, nullable=True)
    transaction_id: Mapped[str | None] = mapped_column(String, nullable=True)
    utr_reference: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    decision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    paid_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    order: Mapped[Order] = relationship(back_populates="payments")
    registration: Mapped[Registration | None] = relationship(back_populates="payment")


class Checkin(Base):
    __tablename__ = "checkins"
    __table_args__ = (Index("uq_checkins_registration_id", "registration_id", unique=True),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    registration_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("registrations.id"), nullable=False, index=False)
    checked_in_by: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    checked_in_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    device_info: Mapped[str | None] = mapped_column(Text, nullable=True)

    registration: Mapped[Registration] = relationship(back_populates="checkins")


class EventDocument(Base):
    __tablename__ = "event_documents"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    file_url: Mapped[str] = mapped_column(String, nullable=False)
    file_type: Mapped[str | None] = mapped_column(String, nullable=True)
    uploaded_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    event: Mapped[Event] = relationship(back_populates="documents")


class DiscountCode(Base):
    __tablename__ = "discount_codes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String, nullable=False)
    discount_type: Mapped[str] = mapped_column(String, nullable=False)
    discount_value: Mapped[float] = mapped_column(Numeric, nullable=False)
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    used_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    expires_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    event: Mapped[Event] = relationship(back_populates="discount_codes")

    __table_args__ = (Index("ix_discount_codes_event_id_code", "event_id", "code", unique=True),)


class RaceResult(Base):
    __tablename__ = "race_results"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, index=True)
    participant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("participants.id"), nullable=False, index=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("event_categories.id"), nullable=True, index=True)
    finish_time: Mapped[dt.timedelta | None] = mapped_column(Interval, nullable=True)
    rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    laps_completed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class OrganizationMember(Base):
    __tablename__ = "organization_members"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organizations.id"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    member_role: Mapped[str] = mapped_column(String, nullable=False, server_default="organizer")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    organization: Mapped[Organization] = relationship(back_populates="members")
    user: Mapped[User] = relationship(back_populates="memberships")


class EventPaymentSettings(Base):
    __tablename__ = "event_payment_settings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, unique=True, index=True)
    method: Mapped[str] = mapped_column(String, nullable=False, server_default="manual_upi")
    upi_id: Mapped[str] = mapped_column(String, nullable=False)
    payee_name: Mapped[str] = mapped_column(String, nullable=False)
    instructions: Mapped[str] = mapped_column(Text, nullable=False, server_default="Pay using the UPI details shown below.")
    qr_image_url: Mapped[str | None] = mapped_column(String, nullable=True)
    qr_image_object_key: Mapped[str | None] = mapped_column(String, nullable=True, unique=True)
    qr_image_content_type: Mapped[str | None] = mapped_column(String, nullable=True)
    qr_image_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    qr_image_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    qr_image_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    qr_image_uploaded_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    event: Mapped[Event] = relationship(back_populates="payment_settings")


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String, nullable=True)
    ip_hash: Mapped[str | None] = mapped_column(String, nullable=True)

    user: Mapped[User] = relationship(back_populates="sessions")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String, nullable=False)
    resource_type: Mapped[str] = mapped_column(String, nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class RateLimitBucket(Base):
    __tablename__ = "rate_limit_buckets"

    key_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    window_started_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
