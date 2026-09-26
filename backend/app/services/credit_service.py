"""Prepaid SportPass Credits ledger.

Credits are deliberately independent of registrations and participant payments.
All amounts are integer paise and every balance mutation writes one ledger row.
"""
from __future__ import annotations

from decimal import Decimal
from urllib.parse import quote, urlencode
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.services.payment_service import generate_qr_data_url, normalize_upi_id
from models import CreditPaymentSettings, CreditTopupRequest, CreditTransaction, Event, Organization, Payment, Registration, OrganizerCreditAccount

CREDIT_TOPUP = "TOPUP"
CREDIT_REGISTRATION_DEBIT = "REGISTRATION_DEBIT"
CREDIT_MANUAL_EVENT_DEBIT = "MANUAL_EVENT_DEBIT"
CREDIT_DISCOUNT = "DISCOUNT_CREDIT"
CREDIT_ADMIN_ADJUSTMENT = "ADMIN_ADJUSTMENT"
CREDIT_TRANSACTION_TYPES = frozenset({CREDIT_TOPUP, CREDIT_REGISTRATION_DEBIT, CREDIT_MANUAL_EVENT_DEBIT, CREDIT_DISCOUNT, CREDIT_ADMIN_ADJUSTMENT})
_DEBIT_TYPES = frozenset({CREDIT_REGISTRATION_DEBIT, CREDIT_MANUAL_EVENT_DEBIT})
CREDIT_CHARGEABLE_PAYMENT_GATEWAYS = frozenset({"manual_upi", "DIRECT_UPI", "manual_offline"})


class CreditValidationError(ValueError):
    pass


def _paise(value: int | Decimal) -> int:
    if isinstance(value, bool):
        raise CreditValidationError("Credit amount must be a non-negative integer number of paise")
    if isinstance(value, Decimal):
        if value != value.to_integral_value():
            raise CreditValidationError("Credit amount must be expressed in whole paise")
        amount = int(value)
    elif isinstance(value, int):
        amount = value
    else:
        raise CreditValidationError("Credit amount must be an integer or Decimal")
    if amount <= 0:
        raise CreditValidationError("Credit amount must be greater than zero")
    return amount


def _account(db: Session, organization_id: UUID, *, create: bool) -> OrganizerCreditAccount | None:
    account = db.scalar(select(OrganizerCreditAccount).where(OrganizerCreditAccount.organization_id == organization_id).with_for_update())
    if account is None and create:
        candidate = OrganizerCreditAccount(organization_id=organization_id, balance_paise=0)
        try:
            # A savepoint lets a concurrent first-use insert lose the unique-key
            # race without invalidating the caller's outer transaction.
            with db.begin_nested():
                db.add(candidate)
                db.flush()
            account = candidate
        except IntegrityError:
            account = db.scalar(select(OrganizerCreditAccount).where(OrganizerCreditAccount.organization_id == organization_id).with_for_update())
            if account is None:
                raise
    return account


def get_balance(db: Session, organization_id: UUID) -> int:
    account = _account(db, organization_id, create=True)
    db.flush()
    return account.balance_paise  # type: ignore[union-attr]


def _mutate(db: Session, *, organization_id: UUID, amount: int | Decimal, transaction_type: str, description: str, reason: str | None, event_id: UUID | None, registration_id: UUID | None, source_type: str | None, source_id: str | None, created_by: UUID | None, debit: bool) -> CreditTransaction:
    if transaction_type not in CREDIT_TRANSACTION_TYPES:
        raise CreditValidationError("Unknown credit transaction type")
    value = _paise(amount)
    account = _account(db, organization_id, create=True)
    # Serialize source-id checks behind the account lock. Without this second
    # ordering guarantee, concurrent retries can both miss the ledger row and
    # one fails with a database uniqueness error instead of being idempotent.
    if source_type and source_id:
        existing = db.scalar(select(CreditTransaction).where(CreditTransaction.source_type == source_type, CreditTransaction.source_id == source_id))
        if existing is not None:
            if existing.organization_id != organization_id or existing.type != transaction_type or existing.amount_paise != value or existing.event_id != event_id or existing.registration_id != registration_id:
                raise CreditValidationError("Credit transaction source conflicts with an existing ledger entry")
            return existing
    before = account.balance_paise  # type: ignore[union-attr]
    after = before - value if debit else before + value
    if after < 0:
        raise CreditValidationError("Insufficient SportPass Credits")
    account.balance_paise = after  # type: ignore[union-attr]
    transaction = CreditTransaction(organization_id=organization_id, type=transaction_type, amount_paise=value, balance_before_paise=before, balance_after_paise=after, event_id=event_id, registration_id=registration_id, source_type=source_type, source_id=source_id, description=description, reason=reason, created_by=created_by)
    db.add(transaction)
    db.flush()
    return transaction


def add_credits(db: Session, *, organization_id: UUID, amount: int | Decimal, transaction_type: str = CREDIT_TOPUP, description: str, reason: str | None = None, event_id: UUID | None = None, registration_id: UUID | None = None, source_type: str | None = None, source_id: str | None = None, created_by: UUID | None = None) -> CreditTransaction:
    if transaction_type in _DEBIT_TYPES:
        raise CreditValidationError("Debit transaction types must use debit_credits")
    return _mutate(db, organization_id=organization_id, amount=amount, transaction_type=transaction_type, description=description, reason=reason, event_id=event_id, registration_id=registration_id, source_type=source_type, source_id=source_id, created_by=created_by, debit=False)


def debit_credits(db: Session, *, organization_id: UUID, amount: int | Decimal, transaction_type: str, description: str, reason: str | None = None, event_id: UUID | None = None, registration_id: UUID | None = None, source_type: str | None = None, source_id: str | None = None, created_by: UUID | None = None) -> CreditTransaction:
    if transaction_type not in _DEBIT_TYPES:
        raise CreditValidationError("debit_credits requires a debit transaction type")
    return _mutate(db, organization_id=organization_id, amount=amount, transaction_type=transaction_type, description=description, reason=reason, event_id=event_id, registration_id=registration_id, source_type=source_type, source_id=source_id, created_by=created_by, debit=True)


def get_credit_payment_settings(db: Session, *, amount_paise: int | None = None, organizer_name: str | None = None) -> dict:
    settings = db.get(CreditPaymentSettings, 1)
    if settings is None:
        return {"method": "UPI", "upiId": None, "payeeName": "SportPass India", "qrDataUrl": None, "configured": False}
    qr_data_url = None
    if settings.method == "UPI" and settings.upi_id:
        upi_id = normalize_upi_id(settings.upi_id)
        params = {"pa": upi_id, "pn": settings.payee_name, "cu": "INR"}
        if amount_paise and amount_paise > 0:
            params["am"] = f"{Decimal(amount_paise) / Decimal(100):.2f}"
        if organizer_name:
            params["tn"] = f"SportPass Credits - {organizer_name[:80]}"
        uri = "upi://pay?" + urlencode(params, quote_via=quote)
        qr_data_url = generate_qr_data_url(uri)
    return {"method": settings.method, "upiId": settings.upi_id, "payeeName": settings.payee_name, "qrDataUrl": qr_data_url, "configured": bool(settings.method == "UPI" and settings.upi_id)}


def update_credit_payment_settings(db: Session, *, method: str, upi_id: str | None, payee_name: str, updated_by: UUID) -> dict:
    if method != "UPI":
        raise CreditValidationError("Only UPI top-ups are enabled currently")
    normalized_upi = normalize_upi_id(upi_id or "")
    normalized_payee = payee_name.strip()
    if not normalized_payee or len(normalized_payee) > 160:
        raise CreditValidationError("Payee name is required")
    settings = db.get(CreditPaymentSettings, 1)
    if settings is None:
        settings = CreditPaymentSettings(id=1)
        db.add(settings)
    settings.method = method
    settings.upi_id = normalized_upi
    settings.payee_name = normalized_payee
    settings.updated_by = updated_by
    db.commit()
    return get_credit_payment_settings(db)


def request_topup(db: Session, *, organization_id: UUID, amount_paise: int | Decimal, utr_reference: str, screenshot: str | None = None, payment_method: str = "UPI") -> CreditTopupRequest:
    amount = _paise(amount_paise)
    if payment_method != "UPI":
        raise CreditValidationError("Only UPI top-ups are enabled currently")
    # UTRs are identifiers, not display text. Canonicalize case and outer
    # whitespace before checking or storing so retries cannot create aliases.
    utr = utr_reference.strip().upper()
    if not utr:
        raise CreditValidationError("UTR reference is required")
    existing = db.scalar(
        select(CreditTopupRequest).where(func.lower(func.trim(CreditTopupRequest.utr_reference)) == utr.lower())
    )
    if existing is not None:
        raise CreditValidationError("This UTR reference has already been submitted")
    request = CreditTopupRequest(organization_id=organization_id, amount_paise=amount, credits_paise=amount, payment_method=payment_method, utr_reference=utr, screenshot=screenshot, status="PENDING")
    try:
        # Keep a duplicate race from rolling back unrelated work in the
        # caller's transaction.
        with db.begin_nested():
            db.add(request)
            db.flush()
    except IntegrityError as exc:
        # A concurrent request may pass the read above. Convert the unique
        # constraint race into the same safe, user-facing validation error.
        existing = db.scalar(
            select(CreditTopupRequest).where(func.lower(func.trim(CreditTopupRequest.utr_reference)) == utr.lower())
        )
        if existing is not None:
            raise CreditValidationError("This UTR reference has already been submitted") from exc
        raise
    return request


def approve_topup(db: Session, *, request_id: UUID, approved_by: UUID) -> CreditTopupRequest:
    request = db.scalar(select(CreditTopupRequest).where(CreditTopupRequest.id == request_id).with_for_update())
    if request is None:
        raise CreditValidationError("Top-up request not found")
    if request.status != "PENDING":
        raise CreditValidationError("Top-up request has already been decided")
    add_credits(db, organization_id=request.organization_id, amount=request.credits_paise, transaction_type=CREDIT_TOPUP, description="Approved UPI credit top-up", reason="UPI top-up approved", source_type="credit_topup_request", source_id=str(request.id), created_by=approved_by)
    request.status = "APPROVED"
    request.approved_at = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
    request.approved_by = approved_by
    db.flush()
    return request


def reject_topup(db: Session, *, request_id: UUID, rejection_reason: str) -> CreditTopupRequest:
    request = db.scalar(select(CreditTopupRequest).where(CreditTopupRequest.id == request_id).with_for_update())
    if request is None:
        raise CreditValidationError("Top-up request not found")
    if request.status != "PENDING":
        raise CreditValidationError("Top-up request has already been decided")
    reason = rejection_reason.strip()
    if not reason:
        raise CreditValidationError("Rejection reason is required")
    request.status = "REJECTED"
    request.rejection_reason = reason
    db.flush()
    return request


def event_settlement_summary(db: Session, *, event_id: UUID) -> dict:
    """Return Credit settlement totals for Direct UPI/manual payments only."""
    event = db.scalar(select(Event).where(Event.id == event_id))
    if event is None:
        raise CreditValidationError("Event not found")
    rows = db.execute(
        select(Registration, Payment)
        .join(Payment, Payment.registration_id == Registration.id)
        .where(
            Registration.event_id == event_id,
            Registration.status.in_(("confirmed", "checked_in")),
            Registration.payment_status.in_(("approved", "not_required")),
            Payment.payment_gateway.in_(CREDIT_CHARGEABLE_PAYMENT_GATEWAYS),
        )
    ).all()
    balance = db.scalar(select(OrganizerCreditAccount.balance_paise).where(OrganizerCreditAccount.organization_id == event.organization_id)) or 0
    required = sum(registration.platform_fee_paise or 0 for registration, _ in rows)
    return {
        "eventId": str(event.id),
        "organizationId": event.organization_id,
        "confirmedParticipantCount": sum(registration.participant_count or registration.quantity for registration, _ in rows),
        "requiredPaise": required,
        "availablePaise": balance,
        "afterPaise": balance - required,
    }


def settle_event_credits(db: Session, *, event_id: UUID, created_by: UUID) -> CreditTransaction:
    event = db.scalar(select(Event).where(Event.id == event_id).with_for_update())
    if event is None:
        raise CreditValidationError("Event not found")
    organization = db.scalar(select(Organization).where(Organization.id == event.organization_id).with_for_update())
    if organization is None or organization.credit_deduction_mode != "MANUAL_EVENT_SETTLEMENT":
        raise CreditValidationError("Event organization is not configured for manual settlement")
    required = event_settlement_summary(db, event_id=event_id)["requiredPaise"]
    if required <= 0:
        raise CreditValidationError("No SportPass Credits are required for this event")
    return debit_credits(db, organization_id=event.organization_id, amount=required, transaction_type=CREDIT_MANUAL_EVENT_DEBIT, description="Manual post-event SportPass settlement", reason="Admin event settlement", event_id=event_id, source_type="EVENT", source_id=str(event_id), created_by=created_by)


def credit_event_discount(db: Session, *, event_id: UUID, amount_paise: int | Decimal, reason: str, created_by: UUID, source_id: str | None = None) -> CreditTransaction:
    event = db.scalar(select(Event).where(Event.id == event_id))
    if event is None:
        raise CreditValidationError("Event not found")
    if not reason.strip():
        raise CreditValidationError("Discount reason is required")
    amount = _paise(amount_paise)
    charged = db.scalar(select(func.coalesce(func.sum(CreditTransaction.amount_paise), 0)).where(CreditTransaction.organization_id == event.organization_id, CreditTransaction.event_id == event_id, CreditTransaction.type.in_((CREDIT_MANUAL_EVENT_DEBIT, CREDIT_REGISTRATION_DEBIT)))) or 0
    credited = db.scalar(select(func.coalesce(func.sum(CreditTransaction.amount_paise), 0)).where(CreditTransaction.organization_id == event.organization_id, CreditTransaction.event_id == event_id, CreditTransaction.type == CREDIT_DISCOUNT)) or 0
    if amount > charged - credited:
        raise CreditValidationError("Discount cannot exceed the Credits charged for this event")
    return add_credits(db, organization_id=event.organization_id, amount=amount, transaction_type=CREDIT_DISCOUNT, description="Post-event SportPass discount", reason=reason, event_id=event_id, source_type="EVENT_DISCOUNT", source_id=source_id or str(event_id), created_by=created_by)
