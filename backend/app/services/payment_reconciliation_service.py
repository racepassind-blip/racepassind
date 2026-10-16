"""Read-only payment audit views for organizers and SportPass administrators.

This module intentionally derives its data from the immutable checkout receipt,
collection, refund, resolution and settlement records.  It does not create a
second financial ledger or infer a successful payment from a browser return.
"""
from __future__ import annotations

from collections import defaultdict
import csv
import io
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import (
    CashfreePaymentResolution,
    CheckoutPayment,
    CheckoutReceipt,
    Event,
    Order,
    OrderItem,
    Organization,
    Refund,
    Registration,
)


def _iso(value):
    return value.isoformat() if value else None


def _payment_label(checkout: CheckoutPayment, resolution: CashfreePaymentResolution | None, refunds: list[Refund]) -> str:
    if resolution is not None:
        if resolution.status == "REFUNDED":
            return "refunded"
        if resolution.status in {"PENDING", "NEEDS_REVIEW"}:
            return "needs_review"
    if refunds and any(refund.status in {"REQUESTED", "APPROVED", "PROCESSING", "REFUND_SENT"} for refund in refunds):
        return "refund_in_progress"
    if refunds and any(refund.status == "REFUNDED" for refund in refunds):
        return "partially_refunded"
    return checkout.status


def payment_reconciliation(
    db: Session,
    *,
    event_id: UUID | None = None,
    search: str = "",
    status: str = "all",
    page: int = 1,
    page_size: int = 25,
) -> dict:
    """Return one searchable row per Cashfree checkout and event.

    A checkout can contain more than one registration, so the grouping keeps
    the provider order and receipt evidence together while still showing every
    registration reference associated with that event.
    """
    statement = (
        select(CheckoutPayment, Event, Organization, Registration, CheckoutReceipt, CashfreePaymentResolution)
        .join(Order, Order.id == CheckoutPayment.event_order_id)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .join(Registration, Registration.id == OrderItem.registration_id)
        .join(Event, Event.id == Registration.event_id)
        .join(Organization, Organization.id == Event.organization_id)
        .outerjoin(CheckoutReceipt, CheckoutReceipt.checkout_payment_id == CheckoutPayment.id)
        .outerjoin(CashfreePaymentResolution, CashfreePaymentResolution.checkout_payment_id == CheckoutPayment.id)
        .where(CheckoutPayment.mode.in_(("CASHFREE_PLATFORM", "CASHFREE_SPLIT")))
    )
    if event_id is not None:
        statement = statement.where(Event.id == event_id)
    rows = db.execute(statement.order_by(CheckoutPayment.created_at.desc(), CheckoutPayment.id.desc())).all()

    registrations_by_checkout: dict[tuple[UUID, UUID], list[Registration]] = defaultdict(list)
    receipt_ids_by_checkout: dict[tuple[UUID, UUID], set[str]] = defaultdict(set)
    receipts_by_checkout: dict[tuple[UUID, UUID], list[CheckoutReceipt]] = defaultdict(list)
    resolution_by_checkout: dict[tuple[UUID, UUID], CashfreePaymentResolution | None] = {}
    basics: dict[tuple[UUID, UUID], tuple[CheckoutPayment, Event, Organization]] = {}
    registration_ids: set[UUID] = set()
    for checkout, event, organization, registration, receipt, resolution in rows:
        key = (checkout.id, event.id)
        basics[key] = (checkout, event, organization)
        if not any(item.id == registration.id for item in registrations_by_checkout[key]):
            registrations_by_checkout[key].append(registration)
        registration_ids.add(registration.id)
        if receipt and str(receipt.id) not in receipt_ids_by_checkout[key]:
            receipts_by_checkout[key].append(receipt)
            receipt_ids_by_checkout[key].add(str(receipt.id))
        if resolution is not None:
            resolution_by_checkout[key] = resolution

    refunds_by_registration: dict[UUID, list[Refund]] = defaultdict(list)
    if registration_ids:
        for refund in db.scalars(select(Refund).where(Refund.registration_id.in_(registration_ids))).all():
            if refund.registration_id:
                refunds_by_registration[refund.registration_id].append(refund)

    items: list[dict] = []
    query = search.strip().lower()
    for key, (checkout, event, organization) in basics.items():
        registrations = registrations_by_checkout[key]
        receipts = receipts_by_checkout[key]
        registration_refunds = [refund for registration in registrations for refund in refunds_by_registration[registration.id]]
        resolution = resolution_by_checkout.get(key)
        display_status = _payment_label(checkout, resolution, registration_refunds)
        # Checkout orders can contain registrations for multiple events. Use the
        # frozen participant total on each registration, so a platform-wide
        # report never counts the same Cashfree charge once per event.
        registration_total = sum(int(registration.participant_total_paise or 0) for registration in registrations)
        fee_total = sum(int(registration.platform_fee_paise or 0) for registration in registrations)
        amount_paise = registration_total or checkout.amount_paise
        fee_paise = fee_total or checkout.fee_paise
        references = sorted({registration.registration_reference for registration in registrations if registration.registration_reference})
        payment_ids = sorted({receipt.payment_id for receipt in receipts if receipt.payment_id})
        receipt_dispositions = sorted({receipt.disposition for receipt in receipts if receipt.disposition})
        search_text = " ".join([
            checkout.provider_order_id or "", event.name or "", organization.name or "", *references, *payment_ids,
        ]).lower()
        if query and query not in search_text:
            continue
        if status != "all" and display_status != status:
            continue
        total_refunded = sum(int(refund.approved_refund_amount or 0) for refund in registration_refunds if refund.status == "REFUNDED")
        items.append({
            "checkoutId": str(checkout.id),
            "eventId": str(event.id),
            "eventName": event.name,
            "organizationName": organization.name,
            "mode": checkout.mode,
            "status": display_status,
            "gatewayStatus": checkout.status,
            "settlementStatus": checkout.settlement_status,
            "amountPaise": amount_paise,
            "platformFeePaise": fee_paise,
            "currency": checkout.currency,
            "cashfreeOrderId": checkout.provider_order_id,
            "cashfreePaymentIds": payment_ids,
            "receiptDispositions": receipt_dispositions,
            "registrationReferences": references,
            "registrationCount": len(registrations),
            "refundPaise": total_refunded,
            "refundCount": len(registration_refunds),
            "resolution": None if resolution is None else {
                "action": resolution.action, "status": resolution.status,
                "reason": resolution.reason, "providerRefundId": resolution.provider_refund_id,
                "createdAt": _iso(resolution.created_at), "completedAt": _iso(resolution.completed_at),
            },
            "createdAt": _iso(checkout.created_at),
            "receiptedAt": min((_iso(receipt.created_at) for receipt in receipts if receipt.created_at), default=None),
            "needsAttention": display_status in {"paid_needs_review", "needs_review", "refund_in_progress"},
        })

    summary = {
        "paymentCount": len(items),
        "grossCollectedPaise": sum(item["amountPaise"] for item in items if item["gatewayStatus"] == "successful"),
        "refundedPaise": sum(item["refundPaise"] for item in items),
        "needsAttentionCount": sum(1 for item in items if item["needsAttention"]),
        "awaitingCount": sum(1 for item in items if item["status"] == "awaiting"),
    }
    total = len(items)
    start = (page - 1) * page_size
    return {"items": items[start:start + page_size], "total": total, "page": page, "pageSize": page_size, "summary": summary}


def reconciliation_csv(items: list[dict]) -> str:
    """Create a portable, safe-to-share CSV of the currently filtered rows."""
    def csv_value(value: object) -> object:
        # Spreadsheet applications evaluate cells starting with these characters.
        # Prefix an apostrophe so exported participant/organizer supplied data
        # stays text when an auditor opens the report.
        if isinstance(value, str) and value[:1] in {"=", "+", "-", "@"}:
            return f"'{value}"
        return value

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Event", "Organizer", "Cashfree order ID", "Cashfree payment IDs", "Status", "Gateway status",
        "Amount (INR)", "Platform fee (INR)", "Refunded (INR)", "Registration references",
        "Receipt evidence", "Created at", "Receipted at", "Resolution", "Resolution reason",
    ])
    for item in items:
        resolution = item.get("resolution") or {}
        writer.writerow([csv_value(value) for value in [
            item["eventName"], item["organizationName"], item["cashfreeOrderId"] or "",
            ", ".join(item["cashfreePaymentIds"]), item["status"], item["gatewayStatus"],
            f"{item['amountPaise'] / 100:.2f}", f"{item['platformFeePaise'] / 100:.2f}",
            f"{item['refundPaise'] / 100:.2f}", ", ".join(item["registrationReferences"]),
            ", ".join(item["receiptDispositions"]), item["createdAt"] or "", item["receiptedAt"] or "",
            resolution.get("status", ""), resolution.get("reason", ""),
        ]])
    return output.getvalue()
