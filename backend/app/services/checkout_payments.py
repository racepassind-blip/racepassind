"""Shared payment foundation. No live gateway or unverified webhook entry point.

Callers own transactions and domain authorization. Lock the domain owner before
calling these functions. No network calls, commits or email side effects here.
"""
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
import hashlib
import json
from typing import Protocol, Callable

from sqlalchemy import select
from models import CheckoutPayment, CheckoutReceipt, Payment


class PaymentMode(str, Enum):
    DIRECT_UPI = "DIRECT_UPI"
    MANUAL_OFFLINE = "MANUAL_OFFLINE"
    CASHFREE_PLATFORM = "CASHFREE_PLATFORM"
    CASHFREE_SPLIT = "CASHFREE_SPLIT"


class ProviderUnavailable(ValueError):
    pass


def fingerprint(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()


def rupees(paise: int) -> str:
    if type(paise) is not int or paise < 0:
        raise ValueError("Amount must be non-negative integer paise")
    return format(Decimal(paise) / Decimal(100), ".2f")


@dataclass(frozen=True)
class PaymentPlan:
    mode: PaymentMode
    amount_paise: int
    fee_paise: int
    vendor_id: str | None = None
    vendor_ready: bool = False

    def __post_init__(self):
        if not isinstance(self.mode, PaymentMode):
            raise ValueError("Unknown payment mode")
        rupees(self.amount_paise)
        rupees(self.fee_paise)
        if self.fee_paise > self.amount_paise:
            raise ValueError("Fee exceeds total")
        if self.mode == PaymentMode.CASHFREE_SPLIT and (not self.vendor_id or not self.vendor_ready):
            raise ValueError("Verified vendor required for split settlement")
        if self.mode != PaymentMode.CASHFREE_SPLIT and self.vendor_id:
            raise ValueError("Vendor only allowed for split settlement")

    @property
    def fee_funding(self):
        if not self.fee_paise:
            return "WAIVED"
        return "WITHHOLD" if self.mode in {PaymentMode.CASHFREE_PLATFORM, PaymentMode.CASHFREE_SPLIT} else "CREDITS"

    @property
    def organizer_share_paise(self):
        return self.amount_paise - self.fee_paise


@dataclass(frozen=True)
class VerifiedReceipt:
    """Internal adapter output, never constructed from a request body directly.

    Future adapter must authenticate account/environment/order and verify amount,
    currency and successful status before returning this object.
    """
    provider: str
    account: str
    environment: str
    payment_id: str
    checkout_payment_id: object
    amount_paise: int
    currency: str
    provider_order_id: str


class PaymentProvider(Protocol):
    def create_session(self, payment: CheckoutPayment) -> dict: ...
    def verify_payment(self, payment: CheckoutPayment) -> VerifiedReceipt: ...


class DisabledCashfree:
    def create_session(self, payment):
        raise ProviderUnavailable("Cashfree is not configured; no payment session was created")

    def verify_payment(self, payment):
        raise ProviderUnavailable("Cashfree verification is not configured")


def gateway_provider(mode: PaymentMode) -> PaymentProvider:
    if mode not in {PaymentMode.CASHFREE_PLATFORM, PaymentMode.CASHFREE_SPLIT}:
        raise ValueError("This mode uses manual payment verification")
    return DisabledCashfree()


def bind_provider_order(payment, *, account: str, environment: str, provider_order_id: str):
    """Bind once after a server-side create/recovery; not a browser operation."""
    if payment.mode not in {PaymentMode.CASHFREE_PLATFORM.value, PaymentMode.CASHFREE_SPLIT.value}:
        raise ValueError("Manual order cannot bind a gateway")
    if not account or not provider_order_id or environment not in {"sandbox", "production"}:
        raise ValueError("Invalid provider binding")
    existing = (payment.provider_account, payment.provider_environment, payment.provider_order_id)
    requested = (account, environment, provider_order_id)
    if any(existing) and existing != requested:
        raise ValueError("Provider order binding cannot change")
    payment.provider_account, payment.provider_environment, payment.provider_order_id = requested


def ensure_payment(db, *, plan: PaymentPlan, product_order_id=None, event_order_id=None, request_fingerprint=None):
    if (product_order_id is None) == (event_order_id is None):
        raise ValueError("Exactly one order is required")
    clause = CheckoutPayment.product_order_id == product_order_id if product_order_id else CheckoutPayment.event_order_id == event_order_id
    payment = db.scalar(select(CheckoutPayment).where(clause).with_for_update())
    if payment:
        if (payment.mode, payment.amount_paise, payment.fee_paise, payment.vendor_id, payment.currency, payment.fee_funding) != (plan.mode.value, plan.amount_paise, plan.fee_paise, plan.vendor_id, "INR", plan.fee_funding):
            raise ValueError("Existing payment configuration cannot change")
        if request_fingerprint and payment.request_fingerprint and payment.request_fingerprint != request_fingerprint:
            raise ValueError("Order request already used with different details")
        return payment
    payment = CheckoutPayment(product_order_id=product_order_id, event_order_id=event_order_id,
        mode=plan.mode.value, amount_paise=plan.amount_paise, fee_paise=plan.fee_paise,
        currency="INR", fee_funding=plan.fee_funding, vendor_id=plan.vendor_id,
        request_fingerprint=request_fingerprint, status="not_required" if not plan.amount_paise else "awaiting",
        settlement_status="pending" if plan.mode in {PaymentMode.CASHFREE_PLATFORM, PaymentMode.CASHFREE_SPLIT} else "not_applicable")
    db.add(payment)
    db.flush()
    return payment


def sync_product_payment(db, order, *, request_fingerprint=None):
    payment = ensure_payment(db, plan=PaymentPlan(PaymentMode.DIRECT_UPI, order.snapshot["total_paise"], order.snapshot["platform_fee_paise"]),
        product_order_id=order.id, request_fingerprint=request_fingerprint)
    # Cancellation/expiry is not proof that money was refunded.
    if payment.status not in {"successful", "not_required"}:
        payment.status = {"under_review": "review_pending", "confirmed": "successful", "fulfilled": "successful",
                          "expired": "expired", "rejected": "rejected", "cancelled": "cancelled"}.get(order.status, "awaiting")
    return payment


def sync_event_payment(db, order):
    db.flush()
    payments = db.scalars(select(Payment).where(Payment.order_id == order.id)).all()
    # Fail closed for future gateway records: they must go through an adapter.
    if any(p.payment_gateway not in {"free", "manual_upi", "manual_offline", "direct_upi"} for p in payments):
        raise ValueError("Gateway payments require provider verification")
    fee = sum((p.registration.platform_fee_paise or 0) for p in payments if p.registration)
    mode = PaymentMode.MANUAL_OFFLINE if any(p.payment_gateway == "manual_offline" for p in payments) else PaymentMode.DIRECT_UPI
    total = order.total_amount_paise
    if total is None:
        total = int(Decimal(str(order.total_amount)) * 100)
    payment = ensure_payment(db, plan=PaymentPlan(mode, total, fee), event_order_id=order.id)
    if payment.status not in {"successful", "not_required"}:
        if payments and all(p.status in {"approved", "not_required"} for p in payments):
            payment.status = "successful" if total else "not_required"
        elif any(p.status == "reference_submitted" for p in payments):
            payment.status = "review_pending"
        elif order.status == "cancelled":
            payment.status = "cancelled"
    return payment


def reconcile_gateway_success(db, payment, *, provider: PaymentProvider, account: str, environment: str,
                              lock_owner: Callable[[], None], finalize: Callable[[], bool]):
    """Foundation for future wiring; provider verification precedes DB locks.

    lock_owner must lock the domain order/inventory in the same order as manual
    checkout, before this function locks the shared payment row.
    finalize runs in a savepoint: return False for late/cancelled fulfillment,
    True only after atomic stock/ticket/fee effects. Caller commits everything.
    There is intentionally no production route or fake-provider registry.
    """
    if payment.mode not in {PaymentMode.CASHFREE_PLATFORM.value, PaymentMode.CASHFREE_SPLIT.value}:
        raise ValueError("Manual payment cannot use gateway verification")
    if (payment.provider_account, payment.provider_environment) != (account, environment) or not payment.provider_order_id:
        raise ValueError("Provider order is not bound to this account/environment")
    receipt = provider.verify_payment(payment)
    if (receipt.provider != "cashfree" or not receipt.payment_id or not account or
        environment not in {"sandbox", "production"} or receipt.account != account or receipt.environment != environment or
        receipt.provider_order_id != payment.provider_order_id or type(receipt.amount_paise) is not int or
        receipt.checkout_payment_id != payment.id or receipt.amount_paise != payment.amount_paise or receipt.currency != payment.currency):
        raise ValueError("Payment evidence does not match the order")
    lock_owner()
    if payment.event_order_id and environment == "production" and payment.mode == "CASHFREE_PLATFORM":
        from models import Event, Registration
        event_ids = db.scalars(select(Registration.event_id).join(Payment, Payment.registration_id == Registration.id)
                              .where(Payment.order_id == payment.event_order_id).distinct()).all()
        for event_id in sorted(event_ids, key=str):
            db.scalar(select(Event).where(Event.id == event_id).with_for_update())
    payment = db.scalar(select(CheckoutPayment).where(CheckoutPayment.id == payment.id).with_for_update().execution_options(populate_existing=True))
    existing = db.scalar(select(CheckoutReceipt).where(CheckoutReceipt.provider == receipt.provider,
        CheckoutReceipt.account == account, CheckoutReceipt.environment == environment, CheckoutReceipt.payment_id == receipt.payment_id))
    if existing:
        if existing.checkout_payment_id != payment.id or existing.amount_paise != receipt.amount_paise:
            raise ValueError("Payment receipt already belongs to another order")
        return existing.disposition
    if payment.status in {"successful", "paid_needs_review"}:
        disposition = "duplicate_payment"
    else:
        savepoint = db.begin_nested()
        try:
            ready = finalize()
            if ready:
                savepoint.commit()
            else:
                savepoint.rollback()
        except Exception:
            savepoint.rollback()
            raise
        disposition = "confirmed" if ready else "paid_needs_review"
        payment.status = "successful" if ready else "paid_needs_review"
    receipt_row = CheckoutReceipt(checkout_payment_id=payment.id, provider=receipt.provider, account=account,
        environment=environment, payment_id=receipt.payment_id, amount_paise=receipt.amount_paise, disposition=disposition)
    db.add(receipt_row)
    db.flush()
    if payment.event_order_id and environment == "production" and disposition == "confirmed" and payment.mode == "CASHFREE_PLATFORM":
        from app.services.organizer_settlement_service import post_verified_collection
        post_verified_collection(db, receipt_id=receipt_row.id)
    return disposition
