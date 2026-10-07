from __future__ import annotations

from sqlalchemy import select

from app.services.audit_service import record_audit
from app.services.auth_service import utc_now
from app.services.payment_service import normalize_upi_id
from models import Event, Organization, OrganizationPaymentDestination

USABLE_DESTINATION_STATUSES = {"APPROVED", "LEGACY_APPROVED"}
PUBLIC_UNAVAILABLE_MESSAGE = "Paid registrations are currently unavailable for this event."


def normalized_payee_name(value: str) -> str:
    value = value.strip()
    if len(value) < 2 or len(value) > 200:
        raise ValueError("Enter a valid payee name")
    return value


def destination_for_values(db, *, organization_id, upi_id: str, payee_name: str):
    upi_id = normalize_upi_id(upi_id)
    payee_name = normalized_payee_name(payee_name)
    return db.scalar(select(OrganizationPaymentDestination).where(
        OrganizationPaymentDestination.organization_id == organization_id,
        OrganizationPaymentDestination.upi_id == upi_id,
        OrganizationPaymentDestination.payee_name == payee_name,
    ).order_by(OrganizationPaymentDestination.created_at.desc()).limit(1))


def submit_destination(db, *, organization_id, upi_id: str, payee_name: str, actor_user_id, event_id=None):
    # Serialize destination changes with admin permission/review operations for
    # this organization. This prevents an approved row from being silently
    # replaced during a concurrent review transaction.
    organization = db.scalar(select(Organization).where(Organization.id == organization_id).with_for_update())
    if organization is None:
        raise ValueError("Organization not found")
    upi_id = normalize_upi_id(upi_id)
    payee_name = normalized_payee_name(payee_name)
    existing = destination_for_values(db, organization_id=organization_id, upi_id=upi_id, payee_name=payee_name)
    if existing and existing.status in {"UNDER_REVIEW", "APPROVED", "LEGACY_APPROVED"}:
        return existing
    destination = OrganizationPaymentDestination(
        organization_id=organization_id, upi_id=upi_id, payee_name=payee_name,
        status="UNDER_REVIEW", submitted_at=utc_now(),
    )
    db.add(destination)
    db.flush()
    record_audit(db, actor_user_id=actor_user_id, action="payment_destination_submitted",
        resource_type="organization_payment_destination", resource_id=destination.id,
        metadata={"organization_id": str(organization_id), "event_id": str(event_id) if event_id else None, "status": destination.status})
    return destination


def assert_paid_event_available(db, event: Event) -> OrganizationPaymentDestination | None:
    organization = db.scalar(select(Organization).where(Organization.id == event.organization_id).with_for_update())
    settings = event.payment_settings
    if (organization is None or organization.status != "active" or
        organization.paid_verification_status != "VERIFIED" or
        event.status != "published" or event.archived_at is not None or event.registration_status != "open" or
        event.payment_collection_method not in {"DIRECT_UPI", "CASHFREE_MANAGED"}):
        raise ValueError(PUBLIC_UNAVAILABLE_MESSAGE)
    if event.payment_collection_method == "CASHFREE_MANAGED":
        return None
    if (not organization.allow_direct_upi or settings is None or not settings.is_active or
            settings.method != "manual_upi" or settings.payment_destination_id is None):
        raise ValueError(PUBLIC_UNAVAILABLE_MESSAGE)
    destination = db.scalar(select(OrganizationPaymentDestination).where(
        OrganizationPaymentDestination.id == settings.payment_destination_id,
        OrganizationPaymentDestination.organization_id == organization.id,
    ).with_for_update())
    if (destination is None or destination.status not in USABLE_DESTINATION_STATUSES or
        destination.upi_id != settings.upi_id or destination.payee_name != settings.payee_name):
        raise ValueError(PUBLIC_UNAVAILABLE_MESSAGE)
    return destination


def assert_product_sales_available(db, listing) -> OrganizationPaymentDestination:
    organization = db.scalar(select(Organization).where(Organization.id == listing.organization_id).with_for_update())
    if (organization is None or organization.status != "active" or
        organization.paid_verification_status != "VERIFIED" or not organization.allow_direct_upi or
        listing.status != "published" or listing.payment_destination_id is None):
        raise ValueError("Purchases are temporarily unavailable for this store.")
    destination = db.scalar(select(OrganizationPaymentDestination).where(
        OrganizationPaymentDestination.id == listing.payment_destination_id,
        OrganizationPaymentDestination.organization_id == organization.id,
    ).with_for_update())
    if (destination is None or destination.status not in USABLE_DESTINATION_STATUSES or
        destination.upi_id != listing.upi_id or destination.payee_name != listing.payee_name):
        raise ValueError("Purchases are temporarily unavailable for this store.")
    return destination
