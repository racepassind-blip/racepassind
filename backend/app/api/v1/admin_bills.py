"""Admin-only bills. Issuing or recording payment never mutates Credits."""
import datetime as dt
import hashlib
import json
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StringConstraints, model_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_csrf, require_roles
from app.services.audit_service import record_audit
from db import get_db
from models import AdminBill, Event, Organization, User

router = APIRouter()
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class BillLine(BaseModel):
    description: ShortText
    quantity: StrictInt = Field(ge=1, le=1000000)
    unit_paise: StrictInt = Field(ge=0, le=100000000)


class BillIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    organization_id: UUID
    event_id: UUID | None = None
    kind: Literal["CREDITS", "EVENT", "CUSTOM"]
    idempotency_key: UUID
    issuer_name: ShortText = "SportPass India"
    issuer_email: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$", max_length=200)]
    issuer_phone: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\+?[0-9 ()-]{7,25}$")]
    issuer_address: Text
    customer_name: ShortText
    customer_address: Text
    issue_date: dt.date
    due_date: dt.date | None = None
    lines: list[BillLine] = Field(min_length=1, max_length=20)
    discount_paise: StrictInt = Field(default=0, ge=0, le=100000000)
    notes: str = Field(default="", max_length=2000)
    status: Literal["PENDING", "PAID"]
    payment_reference: ShortText | None = None
    paid_on: dt.date | None = None

    @model_validator(mode="after")
    def validate_bill(self):
        subtotal = sum(line.quantity * line.unit_paise for line in self.lines)
        if subtotal > 100000000 or self.discount_paise > subtotal:
            raise ValueError("Check the amounts: discount cannot exceed subtotal; maximum bill is ₹10,00,000.")
        if self.kind == "EVENT" and not self.event_id:
            raise ValueError("Select an event for an event bill.")
        if self.kind != "EVENT" and self.event_id:
            raise ValueError("Only event bills may include an event.")
        today = dt.datetime.now(ZoneInfo("Asia/Kolkata")).date()
        if self.issue_date > today:
            raise ValueError("Issue date cannot be in the future.")
        if self.due_date and self.due_date < self.issue_date:
            raise ValueError("Due date cannot be before issue date.")
        if self.status == "PAID" and (not self.payment_reference or not self.paid_on):
            raise ValueError("Enter the payment date and reference for a paid bill.")
        if self.status == "PENDING" and (self.payment_reference or self.paid_on):
            raise ValueError("Pending bills cannot include a received payment.")
        if self.paid_on and self.paid_on > today:
            raise ValueError("Payment date cannot be in the future.")
        return self


class BillUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["PAID", "CANCELLED"]
    payment_reference: ShortText | None = None
    paid_on: dt.date | None = None
    reason: Text | None = None


def serialize(bill):
    return {"id": bill.id, "number": f"SPI-{bill.details['issue_date'][:4]}-{bill.id:06d}",
            "organizationId": str(bill.organization_id), "details": bill.details,
            "totalPaise": bill.total_paise, "status": bill.status,
            "paymentReference": bill.payment_reference, "paidOn": bill.paid_on,
            "cancellationReason": bill.cancellation_reason}


@router.get("/bills")
def list_bills(organization_id: UUID | None = None, page: int = Query(1, ge=1),
               _: User = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    query = select(AdminBill)
    if organization_id:
        query = query.where(AdminBill.organization_id == organization_id)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(query.order_by(AdminBill.id.desc()).offset((page - 1) * 20).limit(20)).all()
    return {"items": [serialize(row) for row in rows], "total": total}


@router.get("/bills/customer/{organization_id}")
def bill_customer(organization_id: UUID, _: User = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    org = db.get(Organization, organization_id)
    if not org:
        raise HTTPException(404, "Organization not found.")
    events = db.scalars(select(Event).where(Event.organization_id == organization_id).order_by(Event.created_at.desc())).all()
    latest = db.scalar(select(AdminBill).order_by(AdminBill.id.desc()).limit(1))
    issuer = {key: value for key, value in latest.details.items() if key.startswith("issuer_")} if latest else {}
    return {"name": org.billing_name or org.name,
            "address": ", ".join(filter(None, [org.billing_address, org.billing_city, org.billing_state, org.billing_pincode])),
            "events": [{"id": str(e.id), "name": e.name} for e in events], "issuer": issuer}


@router.post("/bills", status_code=201)
def issue_bill(payload: BillIn, admin: User = Depends(require_roles("admin")),
               _: None = Depends(require_csrf), db: Session = Depends(get_db)):
    body = payload.model_dump(mode="json")
    fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
    def existing_result(row):
        if row.fingerprint != fingerprint:
            raise HTTPException(409, "This request already issued a different bill. Refresh before issuing another.")
        return serialize(row)
    existing = db.scalar(select(AdminBill).where(AdminBill.idempotency_key == payload.idempotency_key))
    if existing:
        return existing_result(existing)
    if not db.get(Organization, payload.organization_id):
        raise HTTPException(404, "Organization not found.")
    event = db.get(Event, payload.event_id) if payload.event_id else None
    if payload.event_id and (not event or event.organization_id != payload.organization_id):
        raise HTTPException(422, "Select an event belonging to this organizer.")
    details = {key: value for key, value in body.items() if key not in {"idempotency_key", "status", "payment_reference", "paid_on"}}
    details["event_name"] = event.name if event else None
    details["tax_note"] = "GST not charged."
    bill = AdminBill(organization_id=payload.organization_id, event_id=payload.event_id,
        idempotency_key=payload.idempotency_key, fingerprint=fingerprint, details=details,
        total_paise=sum(line.quantity * line.unit_paise for line in payload.lines) - payload.discount_paise,
        status=payload.status, payment_reference=payload.payment_reference, paid_on=payload.paid_on,
        created_by=admin.id)
    try:
        db.add(bill)
        db.flush()
        record_audit(db, actor_user_id=admin.id, action="bill_issued", resource_type="admin_bill", resource_id=bill.id,
                     metadata={"status": bill.status, "totalPaise": bill.total_paise})
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(AdminBill).where(AdminBill.idempotency_key == payload.idempotency_key))
        if existing:
            return existing_result(existing)
        raise
    return serialize(bill)


@router.patch("/bills/{bill_id}")
def update_bill(bill_id: int, payload: BillUpdate, admin: User = Depends(require_roles("admin")),
                _: None = Depends(require_csrf), db: Session = Depends(get_db)):
    bill = db.scalar(select(AdminBill).where(AdminBill.id == bill_id).with_for_update())
    if not bill:
        raise HTTPException(404, "Bill not found.")
    if bill.status != "PENDING":
        if bill.status == payload.status and (payload.status == "PAID" and bill.payment_reference == payload.payment_reference and bill.paid_on == payload.paid_on or payload.status == "CANCELLED" and bill.cancellation_reason == payload.reason):
            return serialize(bill)
        raise HTTPException(409, "Only pending bills can be marked paid or cancelled.")
    if payload.status == "PAID":
        if not payload.payment_reference or not payload.paid_on or payload.paid_on > dt.datetime.now(ZoneInfo("Asia/Kolkata")).date():
            raise HTTPException(422, "Enter a payment reference and a valid payment date.")
        bill.payment_reference, bill.paid_on = payload.payment_reference, payload.paid_on
    else:
        if not payload.reason:
            raise HTTPException(422, "Enter a cancellation reason.")
        bill.cancellation_reason = payload.reason
    bill.status = payload.status
    record_audit(db, actor_user_id=admin.id, action="bill_" + payload.status.lower(), resource_type="admin_bill", resource_id=bill.id,
                 metadata={"reason": payload.reason})
    db.commit()
    return serialize(bill)
