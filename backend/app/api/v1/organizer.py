from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_csrf, require_roles
from app.schemas.registrations import PaymentDecisionIn
from app.services.rate_limit_service import RateLimitExceeded, enforce_payment_decision_limit
from app.services.registration_service import (
    CsvExportTooLargeError,
    RegistrationExpiredError,
    decide_registration_payment,
    export_organizer_registrations_csv,
    list_organizer_registrations,
    serialize_organizer_registration,
)
from db import get_db
from models import Organization, OrganizationMember, User

router = APIRouter()


@router.get("/organizations")
def list_my_organizations(
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
) -> list[dict]:
    if user.role == "admin":
        organizations = db.scalars(select(Organization).order_by(Organization.created_at.desc())).all()
    else:
        organizations = db.scalars(
            select(Organization)
            .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
            .where(OrganizationMember.user_id == user.id, Organization.status == "active")
            .order_by(Organization.created_at.desc())
        ).all()
    return [{"id": str(item.id), "name": item.name, "status": item.status} for item in organizations]


@router.get("/me")
def organizer_me(user: User = Depends(get_current_user)) -> dict:
    return {"id": str(user.id), "name": user.name, "email": user.email, "role": user.role}


@router.get("/registrations")
def organizer_registrations(
    event_id: UUID | None = None,
    category_id: UUID | None = None,
    ticket_id: UUID | None = None,
    status_filter: str | None = Query(default=None, alias="status", max_length=30),
    search: str | None = Query(default=None, alias="q", max_length=120),
    participant_search: str | None = Query(default=None, alias="participant", max_length=120),
    email_search: str | None = Query(default=None, alias="email", max_length=320),
    phone_search: str | None = Query(default=None, alias="phone", max_length=40),
    registration_reference: str | None = Query(default=None, alias="registration_reference", max_length=80),
    payment_status: str | None = Query(default=None, max_length=30),
    check_in_status: str | None = Query(default=None, alias="check_in_status", max_length=30),
    page_size: int = Query(default=50, ge=1, le=100),
    legacy_limit: int | None = Query(default=None, alias="limit", ge=1, le=100),
    cursor: str | None = Query(default=None, max_length=512),
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return list_organizer_registrations(
            db,
            user,
            event_id=event_id,
            category_id=category_id,
            ticket_id=ticket_id,
            status_filter=status_filter,
            search=search,
            participant_search=participant_search,
            email_search=email_search,
            phone_search=phone_search,
            registration_reference=registration_reference,
            payment_status=payment_status,
            check_in_status=check_in_status,
            page_size=legacy_limit or page_size,
            cursor=cursor,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.get("/events/{event_id}/registrations.csv")
def export_registrations_csv(
    event_id: UUID,
    category_id: UUID | None = None,
    ticket_id: UUID | None = None,
    status_filter: str | None = Query(default=None, alias="status", max_length=30),
    search: str | None = Query(default=None, alias="q", max_length=120),
    participant_search: str | None = Query(default=None, alias="participant", max_length=120),
    email_search: str | None = Query(default=None, alias="email", max_length=320),
    phone_search: str | None = Query(default=None, alias="phone", max_length=40),
    registration_reference: str | None = Query(default=None, alias="registration_reference", max_length=80),
    payment_status: str | None = Query(default=None, max_length=30),
    check_in_status: str | None = Query(default=None, alias="check_in_status", max_length=30),
    user: User = Depends(require_roles("organizer", "admin")),
    db: Session = Depends(get_db),
) -> Response:
    try:
        csv_content = export_organizer_registrations_csv(
            db,
            user,
            event_id=event_id,
            category_id=category_id,
            ticket_id=ticket_id,
            status_filter=status_filter,
            search=search,
            participant_search=participant_search,
            email_search=email_search,
            phone_search=phone_search,
            registration_reference=registration_reference,
            payment_status=payment_status,
            check_in_status=check_in_status,
        )
    except CsvExportTooLargeError as exc:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=str(exc)) from exc
    except ValueError as exc:
        code = status.HTTP_404_NOT_FOUND if str(exc) == "Event not found" else status.HTTP_422_UNPROCESSABLE_ENTITY
        raise HTTPException(status_code=code, detail=str(exc)) from exc
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="registrations-{event_id}.csv"',
            "Cache-Control": "no-store",
        },
    )


def _decide_registration(
    registration_id: UUID,
    decision: str,
    payload: PaymentDecisionIn,
    user: User,
    db: Session,
    client_ip: str,
) -> dict:
    try:
        enforce_payment_decision_limit(
            db,
            registration_id=str(registration_id),
            user_id=str(user.id),
            client_ip=client_ip,
        )
        db.commit()
    except RateLimitExceeded as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    try:
        registration, event = decide_registration_payment(
            db,
            user,
            registration_id,
            decision=decision,
            reason=payload.reason,
        )
    except RegistrationExpiredError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        code = status.HTTP_404_NOT_FOUND if str(exc) == "Registration not found" else status.HTTP_409_CONFLICT
        raise HTTPException(status_code=code, detail=str(exc)) from exc
    return serialize_organizer_registration(registration, event)


@router.post("/registrations/{registration_id}/approve")
def approve_registration(
    registration_id: UUID,
    request: Request,
    payload: PaymentDecisionIn = PaymentDecisionIn(),
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    return _decide_registration(registration_id, "approve", payload, user, db, request.client.host if request.client else "unknown")


@router.post("/registrations/{registration_id}/reject")
def reject_registration(
    registration_id: UUID,
    payload: PaymentDecisionIn,
    request: Request,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    return _decide_registration(registration_id, "reject", payload, user, db, request.client.host if request.client else "unknown")
