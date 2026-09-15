from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import CSRF_COOKIE, SESSION_COOKIE, get_current_user, require_csrf
from app.services.audit_service import record_audit
from app.services.auth_service import (
    create_session,
    hash_password,
    normalize_email,
    normalize_phone,
    public_user,
    revoke_session,
    verify_password,
)
from app.services.rate_limit_service import RateLimitExceeded, enforce_account_registration_limit, enforce_login_limit
from db import get_db
from models import OrganizerApplication, User

router = APIRouter()


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=320)
    phone: str | None = Field(default=None, max_length=32)
    password: str = Field(min_length=8, max_length=256)


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=256)


class OrganizerApplicationIn(BaseModel):
    organization_name: str = Field(min_length=2, max_length=160)
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=320)
    phone: str | None = Field(default=None, max_length=32)
    password: str = Field(min_length=8, max_length=256)
    message: str | None = Field(default=None, max_length=2000)


def _set_session_cookies(response: Response, raw_session: str, csrf_token: str) -> None:
    from app.config import get_settings

    settings = get_settings()
    same_site = "none" if settings.is_production else "lax"
    response.set_cookie(
        SESSION_COOKIE,
        raw_session,
        httponly=True,
        secure=settings.is_production,
        samesite=same_site,
        max_age=7 * 24 * 60 * 60,
        path="/",
    )
    response.set_cookie(
        CSRF_COOKIE,
        csrf_token,
        httponly=False,
        secure=settings.is_production,
        samesite=same_site,
        max_age=7 * 24 * 60 * 60,
        path="/",
    )


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterIn,
    response: Response,
    request: Request,
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    email = normalize_email(payload.email)
    client_ip = request.client.host if request.client else "unknown"
    try:
        enforce_account_registration_limit(db, email=email, client_ip=client_ip)
        db.commit()
    except RateLimitExceeded as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc

    try:
        user = User(
            name=payload.name.strip(),
            email=email,
            normalized_email=email,
            phone=payload.phone.strip() if payload.phone else None,
            normalized_phone=normalize_phone(payload.phone),
            password_hash=hash_password(payload.password),
            role="participant",
            is_active=True,
        )
        db.add(user)
        db.flush()
        raw_session, csrf_token = create_session(
            db,
            user,
            user_agent=request.headers.get("user-agent"),
            ip_address=request.client.host if request.client else None,
        )
        record_audit(db, actor_user_id=user.id, action="account_registered", resource_type="user", resource_id=user.id)
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account with that email already exists") from exc

    _set_session_cookies(response, raw_session, csrf_token)
    return {"user": public_user(user)}


@router.post("/organizer-applications", status_code=status.HTTP_201_CREATED)
def submit_organizer_application(
    payload: OrganizerApplicationIn,
    request: Request,
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    email = normalize_email(payload.email)
    client_ip = request.client.host if request.client else "unknown"
    try:
        enforce_account_registration_limit(db, email=email, client_ip=client_ip)
        db.commit()
    except RateLimitExceeded as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc

    existing_user = db.scalar(select(User).where(User.normalized_email == email))
    if existing_user is None:
        existing_user = db.scalar(select(User).where(User.email == email))
    if existing_user is not None:
        raise HTTPException(status_code=409, detail="An account with that email already exists")

    existing_application = db.scalar(
        select(OrganizerApplication).where(
            OrganizerApplication.normalized_email == email,
            OrganizerApplication.status == "pending",
        )
    )
    if existing_application is not None:
        raise HTTPException(status_code=409, detail="An organizer application is already pending for this email")

    try:
        application = OrganizerApplication(
            organization_name=payload.organization_name.strip(),
            applicant_name=payload.name.strip(),
            email=email,
            normalized_email=email,
            phone=payload.phone.strip() if payload.phone else None,
            normalized_phone=normalize_phone(payload.phone),
            password_hash=hash_password(payload.password),
            message=payload.message.strip() if payload.message else None,
            status="pending",
        )
        db.add(application)
        db.flush()
        record_audit(
            db,
            actor_user_id=None,
            action="organizer_application_submitted",
            resource_type="organizer_application",
            resource_id=application.id,
            metadata={"organization_name": application.organization_name},
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {
        "application": {
            "id": str(application.id),
            "organizationName": application.organization_name,
            "status": application.status,
        }
    }


@router.post("/login")
def login(
    payload: LoginIn,
    response: Response,
    request: Request,
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    email = normalize_email(payload.email)
    client_ip = request.client.host if request.client else "unknown"
    try:
        enforce_login_limit(db, email=email, client_ip=client_ip)
        db.commit()
    except RateLimitExceeded as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc

    user = db.scalar(select(User).where(User.normalized_email == email))
    if user is None:
        user = db.scalar(select(User).where(User.email == email))
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    raw_session, csrf_token = create_session(
        db,
        user,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    record_audit(db, actor_user_id=user.id, action="login_succeeded", resource_type="user", resource_id=user.id)
    db.commit()
    _set_session_cookies(response, raw_session, csrf_token)
    return {"user": public_user(user)}


@router.get("/me")
def me(user: User = Depends(get_current_user)) -> dict:
    return {"user": public_user(user)}


@router.post("/logout")
def logout(
    response: Response,
    request: Request,
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    revoke_session(db, request.cookies.get(SESSION_COOKIE))
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    return {"status": "ok"}
