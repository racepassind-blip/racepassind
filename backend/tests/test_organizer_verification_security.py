import datetime as dt

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from db import Base
from models import Event, EventPaymentSettings, Organization, OrganizationPaymentDestination, ProductListing
from app.api.v1.organizer import PaidVerificationIn
from app.services.organizer_payment_security import (
    assert_paid_event_available,
    assert_product_sales_available,
    submit_destination,
)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    Base.metadata.drop_all(engine)


def configured_event(db: Session):
    organization = Organization(
        name="Secure Club", status="active", paid_verification_status="VERIFIED",
        allow_direct_upi=True,
    )
    db.add(organization)
    db.flush()
    destination = OrganizationPaymentDestination(
        organization_id=organization.id, upi_id="secure@upi",
        payee_name="Secure Club", status="APPROVED",
    )
    db.add(destination)
    db.flush()
    event = Event(
        organization_id=organization.id, name="Secure Race", description="Race",
        category="running", location_name="Mysuru", country="India", max_participants=50,
        status="published", registration_status="open", payment_collection_method="DIRECT_UPI",
        start_date=dt.datetime(2027, 1, 1, tzinfo=dt.timezone.utc), distance="5 km", rules=[],
    )
    db.add(event)
    db.flush()
    event.payment_settings = EventPaymentSettings(
        event_id=event.id, method="manual_upi", upi_id="secure@upi",
        payee_name="Secure Club", is_active=True, payment_destination_id=destination.id,
    )
    db.commit()
    return organization, event, destination


def test_paid_event_accepts_only_fully_approved_configuration(db):
    _, event, destination = configured_event(db)
    assert assert_paid_event_available(db, event).id == destination.id


@pytest.mark.parametrize("change", [
    ("allow_direct_upi", False),
    ("paid_verification_status", "SUSPENDED"),
    ("status", "inactive"),
])
def test_organization_security_changes_block_new_paid_registration(db, change):
    organization, event, _ = configured_event(db)
    setattr(organization, change[0], change[1])
    db.commit()
    with pytest.raises(ValueError, match="Paid registrations are currently unavailable"):
        assert_paid_event_available(db, event)


@pytest.mark.parametrize("field,value", [
    ("status", "draft"),
    ("registration_status", "closed"),
    ("payment_collection_method", "PAYMENT_GATEWAY"),
])
def test_event_security_changes_block_new_direct_upi_registration(db, field, value):
    _, event, _ = configured_event(db)
    setattr(event, field, value)
    db.commit()
    with pytest.raises(ValueError, match="Paid registrations are currently unavailable"):
        assert_paid_event_available(db, event)


def test_destination_revocation_blocks_new_registration(db):
    _, event, destination = configured_event(db)
    destination.status = "REJECTED"
    db.commit()
    with pytest.raises(ValueError, match="Paid registrations are currently unavailable"):
        assert_paid_event_available(db, event)


@pytest.mark.parametrize("upi,payee", [("changed@upi", "Secure Club"), ("secure@upi", "New Payee")])
def test_changing_payment_identity_creates_under_review_history(db, upi, payee):
    organization, _, approved = configured_event(db)
    replacement = submit_destination(
        db, organization_id=organization.id, upi_id=upi, payee_name=payee,
        actor_user_id=None,
    )
    db.commit()
    assert replacement.status == "UNDER_REVIEW"
    assert db.get(OrganizationPaymentDestination, approved.id).status == "APPROVED"
    assert len(db.scalars(select(OrganizationPaymentDestination)).all()) == 2


def test_merchandise_uses_same_approved_destination_gate(db):
    organization, _, destination = configured_event(db)
    listing = ProductListing(
        organization_id=organization.id, name="Store", description="", catalog={"products": []},
        status="published", upi_id=destination.upi_id, payee_name=destination.payee_name,
        payment_destination_id=destination.id,
    )
    db.add(listing)
    db.commit()
    assert assert_product_sales_available(db, listing).id == destination.id
    destination.status = "UNDER_REVIEW"
    db.commit()
    with pytest.raises(ValueError, match="Purchases are temporarily unavailable"):
        assert_product_sales_available(db, listing)


@pytest.mark.parametrize("pan", ["ABCD1234EF", "ABCDE12345", "ABCDE123F"])
def test_invalid_pan_is_rejected_by_backend(pan):
    with pytest.raises(ValidationError):
        PaidVerificationIn(pan_number=pan, name_as_per_pan="Secure Club", gst_registered=False,
            billing_name="Secure Club", billing_address="Address", billing_city="Mysuru",
            billing_state="Karnataka", billing_pincode="570001", accept_terms=True)


def test_pan_is_normalized_and_validated_by_backend():
    payload = PaidVerificationIn(pan_number="abcde1234f", name_as_per_pan="Secure Club", gst_registered=False,
        billing_name="Secure Club", billing_address="Address", billing_city="Mysuru",
        billing_state="Karnataka", billing_pincode="570001", accept_terms=True)
    assert payload.pan_number == "ABCDE1234F"


@pytest.mark.parametrize("gst", ["27ABCDE1234F1X5", "27ABCDE1234F1Z", "INVALIDGSTIN123"])
def test_invalid_gstin_is_rejected_by_backend(gst):
    with pytest.raises(ValidationError):
        PaidVerificationIn(pan_number="ABCDE1234F", name_as_per_pan="Secure Club", gst_registered=True,
            gst_number=gst, billing_name="Secure Club", billing_address="Address", billing_city="Mysuru",
            billing_state="Karnataka", billing_pincode="570001", accept_terms=True)
