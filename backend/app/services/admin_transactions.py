"""Unified read-only transaction index, keeping each money flow distinct."""
import datetime as dt

from sqlalchemy import case, cast, func, literal, or_, select, String, union_all

from models import CheckoutPayment, CheckoutReceipt, Event, Organization, Participant, Payment, ProductListing, ProductOrder, Refund, Registration
from app.services.cashfree_ledger_service import IST, ledger_query


def transaction_query():
    gateway = ledger_query(environment="production").subquery()
    cashfree = select(
        cast(gateway.c.registration_id, String).label("id"), literal("registration").label("kind"),
        gateway.c.registration_reference.label("reference"), gateway.c.participant_name.label("customer"),
        gateway.c.event_name.label("event"), cast(gateway.c.event_id, String).label("event_id"),
        gateway.c.organizer_name.label("organizer"), cast(Event.organization_id, String).label("organization_id"),
        literal("cashfree").label("method"), gateway.c.ledger_status.label("status"),
        gateway.c.amount_paise.label("amount"), gateway.c.fee_paise.label("fee"),
        gateway.c.refund_paise.label("refunded"), gateway.c.provider_order_id.label("payment_reference"),
        gateway.c.created_at.label("created_at"),
        case((gateway.c.collected_paise > 0, "Verified by Cashfree"), else_="Awaiting verification").label("confirmation"),
    ).join(Event, Event.id == gateway.c.event_id)
    amount = func.coalesce(Registration.participant_total_paise, Registration.total_amount_paise)
    refunded = select(func.coalesce(func.sum(Refund.approved_refund_amount), 0)).where(
        Refund.registration_id == Registration.id, Refund.status == "REFUNDED",
        Refund.is_manual_refund.is_(False)).correlate(Registration).scalar_subquery()
    direct_status = case(
        ((refunded > 0) & (refunded >= amount), "refunded"),
        (refunded > 0, "partially_refunded"),
        (amount == 0, "not_required"),
        (Registration.payment_status == "approved", "successful"),
        (Registration.payment_status == "pending_verification", "needs_review"),
        (Registration.status.in_(("cancelled", "expired", "rejected")), Registration.status),
        else_="awaiting")
    direct = select(
        cast(Registration.id, String), literal("registration"), Registration.registration_reference,
        Participant.name, Event.name, cast(Event.id, String), Organization.name, cast(Organization.id, String),
        case((amount == 0, "free"), (Registration.source == "offline", "offline"), else_="direct_upi"),
        direct_status, amount, Registration.platform_fee_paise, refunded,
        func.coalesce(Payment.utr_reference, Payment.transaction_id), Registration.created_at,
        case((amount == 0, "Payment not required"), (Registration.payment_status == "approved", "Confirmed by organizer"), else_="Awaiting organizer confirmation"),
    ).select_from(Registration).join(Event, Event.id == Registration.event_id).join(
        Organization, Organization.id == Event.organization_id).join(Participant, Participant.id == Registration.participant_id
    ).outerjoin(Payment, Payment.registration_id == Registration.id).where(
        ~select(CheckoutPayment.id).where(CheckoutPayment.event_order_id == Payment.order_id,
            CheckoutPayment.mode.in_(("CASHFREE_PLATFORM", "CASHFREE_SPLIT"))).correlate(Payment).exists(),
        or_(Event.payment_collection_method == "DIRECT_UPI", amount == 0, Registration.source == "offline"))
    merch = select(
        cast(ProductOrder.id, String), literal("merchandise"),
        literal("SPM-") + func.upper(func.substr(func.replace(cast(ProductOrder.id, String), "-", ""), 1, 12)),
        ProductOrder.buyer_name, ProductListing.name, literal(None, String),
        Organization.name, cast(Organization.id, String), literal("direct_upi"),
        case((or_(ProductOrder.status.in_(("confirmed", "fulfilled")), CheckoutPayment.status == "successful"), "successful"),
             (ProductOrder.status == "under_review", "needs_review"),
             (ProductOrder.status == "awaiting_payment", "awaiting"), else_=ProductOrder.status),
        ProductOrder.snapshot["total_paise"].as_integer(),
        func.coalesce(CheckoutPayment.fee_paise, ProductOrder.snapshot["platform_fee_paise"].as_integer(), 0), literal(0),
        ProductOrder.payment_reference, ProductOrder.created_at,
        case((or_(ProductOrder.status.in_(("confirmed", "fulfilled")), CheckoutPayment.status == "successful"), "Confirmed by organizer"), else_="Awaiting organizer confirmation"),
    ).select_from(ProductOrder).join(ProductListing, ProductListing.id == ProductOrder.listing_id
    ).join(Organization, Organization.id == ProductListing.organization_id
    ).outerjoin(CheckoutPayment, CheckoutPayment.product_order_id == ProductOrder.id)
    return union_all(cashfree, direct, merch).subquery()


def transactions(db, *, search="", organization_id=None, event_id=None, date_from=None, date_to=None,
                 method="all", kind="all", status="all", page=1, page_size=25):
    rows = transaction_query()
    query = select(rows)
    for column, value in ((rows.c.organization_id, organization_id), (rows.c.event_id, event_id)):
        if value:
            # UUID casts differ between SQLite and PostgreSQL.
            query = query.where(func.replace(column, "-", "") == str(value).replace("-", ""))
    if search.strip():
        receipt_match = select(CheckoutReceipt.id).join(CheckoutPayment, CheckoutPayment.id == CheckoutReceipt.checkout_payment_id
        ).join(Payment, Payment.order_id == CheckoutPayment.event_order_id).where(
            rows.c.kind == "registration", cast(Payment.registration_id, String) == rows.c.id,
            CheckoutReceipt.payment_id.icontains(search.strip(), autoescape=True)).exists()
        query = query.where(or_(receipt_match, *[column.icontains(search.strip(), autoescape=True) for column in
            (rows.c.reference, rows.c.customer, rows.c.event, rows.c.organizer, rows.c.payment_reference)]))
    for column, value in ((rows.c.method, method), (rows.c.kind, kind)):
        if value != "all":
            query = query.where(column == value)
    if date_from:
        query = query.where(rows.c.created_at >= dt.datetime.combine(date_from, dt.time.min, IST).astimezone(dt.timezone.utc))
    if date_to:
        query = query.where(rows.c.created_at < dt.datetime.combine(date_to + dt.timedelta(days=1), dt.time.min, IST).astimezone(dt.timezone.utc))
    filtered = query.subquery()
    counts = dict(db.execute(select(filtered.c.status, func.count()).group_by(filtered.c.status)).all())
    if status != "all":
        query = query.where(rows.c.status == status)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    items = [dict(row) for row in db.execute(query.order_by(rows.c.created_at.desc(), rows.c.kind, rows.c.id)
        .offset((page - 1) * page_size).limit(page_size)).mappings()]
    return {"items": items, "total": total, "counts": counts}
