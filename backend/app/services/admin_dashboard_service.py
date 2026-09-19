from __future__ import annotations

import datetime as dt

from sqlalchemy import and_, case, desc, func, or_, select
from sqlalchemy.orm import Session

from app.services.auth_service import utc_now
from app.services.email_service import EMAIL_HARD_LIMIT, EMAIL_WARNING_LIMIT, get_email_limit_status
from models import EmailLog, Event, OrganizerApplication, OrganizerEventBilling, Organization, Registration

_CONFIRMED_REGISTRATION_STATUSES = ("confirmed", "checked_in")
_CONFIRMED_PAYMENT_STATUSES = ("approved", "not_required")
_TREND_MONTHS = 6


def _number(value) -> int:
    return int(value or 0)


def _month_start(value: dt.datetime) -> dt.datetime:
    return value.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _add_months(value: dt.datetime, months: int) -> dt.datetime:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    return value.replace(year=year, month=month, day=1)


def _date_range(value: dt.datetime) -> tuple[dt.datetime, dt.datetime]:
    start = _month_start(value)
    return start, _add_months(start, 1)


def _application(application: OrganizerApplication) -> dict:
    return {
        "id": str(application.id),
        "organizationName": application.organization_name,
        "applicantName": application.applicant_name,
        "email": application.email,
        "phone": application.phone,
        "message": application.message,
        "status": application.status,
        "createdAt": application.created_at.isoformat() if application.created_at else None,
    }


def _registration_metrics(db: Session, start: dt.datetime, end: dt.datetime) -> tuple[int, int]:
    row = db.execute(
        select(
            func.coalesce(func.sum(Registration.quantity), 0),
            func.coalesce(func.sum(Registration.total_amount_paise), 0),
        ).where(
            Registration.created_at >= start,
            Registration.created_at < end,
            Registration.status.in_(_CONFIRMED_REGISTRATION_STATUSES),
            Registration.payment_status.in_(_CONFIRMED_PAYMENT_STATUSES),
        )
    ).one()
    return _number(row[0]), _number(row[1])


def _published_races(db: Session, start: dt.datetime | None = None, end: dt.datetime | None = None) -> int:
    conditions = [Event.status == "published", Event.archived_at.is_(None)]
    if start is not None:
        conditions.append(Event.created_at >= start)
    if end is not None:
        conditions.append(Event.created_at < end)
    return _number(db.scalar(select(func.count(Event.id)).where(*conditions)))


def _incomplete_onboarding_condition():
    return or_(
        Organization.onboarding_completed_at.is_(None),
        Organization.organization_type.is_(None),
        Organization.city.is_(None),
        Organization.state.is_(None),
    )


def _monthly_trend(db: Session, current_month: dt.datetime) -> list[dict]:
    first_month = _add_months(current_month, -(_TREND_MONTHS - 1))
    trend = []
    for offset in range(_TREND_MONTHS):
        start = _add_months(first_month, offset)
        end = _add_months(start, 1)
        registrations, sales = _registration_metrics(db, start, end)
        trend.append(
            {
                "month": start.strftime("%Y-%m"),
                "label": start.strftime("%b"),
                "registrations": registrations,
                "participantSalesPaise": sales,
                "racesPublished": _published_races(db, start, end),
            }
        )
    return trend


def _email_usage(db: Session) -> dict:
    """Get email usage metrics for the current 24-hour window."""
    status, count = get_email_limit_status(db)

    window_start = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=24)

    # Count by status in the window
    sent = _number(
        db.scalar(
            select(func.count(EmailLog.id)).where(
                EmailLog.created_at >= window_start, EmailLog.status == "sent"
            )
        )
    )
    pending = _number(
        db.scalar(
            select(func.count(EmailLog.id)).where(
                EmailLog.created_at >= window_start, EmailLog.status == "pending_limit"
            )
        )
    )
    failed = _number(
        db.scalar(
            select(func.count(EmailLog.id)).where(
                EmailLog.created_at >= window_start, EmailLog.status == "failed"
            )
        )
    )

    return {
        "used": count,
        "warningLimit": EMAIL_WARNING_LIMIT,
        "hardLimit": EMAIL_HARD_LIMIT,
        "status": status.value,
        "sent": sent,
        "pending": pending,
        "failed": failed,
    }


def _top_events_by_email_volume(db: Session, limit: int = 5) -> list[dict]:
    """Get top events by email volume in the last 24 hours."""
    window_start = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=24)

    results = db.execute(
        select(
            Event.id,
            Event.name,
            func.count(EmailLog.id).label("total"),
            func.sum(case((EmailLog.status == "sent", 1), else_=0)).label("sent"),
            func.sum(case((EmailLog.status == "failed", 1), else_=0)).label("failed"),
        )
        .select_from(EmailLog)
        .join(Event, Event.id == EmailLog.event_id)
        .where(EmailLog.created_at >= window_start)
        .group_by(Event.id, Event.name)
        .order_by(desc("total"))
        .limit(limit)
    ).all()

    return [
        {
            "eventId": str(row.id),
            "eventName": row.name,
            "total": row.total,
            "sent": row.sent,
            "failed": row.failed,
            "failureRate": row.total > 0 and round((row.failed / row.total) * 100, 1) or 0,
        }
        for row in results
    ]


def get_admin_dashboard(db: Session) -> dict:
    now = utc_now()
    month_start, next_month_start = _date_range(now)
    registrations, participant_sales = _registration_metrics(db, month_start, next_month_start)

    pending_applications = list(
        db.scalars(
            select(OrganizerApplication)
            .where(OrganizerApplication.status == "pending")
            .order_by(OrganizerApplication.created_at.desc())
            .limit(5)
        ).all()
    )
    incomplete_organizations = list(
        db.scalars(
            select(Organization)
            .where(Organization.status == "active", _incomplete_onboarding_condition())
            .order_by(Organization.created_at.desc())
            .limit(5)
        ).all()
    )
    billing_due = db.scalar(
        select(func.coalesce(func.sum(OrganizerEventBilling.final_amount_paise), 0)).where(
            OrganizerEventBilling.billing_status.in_(("payment_due", "overdue"))
        )
    )
    billing_collected = db.scalar(
        select(func.coalesce(func.sum(OrganizerEventBilling.final_amount_paise), 0)).where(
            OrganizerEventBilling.billing_status == "paid_manual",
            OrganizerEventBilling.paid_at >= month_start,
            OrganizerEventBilling.paid_at < next_month_start,
        )
    )

    return {
        "generatedAt": now.isoformat(),
        "period": {
            "label": now.strftime("%B %Y"),
            "start": month_start.isoformat(),
            "end": next_month_start.isoformat(),
        },
        "metrics": {
            "pendingOrganizerApplications": _number(
                db.scalar(select(func.count(OrganizerApplication.id)).where(OrganizerApplication.status == "pending"))
            ),
            "incompleteOnboardingOrganizations": _number(
                db.scalar(
                    select(func.count(Organization.id)).where(
                        Organization.status == "active", _incomplete_onboarding_condition()
                    )
                )
            ),
            "activeRaces": _published_races(db),
            "racesPublishedThisMonth": _published_races(db, month_start, next_month_start),
            "registrationsThisMonth": registrations,
            "participantSalesThisMonthPaise": participant_sales,
            "organizerBillingDuePaise": _number(billing_due),
            "organizerBillingCollectedThisMonthPaise": _number(billing_collected),
        },
        "pendingApplications": [_application(item) for item in pending_applications],
        "incompleteOrganizations": [
            {
                "id": str(item.id),
                "name": item.name,
                "city": item.city,
                "state": item.state,
                "createdAt": item.created_at.isoformat() if item.created_at else None,
            }
            for item in incomplete_organizations
        ],
        "monthlyTrend": _monthly_trend(db, month_start),
        "emailUsage": _email_usage(db),
        "topEventsByEmail": _top_events_by_email_volume(db),
    }
