"""Registration-level Cashfree reporting. All amounts are integer paise."""
import csv
import datetime as dt
import io

from sqlalchemy import case, func, or_, select

from models import (CashfreePaymentResolution, CheckoutPayment, CheckoutReceipt,
                    Event, Organization, Participant, Payment, Refund, Registration)

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))


def ledger_query(*, event_id=None, date_from=None, date_to=None, status="all", search="", environment="production", organization_ids=None):
    completed_refund = select(func.coalesce(func.sum(Refund.approved_refund_amount), 0)).where(
        Refund.registration_id == Registration.id, Refund.payment_provider == "CASHFREE",
        Refund.is_manual_refund.is_(False), Refund.status == "REFUNDED").correlate(Registration).scalar_subquery()
    pending_refund = select(Refund.id).where(Refund.registration_id == Registration.id,
        Refund.payment_provider == "CASHFREE", Refund.status.in_(("REQUESTED", "APPROVED", "PROCESSING", "REFUND_SENT"))).exists()
    failed_refund = select(Refund.id).where(Refund.registration_id == Registration.id,
        Refund.payment_provider == "CASHFREE", or_(Refund.status == "FAILED",
        Refund.provider_refund_status.in_(("REJECTED", "CANCELLED")))).exists()
    verified = select(CheckoutReceipt.id).where(CheckoutReceipt.checkout_payment_id == CheckoutPayment.id,
        CheckoutReceipt.provider == "cashfree", CheckoutReceipt.environment == CheckoutPayment.provider_environment,
        CheckoutReceipt.account == CheckoutPayment.provider_account,
        CheckoutReceipt.amount_paise == CheckoutPayment.amount_paise).exists()
    amount = Registration.participant_total_paise
    # Recovery refunds cover the entire checkout. Each registration receives its
    # own frozen allocation, never the whole checkout amount repeated per row.
    refunded = case((CashfreePaymentResolution.status == "REFUNDED", amount), else_=completed_refund)
    state = case(
        (CashfreePaymentResolution.status == "REFUNDED", "refunded"),
        (or_(CashfreePaymentResolution.status == "NEEDS_REVIEW", failed_refund), "needs_review"),
        (or_(CashfreePaymentResolution.status == "PENDING", pending_refund), "refund_in_progress"),
        ((completed_refund > 0) & (completed_refund >= amount), "refunded"),
        (completed_refund > 0, "partially_refunded"),
        (CheckoutPayment.status == "paid_needs_review", "needs_review"),
        ((CheckoutPayment.status == "successful") & ~verified, "needs_review"),
        else_=CheckoutPayment.status).label("ledger_status")
    query = select(Registration.id.label("registration_id"), Registration.registration_reference,
        Registration.status.label("registration_status"), Participant.name.label("participant_name"),
        Event.id.label("event_id"), Event.name.label("event_name"), Organization.name.label("organizer_name"),
        CheckoutPayment.id.label("checkout_id"), CheckoutPayment.provider_order_id,
        CheckoutPayment.provider_environment.label("environment"), CheckoutPayment.created_at,
        CheckoutPayment.status.label("checkout_status"), amount.label("amount_paise"),
        Registration.platform_fee_paise.label("fee_paise"), refunded.label("refund_paise"),
        case((verified, amount), else_=0).label("collected_paise"), state,
        CashfreePaymentResolution.reason.label("resolution_reason"),
        CashfreePaymentResolution.provider_refund_id.label("resolution_refund_id"),
        CashfreePaymentResolution.status.label("resolution_status")
    ).select_from(CheckoutPayment).join(Payment, Payment.order_id == CheckoutPayment.event_order_id
    ).join(Registration, Registration.id == Payment.registration_id
    ).join(Participant, Participant.id == Registration.participant_id
    ).join(Event, Event.id == Registration.event_id
    ).join(Organization, Organization.id == Event.organization_id
    ).outerjoin(CashfreePaymentResolution, CashfreePaymentResolution.checkout_payment_id == CheckoutPayment.id
    ).where(CheckoutPayment.mode.in_(("CASHFREE_PLATFORM", "CASHFREE_SPLIT")))
    if environment != "all":
        query = query.where(CheckoutPayment.provider_environment == environment)
    if organization_ids is not None:
        query = query.where(Event.organization_id.in_(organization_ids))
    if event_id:
        query = query.where(Event.id == event_id)
    if date_from:
        query = query.where(CheckoutPayment.created_at >= dt.datetime.combine(date_from, dt.time.min, IST).astimezone(dt.timezone.utc))
    if date_to:
        query = query.where(CheckoutPayment.created_at < dt.datetime.combine(date_to + dt.timedelta(days=1), dt.time.min, IST).astimezone(dt.timezone.utc))
    if status != "all":
        query = query.where(state == status)
    if search.strip():
        term = search.strip()
        query = query.where(or_(*[column.icontains(term, autoescape=True) for column in (
            Registration.registration_reference, Participant.name, Event.name, Organization.name, CheckoutPayment.provider_order_id)],
            select(CheckoutReceipt.id).where(CheckoutReceipt.checkout_payment_id == CheckoutPayment.id,
                CheckoutReceipt.payment_id.icontains(term, autoescape=True)).exists(),
            CashfreePaymentResolution.provider_refund_id.icontains(term, autoescape=True),
            select(Refund.id).where(Refund.registration_id == Registration.id,
                Refund.provider_refund_id.icontains(term, autoescape=True)).exists()))
    return query


def ledger_rows(db, query):
    rows = db.execute(query).mappings().all()
    if not rows:
        return []
    receipts = db.scalars(select(CheckoutReceipt).where(CheckoutReceipt.checkout_payment_id.in_({r["checkout_id"] for r in rows}))).all()
    refunds = db.scalars(select(Refund).where(Refund.registration_id.in_({r["registration_id"] for r in rows}), Refund.payment_provider == "CASHFREE")).all()
    result = []
    for row in rows:
        item = dict(row)
        item["payment_ids"] = sorted({r.payment_id for r in receipts if r.checkout_payment_id == row["checkout_id"]})
        item["receipts"] = [{"paymentId": r.payment_id, "amountPaise": r.amount_paise,
            "disposition": r.disposition, "createdAt": r.created_at} for r in receipts if r.checkout_payment_id == row["checkout_id"]]
        item["refunds"] = [{"id": str(r.id), "providerRefundId": r.provider_refund_id, "status": r.status,
            "providerStatus": r.provider_refund_status, "amountPaise": r.approved_refund_amount,
            "requestedAt": r.requested_at, "refundedAt": r.refunded_at} for r in refunds if r.registration_id == row["registration_id"]]
        result.append(item)
    return result


def cashfree_ledger(db, *, page=1, page_size=25, **filters):
    query = ledger_query(**filters)
    sub = query.subquery()
    totals = db.execute(select(func.count().label("total"),
        func.coalesce(func.sum(sub.c.collected_paise), 0).label("collectedPaise"),
        func.coalesce(func.sum(sub.c.refund_paise), 0).label("refundedPaise"),
        func.coalesce(func.sum(case((sub.c.ledger_status.in_(("needs_review", "refund_in_progress")), 1), else_=0)), 0).label("attentionCount")
    ).select_from(sub)).mappings().one()
    items = ledger_rows(db, query.order_by(CheckoutPayment.created_at.desc(), Registration.id).offset((page - 1) * page_size).limit(page_size))
    return {"items": items, "total": totals["total"], "summary": dict(totals), "page": page, "pageSize": page_size}


def cashfree_ledger_csv(db, **filters):
    """Stream every matching row in bounded batches; never silently truncate."""
    fields = ["event_name", "organizer_name", "registration_reference", "participant_name", "registration_status",
              "environment", "ledger_status", "provider_order_id", "payment_ids", "amount_paise", "fee_paise",
              "collected_paise", "refund_paise", "created_at", "refund_ids", "refund_statuses",
              "resolution_status", "resolution_refund_id", "resolution_reason"]
    def line(values):
        out = io.StringIO()
        def safe(value):
            value = "" if value is None else str(value)
            return "'" + value if value.lstrip()[:1] in ("=", "+", "-", "@") or value[:1] in ("\t", "\r", "\n") else value
        csv.writer(out).writerow([safe(v) for v in values])
        return out.getvalue()
    yield line(fields)
    query = ledger_query(**filters).order_by(CheckoutPayment.created_at.desc(), Registration.id)
    offset = 0
    while True:
        rows = ledger_rows(db, query.offset(offset).limit(500))
        if not rows:
            break
        for row in rows:
            row["payment_ids"] = "; ".join(row["payment_ids"])
            row["refund_ids"] = "; ".join(r["providerRefundId"] or r["id"] for r in row["refunds"])
            row["refund_statuses"] = "; ".join(r["status"] for r in row["refunds"])
            # CSV timestamps have an explicit timezone, matching the date filter.
            timestamp = row["created_at"]
            row["created_at"] = timestamp.replace(tzinfo=dt.timezone.utc).astimezone(IST).isoformat() if timestamp.tzinfo is None else timestamp.astimezone(IST).isoformat()
            yield line([row.get(field) for field in fields])
        offset += len(rows)
