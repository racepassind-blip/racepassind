from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import JSON, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Interval, Numeric, String, Text, UniqueConstraint, Uuid, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


JSON_CONFIG = JSON().with_variant(JSONB, "postgresql")


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    normalized_email: Mapped[str | None] = mapped_column(String, nullable=True, unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String, nullable=True)
    normalized_phone: Mapped[str | None] = mapped_column(String, nullable=True, unique=True, index=True)
    clerk_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)
    clerk_deleted_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    email_verified_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    phone_verified_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    # Admin accounts must enroll in TOTP MFA before accessing privileged APIs.
    mfa_secret_encrypted: Mapped[str | None] = mapped_column(String(512), nullable=True)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    organizations: Mapped[list["Organization"]] = relationship(back_populates="creator", foreign_keys="Organization.created_by")
    memberships: Mapped[list["OrganizationMember"]] = relationship(back_populates="user")
    sessions: Mapped[list["AuthSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    registrations: Mapped[list["Registration"]] = relationship(back_populates="user")


class OrganizerApplication(Base):
    __tablename__ = "organizer_applications"
    __table_args__ = (
        Index("ix_organizer_applications_status_created_at", "status", "created_at"),
        Index("ix_organizer_applications_normalized_email", "normalized_email"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_name: Mapped[str] = mapped_column(String, nullable=False)
    applicant_name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str] = mapped_column(String, nullable=False)
    normalized_email: Mapped[str] = mapped_column(String, nullable=False)
    phone: Mapped[str | None] = mapped_column(String, nullable=True)
    normalized_phone: Mapped[str | None] = mapped_column(String, nullable=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, server_default="pending")
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    reviewed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    approved_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True, unique=True
    )
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String, nullable=False)
    organization_type: Mapped[str | None] = mapped_column(String, nullable=True)
    city: Mapped[str | None] = mapped_column(String, nullable=True)
    state: Mapped[str | None] = mapped_column(String, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    website: Mapped[str | None] = mapped_column(String, nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String, nullable=False, server_default="active")
    fee_type: Mapped[str] = mapped_column(String, nullable=False, server_default="none")
    fee_value_paise: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    fee_percentage_basis_points: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # Current SportPass pricing override. Historical fee_* fields above are retained.
    platform_pricing_mode: Mapped[str] = mapped_column(String(32), nullable=False, server_default="DEFAULT")
    platform_fee_percentage_basis_points: Mapped[int | None] = mapped_column(Integer, nullable=True)
    platform_fee_min_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    platform_fee_max_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    platform_fee_fixed_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    credit_deduction_mode: Mapped[str] = mapped_column(String(40), nullable=False, server_default="AUTOMATIC_PER_REGISTRATION")
    onboarding_completed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    
    # Paid organizer verification fields
    paid_verification_status: Mapped[str] = mapped_column(
        String, nullable=False, server_default="NOT_SUBMITTED"
    )
    pan_number: Mapped[str | None] = mapped_column(String(10), nullable=True)
    name_as_per_pan: Mapped[str | None] = mapped_column(String(200), nullable=True)
    gst_registered: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    gst_number: Mapped[str | None] = mapped_column(String(15), nullable=True)
    billing_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    billing_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    billing_city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    billing_state: Mapped[str | None] = mapped_column(String(120), nullable=True)
    billing_pincode: Mapped[str | None] = mapped_column(String(10), nullable=True)
    paid_verification_submitted_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_verification_reviewed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_verification_reviewed_by: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    paid_verification_rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    paid_verification_suspended_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_verification_suspended_by: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    paid_verification_suspension_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Payment access control: admin controls whether this org may use Direct UPI.
    # Direct UPI sends participant money straight to the organizer; SportPass carries
    # billing risk if the organizer does not pay the platform fee later.
    # Default false — admin must explicitly enable for each trusted organizer.
    allow_direct_upi: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"), default=False)
    allow_cashfree: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"), default=False)

    creator: Mapped[User | None] = relationship(back_populates="organizations", foreign_keys=[created_by])
    members: Mapped[list["OrganizationMember"]] = relationship(back_populates="organization", cascade="all, delete-orphan")
    events: Mapped[list["Event"]] = relationship(back_populates="organization")
    founding_program_links: Mapped[list["FoundingProgramOrganization"]] = relationship(back_populates="organization", cascade="all, delete-orphan")


class PricingPlan(Base):
    __tablename__ = "pricing_plans"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    min_confirmed_registrations: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    max_confirmed_registrations: Mapped[int | None] = mapped_column(Integer, nullable=True)
    price_paise: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    billing_unit: Mapped[str] = mapped_column(String, nullable=False, server_default="per_event")
    currency: Mapped[str] = mapped_column(String, nullable=False, server_default="INR")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class FoundingProgram(Base):
    __tablename__ = "founding_programs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    free_races_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="2")
    default_discount_basis_points: Mapped[int] = mapped_column(Integer, nullable=False, server_default="10000")
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    eligible_organizations: Mapped[list["FoundingProgramOrganization"]] = relationship(
        back_populates="program", cascade="all, delete-orphan"
    )


class FoundingProgramOrganization(Base):
    __tablename__ = "founding_program_organizations"

    program_id: Mapped[int] = mapped_column(Integer, ForeignKey("founding_programs.id"), primary_key=True)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("organizations.id"), primary_key=True
    )

    program: Mapped[FoundingProgram] = relationship(back_populates="eligible_organizations")
    organization: Mapped[Organization] = relationship(back_populates="founding_program_links")


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
    whatsapp_group_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    start_date: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_date: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    registration_open: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    registration_close: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    registration_status: Mapped[str] = mapped_column(String, nullable=False, default="open", server_default="open")
    max_participants: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    distance: Mapped[str] = mapped_column(String, nullable=False)
    participants: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    rules: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    schedule: Mapped[list[dict[str, str]]] = mapped_column(JSON, nullable=False, default=list, server_default=text("'[]'"))
    field_config: Mapped[dict] = mapped_column(JSON_CONFIG, nullable=False, default=dict, server_default=text("'{}'"))
    addon_config: Mapped[dict] = mapped_column(JSON_CONFIG, nullable=False, default=dict, server_default=text("'{}'"))
    payment_collection_method: Mapped[str] = mapped_column(String(20), nullable=False, server_default="DIRECT_UPI")
    # Who bears the SportPass platform fee for paid registrations on this event.
    # ORGANIZER: participant pays only the registration price; organizer owes SportPass the fee.
    # PARTICIPANT: the SportPass fee is added to the participant's payable amount.
    platform_fee_bearer: Mapped[str] = mapped_column(String(20), nullable=False, server_default="ORGANIZER")
    # Admin override: when true, unlock all paid-only features for this event regardless of free/paid status.
    features_unlocked: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"), default=False)
    # Refund policy — all fields optional; only active when refund_policy_enabled = true.
    # refund_policy_type: full_refund | partial_refund | organizer_approval | no_refund
    refund_policy_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"), default=False)
    refund_policy_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    refund_cutoff_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    refund_percentage: Mapped[int | None] = mapped_column(Integer, nullable=True)
    platform_fee_refundable: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"), default=False)
    refund_policy_text: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    billing: Mapped["OrganizerEventBilling | None"] = relationship(
        back_populates="event", cascade="all, delete-orphan", uselist=False
    )
    courts: Mapped[list["Court"]] = relationship(back_populates="event", cascade="all, delete-orphan")
    tournament_rounds: Mapped[list["TournamentRound"]] = relationship(back_populates="event", cascade="all, delete-orphan")
    matches: Mapped[list["Match"]] = relationship(back_populates="event", cascade="all, delete-orphan")
    checkpoints: Mapped[list["EventCheckpoint"]] = relationship(
        back_populates="event", cascade="all, delete-orphan", order_by="EventCheckpoint.position"
    )
    # Allocation history entries for this event
    allocation_history: Mapped[list["AllocationHistory"]] = relationship(
        back_populates="event", cascade="all, delete-orphan"
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
    def locationDetails(self) -> dict[str, str | float | None]:
        return {
            "name": self.location_name,
            "address": self.address,
            "city": self.city,
            "state": self.state,
            "country": self.country,
            "latitude": float(self.latitude) if self.latitude is not None else None,
            "longitude": float(self.longitude) if self.longitude is not None else None,
        }

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


class Court(Base):
    __tablename__ = "courts"
    __table_args__ = (UniqueConstraint("event_id", "name", name="uq_courts_event_name"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    event: Mapped[Event] = relationship(back_populates="courts")
    matches: Mapped[list["Match"]] = relationship(back_populates="court")


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
    entry_type: Mapped[str] = mapped_column(String(20), nullable=False, default="singles", server_default="singles")
    participants_per_entry: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    max_participants: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Team size range — only populated when entry_type == "team"
    team_size_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    team_size_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Number allocation range for this category (optional)
    number_range_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    number_range_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    event: Mapped[Event] = relationship(back_populates="categories")
    matches: Mapped[list["Match"]] = relationship(back_populates="category")
    tournament_rounds: Mapped[list["TournamentRound"]] = relationship(back_populates="category", cascade="all, delete-orphan")
    scoring_config: Mapped["BadmintonCategoryScoring | None"] = relationship(
        back_populates="category", cascade="all, delete-orphan", uselist=False
    )
    team_scoring_config: Mapped["TeamMatchScoring | None"] = relationship(
        back_populates="category", cascade="all, delete-orphan", uselist=False
    )
    tickets: Mapped[list["Ticket"]] = relationship(back_populates="category")
    # Registration entries in this category (for allocation lookups)
    registrations: Mapped[list["Registration"]] = relationship(back_populates="category")


class EmailLog(Base):
    """Centralized email log for tracking all outgoing emails."""

    __tablename__ = "email_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipient: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    subject: Mapped[str] = mapped_column(String(500), nullable=False)
    # Email type: REGISTRATION_CONFIRMATION, TICKET, PAYMENT_CONFIRMATION, ADMIN_LIMIT_WARNING
    email_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # Reference type and ID for linking to entities (REGISTRATION, EVENT, etc.)
    reference_type: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    reference_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    # Event mapping: allows querying all emails/recipients for an event (broadcasts).
    event_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("events.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Status: PENDING, SENT, FAILED, PENDING_LIMIT, SKIPPED_DISABLED
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="pending", index=True)
    # Failure reason for FAILED status
    failure_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Provider (email service used)
    provider: Mapped[str] = mapped_column(String(50), nullable=False, server_default="gmail_smtp")
    # Attempted at is when the send was attempted
    attempted_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Sent at is when the email was successfully sent
    sent_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Resend flag: true when the email was sent via manual resend (not original send)
    is_resend: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class TournamentRound(Base):
    __tablename__ = "tournament_rounds"
    __table_args__ = (UniqueConstraint("category_id", "position", name="uq_tournament_rounds_category_position"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, index=True)
    category_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("event_categories.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    event: Mapped[Event] = relationship(back_populates="tournament_rounds")
    category: Mapped[EventCategory] = relationship(back_populates="tournament_rounds")
    matches: Mapped[list["Match"]] = relationship(back_populates="round")


class BadmintonCategoryScoring(Base):
    __tablename__ = "badminton_category_scoring"
    __table_args__ = (UniqueConstraint("category_id", name="uq_badminton_category_scoring_category"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, index=True)
    category_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("event_categories.id"), nullable=False, index=True)
    games_to_win: Mapped[int] = mapped_column(Integer, nullable=False, server_default="2")
    points_per_game: Mapped[int] = mapped_column(Integer, nullable=False, server_default="21")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    category: Mapped[EventCategory] = relationship(back_populates="scoring_config")


class TeamMatchScoring(Base):
    """Flexible point rules for team-format tournament categories."""

    __tablename__ = "team_match_scoring"
    __table_args__ = (UniqueConstraint("category_id", name="uq_team_match_scoring_category"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, index=True)
    category_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("event_categories.id"), nullable=False, index=True)
    points_for_win: Mapped[int] = mapped_column(Integer, nullable=False, server_default="3")
    points_for_draw: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    points_for_loss: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # 'bouts' = winner determined by bout majority; 'manual' = organiser sets winner directly
    winner_by: Mapped[str] = mapped_column(String(20), nullable=False, server_default="bouts")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    category: Mapped[EventCategory] = relationship(back_populates="team_scoring_config")


class OrganizerEventBilling(Base):
    __tablename__ = "organizer_event_billings"
    __table_args__ = (
        Index("ix_organizer_event_billings_organization_status", "organization_id", "billing_status"),
        Index("ix_organizer_event_billings_due_at", "due_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, unique=True)
    organization_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True)
    plan_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("pricing_plans.id"), nullable=True, index=True)
    plan_code: Mapped[str | None] = mapped_column(String, nullable=True)
    plan_name: Mapped[str | None] = mapped_column(String, nullable=True)
    confirmed_registrations: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    applicable_price_paise: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    discount_paise: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    final_amount_paise: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    currency: Mapped[str] = mapped_column(String, nullable=False, server_default="INR")
    billing_status: Mapped[str] = mapped_column(String, nullable=False, server_default="not_billed")
    due_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finalized_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    payment_reference: Mapped[str | None] = mapped_column(String, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    event: Mapped[Event] = relationship(back_populates="billing")
    organization: Mapped[Organization] = relationship()
    plan: Mapped[PricingPlan | None] = relationship()


class PlatformFeeConfig(Base):
    """Singleton configuration for default SportPass registration pricing."""

    __tablename__ = "platform_fee_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # A human label shown to organizers.
    label: Mapped[str] = mapped_column(String, nullable=False, server_default="Standard SportPass Pricing")
    # Percentage component expressed in basis points (400 = 4%).
    percentage_basis_points: Mapped[int] = mapped_column(Integer, nullable=False, server_default="400")
    # Historical flat add-on column; active pricing keeps this at zero.
    per_registration_paise: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    minimum_fee_paise: Mapped[int] = mapped_column(Integer, nullable=False, server_default="2000")
    maximum_fee_paise: Mapped[int] = mapped_column(Integer, nullable=False, server_default="6000")
    currency: Mapped[str] = mapped_column(String, nullable=False, server_default="INR")
    # Historical invoice due-days column retained with old records.
    default_due_days: Mapped[int] = mapped_column(Integer, nullable=False, server_default="14")
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class OrganizerPlatformFeeBilling(Base):
    """Per-event SportPass platform-fee ledger for PAID events only.

    Separate and independent from OrganizerEventBilling (the plan/founding
    program ledger). One row per event, created when an admin raises a bill.
    Amounts are integer paise. Statuses: accruing (implicit, no row), payment_due,
    paid, overdue, waived. A record is only ever created for paid events.
    """

    __tablename__ = "organizer_platform_fee_billings"
    __table_args__ = (
        Index("ix_platform_fee_billings_org_status", "organization_id", "billing_status"),
        Index("ix_platform_fee_billings_due_at", "due_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, unique=True)
    organization_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True)
    # Human-friendly sequential-ish invoice number, e.g. "SPF-2026-000123".
    invoice_number: Mapped[str | None] = mapped_column(String, nullable=True, unique=True, index=True)
    # Snapshot of the fee inputs at the time the bill was raised.
    paid_registration_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    registration_revenue_paise: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    percentage_basis_points: Mapped[int] = mapped_column(Integer, nullable=False, server_default="500")
    per_registration_paise: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1000")
    gross_fee_paise: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    discount_paise: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    final_amount_paise: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    currency: Mapped[str] = mapped_column(String, nullable=False, server_default="INR")
    billing_status: Mapped[str] = mapped_column(String, nullable=False, server_default="payment_due")
    due_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finalized_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    payment_reference: Mapped[str | None] = mapped_column(String, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    event: Mapped[Event] = relationship()
    organization: Mapped[Organization] = relationship()


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
    registration_memberships: Mapped[list["RegistrationParticipant"]] = relationship(
        back_populates="participant", cascade="all, delete-orphan"
    )


class EventCheckpoint(Base):
    __tablename__ = "event_checkpoints"
    __table_args__ = (
        UniqueConstraint("event_id", "position", name="uq_event_checkpoints_event_position"),
        UniqueConstraint("event_id", "name", name="uq_event_checkpoints_event_name"),
        Index("ix_event_checkpoints_event_position", "event_id", "position"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    event: Mapped[Event] = relationship(back_populates="checkpoints")
    checkins: Mapped[list["Checkin"]] = relationship(back_populates="checkpoint")


class RegistrationParticipant(Base):
    __tablename__ = "registration_participants"
    __table_args__ = (
        UniqueConstraint("registration_id", "participant_index", name="uq_registration_participants_index"),
        UniqueConstraint("registration_id", "participant_id", name="uq_registration_participants_participant"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    registration_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("registrations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    participant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("participants.id"), nullable=False, index=True
    )
    participant_index: Mapped[int] = mapped_column(Integer, nullable=False)
    responses: Mapped[dict] = mapped_column(JSON_CONFIG, nullable=False, default=dict, server_default=text("'{}'"))

    registration: Mapped["Registration"] = relationship(back_populates="participant_memberships")
    participant: Mapped[Participant] = relationship(back_populates="registration_memberships")


class Registration(Base):
    __tablename__ = "registrations"
    __table_args__ = (
        Index("ix_registrations_event_status_created_id", "event_id", "status", "created_at", "id"),
        Index("ix_registrations_event_checked_created_id", "event_id", "checked_in", "created_at", "id"),
        Index("ix_registrations_event_created_id", "event_id", "created_at", "id"),
        Index(
            "uq_registrations_event_allocation_number",
            "event_id",
            "allocation_number",
            unique=True,
            postgresql_where=text("allocation_number IS NOT NULL"),
            sqlite_where=text("allocation_number IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, index=True)
    participant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("participants.id"), nullable=False, index=True)
    ticket_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("tickets.id"), nullable=False, index=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("event_categories.id"), nullable=True, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    # Allocation number (generalized from bib_number for use across all sports)
    allocation_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Allocation status: unassigned, draft, published
    allocation_status: Mapped[str] = mapped_column(String, nullable=False, default="unassigned", server_default="unassigned")
    allocation_assigned_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    allocation_updated_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    qr_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    payment_status: Mapped[str] = mapped_column(String, nullable=False, server_default="pending")
    source: Mapped[str] = mapped_column(String, nullable=False, server_default="online", index=True)
    # Email status for quick UI queries (PENDING/SENT/FAILED/PENDING_LIMIT)
    email_status: Mapped[str | None] = mapped_column(String(20), nullable=True, server_default=None, index=True)
    participant_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    unit_price_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Base registration amount (ticket price + add-ons). This is the SportPass
    # fee base and the organizer's revenue — it NEVER includes the platform fee,
    # regardless of who bears it, so organizer billing stays correct.
    total_amount_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Snapshot of the SportPass platform-fee pricing for this registration, frozen
    # at registration time so later pricing/config changes never recompute it.
    # platform_fee_bearer: ORGANIZER | PARTICIPANT (copied from the event).
    platform_fee_bearer: Mapped[str] = mapped_column(String(20), nullable=False, server_default="ORGANIZER")
    # The SportPass fee for this registration in paise (0 for free registrations).
    platform_fee_paise: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # What the participant actually pays: base + fee when PARTICIPANT bears it,
    # otherwise equal to the base amount.
    participant_total_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    responses: Mapped[dict] = mapped_column(JSON_CONFIG, nullable=False, default=dict, server_default=text("'{}'"))
    selections: Mapped[dict] = mapped_column(JSON_CONFIG, nullable=False, default=dict, server_default=text("'{}'"))
    computed_total: Mapped[dict] = mapped_column(JSON_CONFIG, nullable=False, default=dict, server_default=text("'{}'"))
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
    participant_memberships: Mapped[list[RegistrationParticipant]] = relationship(
        back_populates="registration", cascade="all, delete-orphan", order_by="RegistrationParticipant.participant_index"
    )
    user: Mapped[User | None] = relationship(back_populates="registrations")
    ticket: Mapped[Ticket] = relationship(back_populates="registrations")
    category: Mapped[EventCategory | None] = relationship(back_populates="registrations")
    order_items: Mapped[list["OrderItem"]] = relationship(back_populates="registration")
    checkins: Mapped[list["Checkin"]] = relationship(back_populates="registration", cascade="all, delete-orphan")
    payment: Mapped["Payment | None"] = relationship(back_populates="registration", uselist=False)
    # Allocation history entries for this registration
    allocation_history: Mapped[list["AllocationHistory"]] = relationship(
        back_populates="registration", cascade="all, delete-orphan"
    )


class Match(Base):
    __tablename__ = "matches"
    __table_args__ = (
        CheckConstraint(
            "next_match_slot IS NULL OR next_match_slot IN ('entry_a', 'entry_b')",
            name="ck_matches_next_match_slot",
        ),
        Index(
            "uq_matches_round_bracket_position",
            "round_id",
            "bracket_position",
            unique=True,
            postgresql_where=text("round_id IS NOT NULL AND bracket_position IS NOT NULL"),
            sqlite_where=text("round_id IS NOT NULL AND bracket_position IS NOT NULL"),
        ),
        Index(
            "uq_matches_next_match_slot",
            "next_match_id",
            "next_match_slot",
            unique=True,
            postgresql_where=text("next_match_id IS NOT NULL AND next_match_slot IS NOT NULL"),
            sqlite_where=text("next_match_id IS NOT NULL AND next_match_slot IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, index=True)
    category_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("event_categories.id"), nullable=False, index=True)
    entry_a_registration_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("registrations.id"), nullable=False, index=True)
    entry_b_registration_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("registrations.id"), nullable=False, index=True)
    court_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("courts.id"), nullable=False, index=True)
    round_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("tournament_rounds.id", ondelete="SET NULL"), nullable=True, index=True)
    # Stable zero-based position within a configured round. Consecutive pairs
    # feed the same match in the following round.
    bracket_position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    auto_advance: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    # Destination populated when both matches in a pair have winners. These
    # fields make advancement idempotent and auditable.
    next_match_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("matches.id", ondelete="SET NULL"), nullable=True, index=True
    )
    next_match_slot: Mapped[str | None] = mapped_column(String(16), nullable=True)
    round_label: Mapped[str] = mapped_column(String(160), nullable=False)
    scheduled_time: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=30, server_default="30")
    status: Mapped[str] = mapped_column(String(30), nullable=False, server_default="scheduled")
    winner: Mapped[str | None] = mapped_column(String(20), nullable=True)
    winner_by: Mapped[str | None] = mapped_column(String(20), nullable=True)
    result_approved_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    result_approved_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    games_to_win: Mapped[int] = mapped_column(Integer, nullable=False, server_default="2")
    points_per_game: Mapped[int] = mapped_column(Integer, nullable=False, server_default="21")
    # Per-match player selection — only populated for team-category matches.
    # match_type is "singles" or "doubles"; the *_participant_ids arrays hold the
    # registration_participant ids chosen from each team's roster. NULL for
    # singles/doubles categories (behaviour unchanged there).
    match_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    player_a_participant_ids: Mapped[list[str] | None] = mapped_column(JSON_CONFIG, nullable=True)
    player_b_participant_ids: Mapped[list[str] | None] = mapped_column(JSON_CONFIG, nullable=True)
    games: Mapped[list[dict[str, int]]] = mapped_column(JSON_CONFIG, nullable=False, default=list, server_default=text("'[]'"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    event: Mapped[Event] = relationship(back_populates="matches")
    category: Mapped[EventCategory] = relationship(back_populates="matches")
    court: Mapped[Court] = relationship(back_populates="matches")
    round: Mapped["TournamentRound | None"] = relationship(back_populates="matches")
    entry_a_registration: Mapped[Registration] = relationship(foreign_keys=[entry_a_registration_id])
    entry_b_registration: Mapped[Registration] = relationship(foreign_keys=[entry_b_registration_id])
    bouts: Mapped[list["MatchBout"]] = relationship(
        back_populates="match", cascade="all, delete-orphan", order_by="MatchBout.scheduled_time, MatchBout.created_at"
    )


class MatchBout(Base):
    """A single player-vs-player bout inside a team match."""

    __tablename__ = "match_bouts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    match_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, index=True)
    court_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("courts.id", ondelete="SET NULL"), nullable=True
    )
    player_a_reg_participant_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("registration_participants.id", ondelete="SET NULL"), nullable=True
    )
    player_b_reg_participant_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("registration_participants.id", ondelete="SET NULL"), nullable=True
    )
    player_a_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    player_b_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, server_default="scheduled")
    winner: Mapped[str | None] = mapped_column(String(20), nullable=True)
    score_a: Mapped[int | None] = mapped_column(Integer, nullable=True)
    score_b: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scheduled_time: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    match: Mapped[Match] = relationship(back_populates="bouts")
    court: Mapped["Court | None"] = relationship()
    player_a: Mapped["RegistrationParticipant | None"] = relationship(foreign_keys=[player_a_reg_participant_id])
    player_b: Mapped["RegistrationParticipant | None"] = relationship(foreign_keys=[player_b_reg_participant_id])


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
    received_amount_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
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
    __table_args__ = (
        Index("uq_checkins_registration_checkpoint_id", "registration_id", "checkpoint_id", unique=True),
        Index("uq_checkins_legacy_registration_id", "registration_id", unique=True, sqlite_where=text("checkpoint_id IS NULL"), postgresql_where=text("checkpoint_id IS NULL")),
        Index("ix_checkins_checkpoint_id_checked_in_at", "checkpoint_id", "checked_in_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    registration_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("registrations.id", ondelete="CASCADE"), nullable=False, index=False)
    checkpoint_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("event_checkpoints.id", ondelete="CASCADE"), nullable=True, index=True)
    checked_in_by: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    checked_in_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    device_info: Mapped[str | None] = mapped_column(Text, nullable=True)

    registration: Mapped[Registration] = relationship(back_populates="checkins")
    checkpoint: Mapped["EventCheckpoint | None"] = relationship(back_populates="checkins")


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
    """Per-participant timed result for running/cycling events.

    Lifecycle:
      result_set_status = "draft"     → saved but not publicly visible
      result_set_status = "published" → visible on the public results page

    result_status values: Finished | DNS | DNF | DSQ
    finish_time is required only for Finished entries; NULL for DNS/DNF/DSQ.
    rank is computed server-side (lowest finish_time wins); NULL for non-Finished.
    pace_seconds_per_km and speed_kmh_x100 are pre-calculated on save.
    """

    __tablename__ = "race_results"
    __table_args__ = (
        Index("ix_race_results_event_set_status", "event_id", "result_set_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, index=True)
    participant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("participants.id"), nullable=False, index=True)
    # Optional: links to the SportPass registration row for bib number / name lookup
    registration_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("registrations.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    category_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("event_categories.id"), nullable=True, index=True)
    # Finish time (HH:MM:SS stored as timedelta / INTERVAL); NULL for DNS/DNF/DSQ
    finish_time: Mapped[dt.timedelta | None] = mapped_column(Interval, nullable=True)
    # Computed rank within category (1-based, Finished only); NULL for non-Finished
    rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Participant finish status
    result_status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="Finished", default="Finished")
    # Draft = not publicly visible; published = visible on public results page
    result_set_status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="draft", default="draft")
    # Pre-calculated performance metrics (only set for Finished)
    # Running: pace in whole seconds per km (e.g. 360 = 6:00 /km)
    pace_seconds_per_km: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Cycling: average speed in km/h × 100 (e.g. 3500 = 35.00 km/h)
    speed_kmh_x100: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Legacy — kept for backward compatibility, not used in new race results
    laps_completed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now(),
    )

    # Relationships
    participant: Mapped["Participant"] = relationship(foreign_keys=[participant_id])
    registration: Mapped["Registration | None"] = relationship(foreign_keys=[registration_id])
    category: Mapped["EventCategory | None"] = relationship(foreign_keys=[category_id])


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


class OrganizationVerificationSubmission(Base):
    __tablename__ = "organization_verification_submissions"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True)
    organization_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    pan_number: Mapped[str] = mapped_column(String(10), nullable=False)
    name_as_per_pan: Mapped[str] = mapped_column(String(200), nullable=False)
    gst_registered: Mapped[bool] = mapped_column(Boolean, nullable=False)
    gst_number: Mapped[str | None] = mapped_column(String(15), nullable=True)
    billing_name: Mapped[str] = mapped_column(String(200), nullable=False)
    billing_address: Mapped[str] = mapped_column(Text, nullable=False)
    billing_city: Mapped[str] = mapped_column(String(120), nullable=False)
    billing_state: Mapped[str] = mapped_column(String(120), nullable=False)
    billing_pincode: Mapped[str] = mapped_column(String(10), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="UNDER_REVIEW")
    submitted_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    reviewed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    terms_accepted_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    terms_version: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class OrganizationPaymentDestination(Base):
    __tablename__ = "organization_payment_destinations"
    __table_args__ = (Index("ix_payment_destination_org_created", "organization_id", "created_at"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True)
    upi_id: Mapped[str] = mapped_column(String(320), nullable=False)
    payee_name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="UNDER_REVIEW")
    submitted_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    reviewed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class OrganizationVerificationDocument(Base):
    __tablename__ = "organization_verification_documents"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True)
    document_type: Mapped[str] = mapped_column(String(40), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    object_key: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class EventPaymentSettings(Base):
    __tablename__ = "event_payment_settings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, unique=True, index=True)
    payment_destination_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("organization_payment_destinations.id"), nullable=True, index=True)
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
    payment_destination: Mapped[OrganizationPaymentDestination | None] = relationship()


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


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ClerkWebhookEvent(Base):
    __tablename__ = "clerk_webhook_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    occurred_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    processed_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String, nullable=False)
    resource_type: Mapped[str] = mapped_column(String, nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class CommunicationConfig(Base):
    """Centralized configuration for communication channels (email, WhatsApp, SMS, etc.)."""

    __tablename__ = "communication_config"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    channel: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    # JSON configuration specific to each channel
    # For EMAIL: {sender_name, gmail_address, gmail_app_password_encrypted}
    # For WHATSAPP: {api_key, phone_number, template_ids}
    configuration: Mapped[dict] = mapped_column(JSON_CONFIG, nullable=False, default=dict, server_default=text("'{}'"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class RateLimitBucket(Base):
    __tablename__ = "rate_limit_buckets"

    key_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    window_started_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AllocationHistory(Base):
    """Audit trail for allocation number changes."""

    __tablename__ = "allocation_history"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, index=True)
    registration_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("registrations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # NULL for new allocations
    old_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # NULL for deletions
    new_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    changed_by: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    changed_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # Relationships
    event: Mapped[Event] = relationship(back_populates="allocation_history")
    registration: Mapped[Registration] = relationship(back_populates="allocation_history")
    changed_by_user: Mapped[User] = relationship()


# ---------------------------------------------------------------------------
# Refund statuses
# ---------------------------------------------------------------------------
REFUND_STATUS_REQUESTED = "REQUESTED"
REFUND_STATUS_APPROVED = "APPROVED"
REFUND_STATUS_REJECTED = "REJECTED"
REFUND_STATUS_PROCESSING = "PROCESSING"
REFUND_STATUS_REFUND_SENT = "REFUND_SENT"
REFUND_STATUS_REFUNDED = "REFUNDED"
REFUND_STATUS_FAILED = "FAILED"
REFUND_STATUS_CANCELLED = "CANCELLED"
REFUND_TERMINAL_STATUSES = frozenset({
    REFUND_STATUS_REJECTED,
    REFUND_STATUS_REFUNDED,
    REFUND_STATUS_FAILED,
    REFUND_STATUS_CANCELLED,
})
REFUND_ACTIVE_STATUSES = frozenset({
    REFUND_STATUS_REQUESTED,
    REFUND_STATUS_APPROVED,
    REFUND_STATUS_PROCESSING,
    REFUND_STATUS_REFUND_SENT,
})

# Payment providers
PAYMENT_PROVIDER_DIRECT_UPI = "DIRECT_UPI"
PAYMENT_PROVIDER_CASHFREE = "CASHFREE"

# Refund policy types
REFUND_POLICY_FULL = "full_refund"
REFUND_POLICY_PARTIAL = "partial_refund"
REFUND_POLICY_APPROVAL = "organizer_approval"
REFUND_POLICY_NO_REFUND = "no_refund"


class Refund(Base):
    """Tracks the full lifecycle of a refund from REQUESTED to REFUNDED.

    Never deleted — provides an immutable audit trail for all refund actions.
    Direct UPI refunds are processed manually by the organizer; the record
    captures the UTR once they mark the refund sent.
    Cashfree fields are present but unused until that provider is integrated.
    """

    __tablename__ = "refunds"
    __table_args__ = (
        Index("uq_refund_registration_open_or_completed", "registration_id", unique=True,
              postgresql_where=text("registration_id IS NOT NULL AND status IN ('REQUESTED','APPROVED','PROCESSING','REFUND_SENT','REFUNDED')"),
              sqlite_where=text("registration_id IS NOT NULL AND status IN ('REQUESTED','APPROVED','PROCESSING','REFUND_SENT','REFUNDED')")),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # registration_id is NULL for manual (organizer-created) refunds
    registration_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("registrations.id"), nullable=True, index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, index=True)
    # participant_id is NULL for manual refunds (no SportPass account required)
    participant_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("participants.id"), nullable=True, index=True)
    organizer_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True)

    # True for organizer-created refunds not linked to a SportPass registration.
    # These are for in-person / cash / outside-platform payment scenarios.
    # is_manual_refund=True rows are EXCLUDED from event earnings/billing totals.
    is_manual_refund: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false", default=False)

    # For manual refunds: store the participant name/contact as plain text (no account needed)
    manual_participant_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    manual_participant_contact: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Payment method snapshot at the time of request
    payment_method: Mapped[str] = mapped_column(String(50), nullable=False)
    payment_provider: Mapped[str] = mapped_column(String(50), nullable=False)

    # Original amounts frozen from the registration row at request time (paise)
    original_registration_amount: Mapped[int] = mapped_column(Integer, nullable=False)
    original_platform_fee: Mapped[int] = mapped_column(Integer, nullable=False)
    original_total_paid: Mapped[int] = mapped_column(Integer, nullable=False)

    # Refund amounts (paise)
    requested_refund_amount: Mapped[int] = mapped_column(Integer, nullable=False)
    approved_refund_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    platform_fee_refund_amount: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)

    # Text fields
    refund_reason: Mapped[str] = mapped_column(String(120), nullable=False)
    participant_comments: Mapped[str | None] = mapped_column(Text, nullable=True)
    organizer_comments: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Lifecycle status
    status: Mapped[str] = mapped_column(String(30), nullable=False, server_default=REFUND_STATUS_REQUESTED, default=REFUND_STATUS_REQUESTED)

    # Direct UPI fields — organizer fills these when marking refund sent
    refund_utr: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    refund_proof_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)

    # Future provider fields (Cashfree etc.)
    provider_refund_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    provider_refund_status: Mapped[str | None] = mapped_column(String(60), nullable=True)
    provider_refund_response: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    initiated_by: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    initiated_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Timestamps
    requested_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    reviewed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    refunded_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    # Relationships
    registration: Mapped["Registration | None"] = relationship(foreign_keys=[registration_id])
    event: Mapped["Event"] = relationship(foreign_keys=[event_id])
    participant: Mapped["Participant | None"] = relationship(foreign_keys=[participant_id])
    organization: Mapped["Organization"] = relationship(foreign_keys=[organizer_id])
    reviewer: Mapped["User | None"] = relationship(foreign_keys=[reviewed_by])


class OrganizerCreditAccount(Base):
    __tablename__ = "organizer_credit_accounts"
    __table_args__ = (
        UniqueConstraint("organization_id", name="uq_organizer_credit_accounts_organization_id"),
        CheckConstraint("balance_paise >= 0", name="ck_organizer_credit_accounts_nonnegative_balance"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("organizations.id"), nullable=False, unique=True, index=True)
    balance_paise: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class CreditTransaction(Base):
    __tablename__ = "credit_transactions"
    __table_args__ = (
        Index("ix_credit_transactions_organization_created_at", "organization_id", "created_at"),
        UniqueConstraint("source_type", "source_id", name="uq_credit_transactions_source"),
        CheckConstraint("amount_paise > 0", name="ck_credit_transactions_positive_amount"),
        CheckConstraint("balance_before_paise >= 0", name="ck_credit_transactions_nonnegative_before"),
        CheckConstraint("balance_after_paise >= 0", name="ck_credit_transactions_nonnegative_after"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    balance_before_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    balance_after_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    event_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=True, index=True)
    registration_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("registrations.id"), nullable=True, index=True)
    source_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    source_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class CreditTopupRequest(Base):
    __tablename__ = "credit_topup_requests"
    __table_args__ = (
        Index("ix_credit_topup_requests_organization_status", "organization_id", "status"),
        # Keep uniqueness case-insensitive even if a future write path misses
        # the service-level canonicalization.
        Index(
            "uq_credit_topup_requests_utr_reference_ci",
            text("lower(trim(utr_reference))"),
            unique=True,
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    credits_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    payment_method: Mapped[str] = mapped_column(String(30), nullable=False, server_default="UPI")
    utr_reference: Mapped[str] = mapped_column(String(160), nullable=False, unique=True)
    screenshot: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="PENDING")
    requested_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    approved_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class CreditPaymentSettings(Base):
    """Singleton destination used for prepaid Credit top-ups."""
    __tablename__ = "credit_payment_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    method: Mapped[str] = mapped_column(String(30), nullable=False, server_default="UPI")
    upi_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    payee_name: Mapped[str] = mapped_column(String(160), nullable=False, server_default="SportPass India")
    updated_by: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


# Export all models
__all__ = [
    "User",
    "OrganizerApplication",
    "Organization",
    "PricingPlan",
    "FoundingProgram",
    "FoundingProgramOrganization",
    "Event",
    "Court",
    "EventCategory",
    "TournamentRound",
    "BadmintonCategoryScoring",
    "TeamMatchScoring",
    "OrganizerEventBilling",
    "Ticket",
    "Participant",
    "EventCheckpoint",
    "RegistrationParticipant",
    "Registration",
    "Match",
    "MatchBout",
    "Order",
    "OrderItem",
    "Payment",
    "Checkin",
    "EventDocument",
    "DiscountCode",
    "RaceResult",
    "OrganizationMember",
    "OrganizationVerificationSubmission",
    "OrganizationPaymentDestination",
    "OrganizationVerificationDocument",
    "EventPaymentSettings",
    "AuthSession",
    "AuditLog",
    "CommunicationConfig",
    "EmailLog",
    "RateLimitBucket",
    "AllocationHistory",
    "Refund",
    "OrganizerCreditAccount",
    "CreditTransaction",
    "CreditTopupRequest",
    "CreditPaymentSettings",
]


class ProductListing(Base):
    __tablename__ = "product_listings"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("organizations.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    catalog: Mapped[dict] = mapped_column(JSON_CONFIG, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    fee_bearer: Mapped[str] = mapped_column(String(20), nullable=False, default="ORGANIZER")
    upi_id: Mapped[str] = mapped_column(String(320), nullable=False)
    payee_name: Mapped[str] = mapped_column(String(200), nullable=False)
    payment_destination_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("organization_payment_destinations.id"), nullable=True, index=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProductImage(Base):
    __tablename__ = "product_images"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    listing_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("product_listings.id"), nullable=False, index=True)
    reference: Mapped[str | None] = mapped_column(Text, nullable=True)


class ProductOrder(Base):
    __tablename__ = "product_orders"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    listing_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("product_listings.id"), nullable=False, index=True)
    request_key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    access_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    buyer_name: Mapped[str] = mapped_column(String(160), nullable=False)
    buyer_email: Mapped[str] = mapped_column(String(320), nullable=False)
    buyer_phone: Mapped[str] = mapped_column(String(30), nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSON_CONFIG, nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="awaiting_payment")
    payment_reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    archived_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reserved_until: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CheckoutPayment(Base):
    """Shared payment identity; existing domain orders remain authoritative."""
    __tablename__ = "checkout_payments"
    __table_args__ = (
        CheckConstraint("(product_order_id IS NULL) <> (event_order_id IS NULL)", name="ck_checkout_one_owner"),
        CheckConstraint("amount_paise >= 0 AND fee_paise >= 0 AND fee_paise <= amount_paise", name="ck_checkout_amounts"),
        CheckConstraint("mode IN ('DIRECT_UPI', 'MANUAL_OFFLINE', 'CASHFREE_PLATFORM', 'CASHFREE_SPLIT')", name="ck_checkout_mode"),
        UniqueConstraint("provider_account", "provider_environment", "provider_order_id", name="uq_checkout_provider_order"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_order_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("product_orders.id"), unique=True)
    event_order_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("orders.id"), unique=True)
    mode: Mapped[str] = mapped_column(String(32), nullable=False)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    fee_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    fee_funding: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="awaiting")
    settlement_status: Mapped[str] = mapped_column(String(32), nullable=False, default="not_applicable")
    vendor_id: Mapped[str | None] = mapped_column(String(120))
    provider_account: Mapped[str | None] = mapped_column(String(120))
    provider_environment: Mapped[str | None] = mapped_column(String(16))
    provider_order_id: Mapped[str | None] = mapped_column(String(120))
    request_fingerprint: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CheckoutReceipt(Base):
    """Immutable success evidence and its disposition; not a browser input."""
    __tablename__ = "checkout_receipts"
    __table_args__ = (UniqueConstraint("provider", "account", "environment", "payment_id", name="uq_checkout_receipt"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    checkout_payment_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("checkout_payments.id"), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    account: Mapped[str] = mapped_column(String(120), nullable=False)
    environment: Mapped[str] = mapped_column(String(16), nullable=False)
    payment_id: Mapped[str] = mapped_column(String(120), nullable=False)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    disposition: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CashfreePaymentResolution(Base):
    """One immutable admin decision per paid, unfulfilled checkout."""
    __tablename__ = "cashfree_payment_resolutions"
    __table_args__ = (
        CheckConstraint("action IN ('FULFILL','REFUND')", name="ck_cashfree_resolution_action"),
        CheckConstraint("status IN ('FULFILLED','PENDING','REFUNDED','NEEDS_REVIEW')", name="ck_cashfree_resolution_status"),
        CheckConstraint("amount_paise > 0", name="ck_cashfree_resolution_amount"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    checkout_payment_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("checkout_payments.id"), nullable=False, unique=True)
    receipt_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("checkout_receipts.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(1000), nullable=False)
    initiated_by: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False)
    provider_refund_id: Mapped[str | None] = mapped_column(String(120), unique=True)
    provider_status: Mapped[str | None] = mapped_column(String(32))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    completed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class ManagedRegistrationCollection(Base):
    """Frozen allocation of a verified production receipt to one registration."""
    __tablename__ = "managed_registration_collections"
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    registration_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("registrations.id"), nullable=False, unique=True)
    receipt_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("checkout_receipts.id"), nullable=False)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False, index=True)
    organizer_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("organizations.id"), nullable=False)
    registration_amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    platform_fee_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    total_paid_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    organizer_payable_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    participant_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (CheckConstraint("registration_amount_paise >= 0 AND platform_fee_paise >= 0 AND total_paid_paise >= 0 AND organizer_payable_paise = total_paid_paise - platform_fee_paise AND organizer_payable_paise >= 0", name="ck_managed_collection_amounts"),)


class OrganizerSettlement(Base):
    """An auditable transfer from SportPass to an event organizer."""
    __tablename__ = "organizer_settlements"
    __table_args__ = (
        UniqueConstraint("reference_number", name="uq_manual_settlement_reference"),
        CheckConstraint("amount_paise >= 100", name="ck_settlement_minimum"),
        CheckConstraint("status <> 'PAID' OR (reference_number IS NOT NULL AND length(trim(reference_number)) > 0)", name="ck_paid_reference"),
        CheckConstraint("amount_paise > 0", name="ck_organizer_settlement_positive_amount"),
        CheckConstraint("method IN ('BANK_TRANSFER', 'UPI', 'OTHER')", name="ck_organizer_settlement_method"),
        CheckConstraint("status IN ('PENDING', 'PAID', 'FAILED', 'CANCELLED')", name="ck_organizer_settlement_status"),
        UniqueConstraint("event_id", "idempotency_key", name="uq_organizer_settlement_event_idempotency"),
        Index("ix_organizer_settlements_event_status", "event_id", "status"),
        Index("ix_organizer_settlements_organizer_event", "organizer_id", "event_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organizer_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("organizations.id"), nullable=False)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    method: Mapped[str] = mapped_column(String(24), nullable=False)
    reference_number: Mapped[str | None] = mapped_column(String(160), nullable=True)
    settlement_date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="PENDING")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(120), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    provider: Mapped[str] = mapped_column(String(32), nullable=False, server_default="MANUAL")
    provider_transfer_id: Mapped[str | None] = mapped_column(String(160), nullable=True)
    provider_status: Mapped[str | None] = mapped_column(String(60), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class OrganizerPayableAdjustment(Base):
    """Append-only admin correction to an organizer's payable position."""
    __tablename__ = "organizer_payable_adjustments"
    __table_args__ = (
        UniqueConstraint("event_id", "idempotency_key", name="uq_adjustment_request"),
        CheckConstraint("(kind = 'PAYABLE' AND settlement_id IS NULL) OR (kind = 'SETTLEMENT_REVERSAL' AND settlement_id IS NOT NULL AND amount_paise > 0)", name="ck_adjustment_kind"),
        CheckConstraint("amount_paise <> 0", name="ck_organizer_adjustment_nonzero"),
        Index("ix_organizer_adjustments_event", "event_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organizer_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("organizations.id"), nullable=False)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("events.id"), nullable=False)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(120), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    settlement_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("organizer_settlements.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="PAYABLE", server_default="PAYABLE")
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
