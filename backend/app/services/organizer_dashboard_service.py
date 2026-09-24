import datetime as dt

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.services.registration_service import list_organizer_registrations
from app.services.organizer_visibility_service import get_event_visibility, serialize_visibility
from models import Event, Payment, Registration


def _number(value) -> int:
    return int(value or 0)


def build_organizer_event_dashboard(db: Session, user, event: Event, visibility: dict | None = None) -> dict:
    if visibility is None:
        visibility = get_event_visibility(db, user, event.id)
    visible_confirmed_ids = visibility["visibleConfirmedRegistrationIds"]
    confirmed_statuses = ("confirmed", "checked_in")
    checked_in_condition = or_(Registration.checked_in.is_(True), Registration.status == "checked_in")

    registration_totals = db.execute(
        select(
            func.count(Registration.id).label("total"),
            func.sum(case((Registration.status == "awaiting_payment", 1), else_=0)).label("awaiting_payment"),
            func.sum(case((Registration.status == "pending_verification", 1), else_=0)).label("pending_verification"),
            func.sum(case((Registration.status.in_(confirmed_statuses), 1), else_=0)).label("confirmed"),
            func.sum(case((checked_in_condition, 1), else_=0)).label("checked_in"),
            func.sum(case((Registration.status.in_(confirmed_statuses), Registration.quantity), else_=0)).label("confirmed_participants"),
            func.sum(case((checked_in_condition, Registration.quantity), else_=0)).label("checked_in_participants"),
            func.sum(case((Registration.status == "rejected", 1), else_=0)).label("rejected"),
            func.sum(case((Registration.status == "expired", 1), else_=0)).label("expired"),
        )
        .where(Registration.event_id == event.id)
    ).one()

    payment_totals = db.execute(
        select(
            func.sum(case((Payment.status == "pending", 1), else_=0)).label("pending"),
            func.sum(case((Payment.status == "reference_submitted", 1), else_=0)).label("reference_submitted"),
            func.sum(case((Payment.status == "approved", 1), else_=0)).label("approved"),
            func.sum(case((Payment.status == "not_required", 1), else_=0)).label("not_required"),
            func.sum(case((Payment.status == "rejected", 1), else_=0)).label("rejected"),
            func.sum(case((Payment.status == "expired", 1), else_=0)).label("expired"),
            func.sum(
                case(
                    (
                        Payment.status.in_(("approved", "not_required"))
                        & Registration.status.in_(confirmed_statuses),
                        Registration.total_amount_paise,
                    ),
                    else_=0,
                )
            ).label("approved_amount_paise"),
        )
        .join(Registration, Registration.id == Payment.registration_id)
        .where(Registration.event_id == event.id)
    ).one()

    ticket_registration_rows = db.execute(
        select(
            Registration.ticket_id,
            func.sum(case((Registration.status.in_(confirmed_statuses), Registration.quantity), else_=0)).label("confirmed_quantity"),
            func.sum(case((Registration.status.in_(("awaiting_payment", "pending_verification")), Registration.quantity), else_=0)).label("pending_quantity"),
            func.sum(case((checked_in_condition, Registration.quantity), else_=0)).label("checked_in_quantity"),
        )
        .where(Registration.event_id == event.id)
        .group_by(Registration.ticket_id)
    ).all()
    ticket_stats = {
        ticket_id: {
            "confirmedQuantity": _number(confirmed_quantity),
            "pendingQuantity": _number(pending_quantity),
            "checkedInQuantity": _number(checked_in_quantity),
        }
        for ticket_id, confirmed_quantity, pending_quantity, checked_in_quantity in ticket_registration_rows
    }

    by_ticket = []
    inventory_total = 0
    inventory_sold = 0
    inventory_reserved = 0
    inventory_available = 0
    for category in event.categories:
        for ticket in category.tickets:
            stats = ticket_stats.get(ticket.id, {"confirmedQuantity": 0, "pendingQuantity": 0, "checkedInQuantity": 0})
            visible_sold = visibility["visibleConfirmedByTicket"].get(ticket.id, 0)
            inventory_total += ticket.quantity_total
            inventory_sold += visible_sold
            inventory_reserved += ticket.quantity_reserved
            inventory_available += max(0, ticket.quantity_total - visible_sold - ticket.quantity_reserved)
            stats["confirmedQuantity"] = visible_sold
            stats["checkedInQuantity"] = min(stats["checkedInQuantity"], visible_sold)
            by_ticket.append(
                {
                    "ticketId": str(ticket.id),
                    "categoryId": str(category.id),
                    "categoryName": category.name,
                    "ticketName": ticket.name,
                    "pricePaise": ticket.price,
                    "quantityTotal": ticket.quantity_total,
                    "quantitySold": visible_sold,
                    "quantityReserved": ticket.quantity_reserved,
                    "available": max(0, ticket.quantity_total - visible_sold - ticket.quantity_reserved),
                    **stats,
                }
            )

    category_registration_rows = db.execute(
        select(
            Registration.category_id,
            func.count(Registration.id).label("registration_count"),
            func.sum(Registration.quantity).label("total_quantity"),
            func.sum(case((Registration.status.in_(confirmed_statuses), Registration.quantity), else_=0)).label("confirmed_quantity"),
            func.sum(case((Registration.status.in_(("awaiting_payment", "pending_verification")), Registration.quantity), else_=0)).label("pending_quantity"),
            func.sum(case((checked_in_condition, Registration.quantity), else_=0)).label("checked_in_quantity"),
        )
        .where(Registration.event_id == event.id)
        .group_by(Registration.category_id)
    ).all()
    category_stats = {
        category_id: {
            "registrationCount": _number(registration_count),
            "totalQuantity": _number(total_quantity),
            "confirmedQuantity": _number(confirmed_quantity),
            "pendingQuantity": _number(pending_quantity),
            "checkedInQuantity": _number(checked_in_quantity),
        }
        for category_id, registration_count, total_quantity, confirmed_quantity, pending_quantity, checked_in_quantity in category_registration_rows
    }

    by_category = []
    for category in event.categories:
        stats = category_stats.get(
            category.id,
            {
                "registrationCount": 0,
                "totalQuantity": 0,
                "confirmedQuantity": 0,
                "pendingQuantity": 0,
                "checkedInQuantity": 0,
            },
        )
        ticket_capacity = sum(ticket.quantity_total for ticket in category.tickets)
        capacity = category.max_participants if category.max_participants is not None else ticket_capacity
        stats["confirmedQuantity"] = visibility["visibleConfirmedByCategory"].get(category.id, 0)
        stats["checkedInQuantity"] = min(stats["checkedInQuantity"], stats["confirmedQuantity"])
        stats["registrationCount"] = stats["confirmedQuantity"] + stats["pendingQuantity"]
        stats["totalQuantity"] = stats["confirmedQuantity"] + stats["pendingQuantity"]
        by_category.append(
            {
                "categoryId": str(category.id),
                "categoryName": category.name,
                "distance": category.distance,
                "capacity": capacity,
                **stats,
            }
        )

    trend_today = dt.datetime.now(dt.timezone.utc).date()
    trend_start = trend_today - dt.timedelta(days=29)
    signup_trend = {
        trend_start + dt.timedelta(days=offset): {
            "registrations": 0,
            "quantity": 0,
            "confirmedQuantity": 0,
        }
        for offset in range(30)
    }
    trend_rows = db.execute(
        select(Registration.id, Registration.created_at, Registration.quantity, Registration.status)
        .where(
            Registration.event_id == event.id,
            Registration.created_at >= dt.datetime.combine(trend_start, dt.time.min, tzinfo=dt.timezone.utc),
        )
    ).all()
    for registration_id, created_at, quantity, status in trend_rows:
        if status in confirmed_statuses and registration_id not in visible_confirmed_ids:
            continue
        created_date = created_at.date()
        if created_date not in signup_trend:
            continue
        point = signup_trend[created_date]
        point["registrations"] += 1
        point["quantity"] += _number(quantity)
        if status in confirmed_statuses:
            point["confirmedQuantity"] += _number(quantity)

    payment_outcomes = _number(payment_totals.approved) + _number(payment_totals.not_required) + _number(payment_totals.rejected) + _number(payment_totals.expired)
    payment_successes = _number(payment_totals.approved) + _number(payment_totals.not_required)
    confirmed_participants = visibility["visibleConfirmedQuantity"]
    checked_in_participants = visibility["visibleCheckedInQuantity"]
    locked_records = visibility["lockedConfirmedRecords"]
    visible_total_records = max(0, _number(registration_totals.total) - locked_records)

    recent = list_organizer_registrations(
        db,
        user,
        event_id=event.id,
        status_filter="all",
        page_size=8,
        visibility_by_event={event.id: visibility},
        visibility_event_ids=[event.id],
    )["items"]

    # ── Add-on summary ────────────────────────────────────────────────────────
    # Read selections from all confirmed registrations for this event.
    # aggregate per addon_id, per option (single_select) or total qty (quantity).
    addon_defs = {
        addon["id"]: addon
        for addon in (event.addon_config or {}).get("addons", [])
        if isinstance(addon, dict) and addon.get("id")
    }
    by_addon: list[dict] = []
    if addon_defs:
        confirmed_selections = db.execute(
            select(Registration.selections, Registration.computed_total)
            .where(
                Registration.event_id == event.id,
                Registration.status.in_(confirmed_statuses),
            )
        ).all()

        # Build raw aggregation: {addon_id: {"total_qty": int, "revenue_paise": int, "by_option": {opt: int}}}
        agg: dict[str, dict] = {
            addon_id: {"total_qty": 0, "revenue_paise": 0, "by_option": {}}
            for addon_id in addon_defs
        }
        for selections_raw, computed_total_raw in confirmed_selections:
            selections = selections_raw or {}
            # Use computed_total.addons for revenue (amounts already calculated)
            ct_addons = {}
            if isinstance(computed_total_raw, dict):
                for item in computed_total_raw.get("addons", []):
                    if isinstance(item, dict) and item.get("id"):
                        ct_addons[item["id"]] = item

            for addon_id, bucket in agg.items():
                sel = selections.get(addon_id)
                if not isinstance(sel, dict):
                    continue
                if "selected" in sel:
                    # single_select
                    option = str(sel["selected"])
                    bucket["by_option"][option] = bucket["by_option"].get(option, 0) + 1
                    bucket["total_qty"] += 1
                elif "qty" in sel:
                    try:
                        qty = int(sel["qty"])
                    except (TypeError, ValueError):
                        qty = 0
                    bucket["total_qty"] += qty
                # revenue from computed_total snapshot
                ct_item = ct_addons.get(addon_id)
                if ct_item:
                    try:
                        bucket["revenue_paise"] += int(ct_item.get("amount_paise", 0))
                    except (TypeError, ValueError):
                        pass

        for addon_id, addon_def in addon_defs.items():
            bucket = agg[addon_id]
            by_option = (
                [{"option": opt, "count": cnt} for opt, cnt in sorted(bucket["by_option"].items())]
                if addon_def.get("type") == "single_select"
                else []
            )
            by_addon.append(
                {
                    "addonId": addon_id,
                    "addonName": addon_def.get("name", addon_id),
                    "type": addon_def.get("type", "single_select"),
                    "pricePaise": addon_def.get("price_paise", 0),
                    "totalQuantity": bucket["total_qty"],
                    "totalRevenuePaise": bucket["revenue_paise"],
                    "byOption": by_option,
                }
            )

    return {
        "overview": {
            "confirmedParticipants": confirmed_participants,
            "totalConfirmedParticipants": visibility["totalConfirmedQuantity"],
            "lockedConfirmedParticipants": visibility["lockedConfirmedQuantity"],
            "registrationLimit": visibility["planLimit"],
            "visibility": serialize_visibility(visibility),
            "totalRegistrationRecords": visible_total_records,
            "approvedAmountPaise": visibility["visibleApprovedAmountPaise"],
            "ticketsSold": inventory_sold,
            "checkInRate": round((checked_in_participants / confirmed_participants) * 100) if confirmed_participants else 0,
            "signupsToday": signup_trend[trend_today]["quantity"],
            "paymentSuccessRate": round((payment_successes / payment_outcomes) * 100) if payment_outcomes else 0,
        },
        "inventory": {
            "total": inventory_total,
            "sold": inventory_sold,
            "reserved": inventory_reserved,
            "available": inventory_available,
        },
        "registrations": {
            "total": visible_total_records,
            "awaitingPayment": _number(registration_totals.awaiting_payment),
            "pendingVerification": _number(registration_totals.pending_verification),
            "confirmed": visibility["visibleConfirmedRecords"],
            "checkedIn": visibility["visibleCheckedInRecords"],
            "rejected": _number(registration_totals.rejected),
            "expired": _number(registration_totals.expired),
        },
        "payments": {
            "pending": _number(payment_totals.pending),
            "referenceSubmitted": _number(payment_totals.reference_submitted),
            "approved": visibility["visibleConfirmedRecords"],
            "notRequired": 0,
            "rejected": _number(payment_totals.rejected),
            "expired": _number(payment_totals.expired),
            "approvedAmountPaise": visibility["visibleApprovedAmountPaise"],
        },
        "byTicket": by_ticket,
        "byCategory": by_category,
        "signupTrend": [
            {
                "date": date.isoformat(),
                **point,
            }
            for date, point in signup_trend.items()
        ],
        "recentRegistrations": recent,
        "byAddon": by_addon,
    }
