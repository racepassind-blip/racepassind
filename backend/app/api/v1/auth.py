from __future__ import annotations

import secrets
import datetime as dt
import hashlib
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import CSRF_COOKIE, SESSION_COOKIE, get_current_user, require_csrf
from app.services.audit_service import record_audit
from app.config import get_settings
from app.services.auth_service import (
    create_session,
    hash_password,
    normalize_email,
    normalize_phone,
    public_user,
    revoke_session,
    validate_required_phone,
    verify_password,
)
from app.services.mfa_service import (
    decrypt_totp_secret,
    encrypt_totp_secret,
    generate_totp_secret,
    otpauth_uri,
    verify_totp_code,
)
from app.services.payment_service import generate_qr_data_url
from app.services.rate_limit_service import (
    RateLimitExceeded,
    enforce_account_registration_limit,
    enforce_login_limit,
    enforce_password_reset_attempt_limit,
    enforce_password_reset_request_limit,
)
from db import get_db
from models import AuthSession, Order, OrganizerApplication, PasswordResetToken, PushSubscription, Registration, User
from app.services.email_service import send_email

router = APIRouter()
PRIVACY_POLICY_VERSION = "2026-10-15"


@router.get("/csrf")
def csrf_token(request: Request, response: Response) -> dict:
    """Return a CSRF token the SPA can echo back in the X-CSRF-Token header.

    Needed for cross-site deployments where the frontend and backend are on
    different origins and the CSRF cookie is not readable by frontend JS.
    """
    from app.config import get_settings

    settings = get_settings()
    token = request.cookies.get(CSRF_COOKIE)
    if not token:
        token = secrets.token_urlsafe(32)
        response.set_cookie(
            CSRF_COOKIE,
            token,
            httponly=False,
            secure=settings.is_production,
            samesite="none" if settings.is_production else "lax",
            max_age=7 * 24 * 60 * 60,
            path="/",
        )
    return {"csrfToken": token}


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=320)
    phone: str | None = Field(default=None, max_length=32)
    password: str = Field(min_length=8, max_length=256)
    privacy_policy_accepted: Literal[True]


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=256)
    mfa_code: str | None = Field(default=None, min_length=6, max_length=6)


class MfaCodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=6)

class ForgotPasswordIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)

class ResetPasswordIn(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=8, max_length=256)


class OrganizerApplicationIn(BaseModel):
    organization_name: str = Field(min_length=2, max_length=160)
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=320)
    # Organizer onboarding requires a contact phone number.
    phone: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=8, max_length=256)
    privacy_policy_accepted: Literal[True]

    @field_validator("phone")
    @classmethod
    def _require_phone(cls, value: str) -> str:
        return validate_required_phone(value)


class DeleteAccountIn(BaseModel):
    password: str = Field(min_length=1, max_length=256)
    confirmation: Literal["DELETE"]


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
            privacy_policy_version=PRIVACY_POLICY_VERSION,
            privacy_policy_accepted_at=dt.datetime.now(dt.timezone.utc),
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
    return {"user": public_user(user), "csrfToken": csrf_token}


@router.post("/organizer-signup", status_code=status.HTTP_201_CREATED)
def organizer_signup(
    payload: OrganizerApplicationIn,
    request: Request,
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    """Submit an organizer application for admin review."""
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

    pending_application = db.scalar(select(OrganizerApplication.id).where(
        OrganizerApplication.normalized_email == email,
        OrganizerApplication.status == "pending",
    ))
    if pending_application is not None:
        raise HTTPException(status_code=409, detail="An organizer application for this email is already pending")

    try:
        application = OrganizerApplication(
            organization_name=payload.organization_name.strip(),
            applicant_name=payload.name.strip(),
            email=email,
            normalized_email=email,
            phone=payload.phone.strip() if payload.phone else None,
            normalized_phone=normalize_phone(payload.phone),
            password_hash=hash_password(payload.password),
            privacy_policy_version=PRIVACY_POLICY_VERSION,
            privacy_policy_accepted_at=dt.datetime.now(dt.timezone.utc),
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
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Could not submit organizer application") from exc

    return {"applicationId": str(application.id), "status": "pending"}


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

    if user.role == "admin" and get_settings().admin_mfa_enabled and user.mfa_enabled:
        secret = decrypt_totp_secret(user.mfa_secret_encrypted)
        if not verify_totp_code(secret, payload.mfa_code):
            raise HTTPException(status_code=401, detail="admin_mfa_required")

    raw_session, csrf_token = create_session(
        db,
        user,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    record_audit(db, actor_user_id=user.id, action="login_succeeded", resource_type="user", resource_id=user.id)
    db.commit()
    _set_session_cookies(response, raw_session, csrf_token)
    return {"user": public_user(user), "csrfToken": csrf_token}


@router.post("/forgot-password")
def forgot_password(payload: ForgotPasswordIn, request: Request, _: None = Depends(require_csrf), db: Session = Depends(get_db)) -> dict[str, str]:
    email = normalize_email(payload.email)
    client_ip = request.client.host if request.client else "unknown"
    try:
        enforce_password_reset_request_limit(db, email=email, client_ip=client_ip)
        db.commit()
    except RateLimitExceeded as exc:
        db.rollback()
        raise HTTPException(status_code=429, detail=str(exc), headers={"Retry-After": str(exc.retry_after_seconds)}) from exc
    user = db.scalar(select(User).where(User.normalized_email == email, User.is_active.is_(True)))
    if user is not None:
        raw = secrets.token_urlsafe(48)
        db.add(PasswordResetToken(user_id=user.id, token_hash=hashlib.sha256(raw.encode()).hexdigest(), expires_at=dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=30)))
        db.commit()
        base = str(request.base_url).rstrip("/")
        frontend = get_settings().frontend_origins[0] if get_settings().frontend_origins else base
        send_email(db, recipient=user.email, subject="Reset your SportPass password", body=f"Use this link within 30 minutes to reset your password: {frontend}/reset-password?token={raw}", email_type="PASSWORD_RESET")
    return {"message": "If an account exists for this email, you will receive a reset link shortly."}


@router.post("/reset-password")
def reset_password(payload: ResetPasswordIn, response: Response, request: Request, db: Session = Depends(get_db)) -> dict[str, str]:
    client_ip = request.client.host if request.client else "unknown"
    try:
        enforce_password_reset_attempt_limit(db, token=payload.token, client_ip=client_ip)
        db.commit()
    except RateLimitExceeded as exc:
        db.rollback()
        raise HTTPException(status_code=429, detail=str(exc), headers={"Retry-After": str(exc.retry_after_seconds)}) from exc
    now = dt.datetime.now(dt.timezone.utc)
    token = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == hashlib.sha256(payload.token.encode()).hexdigest(), PasswordResetToken.used_at.is_(None)).with_for_update())
    if token is None or token.expires_at <= now:
        raise HTTPException(status_code=400, detail="This reset link is invalid or expired")
    user = db.get(User, token.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=400, detail="This reset link is invalid or expired")
    user.password_hash = hash_password(payload.password)
    for active_token in db.scalars(select(PasswordResetToken).where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))).all():
        active_token.used_at = now
    for session in db.scalars(select(AuthSession).where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))).all():
        session.revoked_at = now
    db.commit()
    return {"message": "Password reset successfully. Please sign in again."}


@router.post("/admin/mfa/setup")
def setup_admin_mfa(
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    if user.mfa_enabled:
        raise HTTPException(status_code=409, detail="Admin MFA is already enabled")
    # Setup may be requested more than once (for example, React development
    # strict mode can replay effects). Reuse the pending secret so the QR code
    # displayed to the admin always matches the secret stored in the database.
    secret = decrypt_totp_secret(user.mfa_secret_encrypted)
    if not secret:
        secret = generate_totp_secret()
        user.mfa_secret_encrypted = encrypt_totp_secret(secret)
        db.commit()
    uri = otpauth_uri(secret, user.email)
    return {"secret": secret, "otpauthUri": uri, "qrDataUrl": generate_qr_data_url(uri)}


@router.post("/admin/mfa/verify")
def verify_admin_mfa(
    payload: MfaCodeIn,
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    secret = decrypt_totp_secret(user.mfa_secret_encrypted)
    if not verify_totp_code(secret, payload.code):
        raise HTTPException(status_code=422, detail="Invalid authenticator code")
    user.mfa_enabled = True
    db.commit()
    record_audit(db, actor_user_id=user.id, action="admin_mfa_enabled", resource_type="user", resource_id=user.id)
    db.commit()
    return {"user": public_user(user)}


@router.get("/me")
def me(request: Request, user: User = Depends(get_current_user)) -> dict:
    return {"user": public_user(user), "csrfToken": request.cookies.get(CSRF_COOKIE)}


@router.get("/data-export")
def export_my_data(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    """Return only data tied to the authenticated account for a portable copy."""
    registrations = db.execute(
        select(Registration, User)
        .join(User, User.id == Registration.user_id)
        .where(Registration.user_id == user.id)
    ).all()
    orders = db.scalars(select(Order).where(Order.user_id == user.id)).all()
    return {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "account": public_user(user),
        "privacy": {
            "policyVersion": user.privacy_policy_version,
            "acceptedAt": user.privacy_policy_accepted_at.isoformat() if user.privacy_policy_accepted_at else None,
        },
        "registrations": [
            {
                "id": str(registration.id),
                "eventId": str(registration.event_id),
                "ticketId": str(registration.ticket_id),
                "status": registration.status,
                "paymentStatus": registration.payment_status,
                "registrationReference": registration.registration_reference,
                "createdAt": registration.created_at.isoformat() if registration.created_at else None,
                "responses": registration.responses,
                "selections": registration.selections,
            }
            for registration, _ in registrations
        ],
        "orders": [
            {"id": str(order.id), "status": order.status, "currency": order.currency, "totalAmount": str(order.total_amount), "createdAt": order.created_at.isoformat() if order.created_at else None}
            for order in orders
        ],
    }


@router.delete("/me")
def delete_my_account(
    payload: DeleteAccountIn,
    response: Response,
    request: Request,
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    """Erase account identifiers and revoke access while preserving required records."""
    if user.role in {"admin", "organizer"}:
        raise HTTPException(status_code=409, detail="Organizer and admin accounts require a privacy request so event and financial obligations can be handled safely.")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect password")

    now = dt.datetime.now(dt.timezone.utc)
    erased_id = secrets.token_urlsafe(18).lower()
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == user.id))
    db.execute(delete(PushSubscription).where(PushSubscription.user_id == user.id))
    db.query(Registration).filter(Registration.user_id == user.id).update({Registration.user_id: None}, synchronize_session=False)
    db.query(Order).filter(Order.user_id == user.id).update({Order.user_id: None}, synchronize_session=False)
    user.name = "Deleted user"
    user.email = f"deleted-{erased_id}@erased.sportpass.invalid"
    user.normalized_email = user.email
    user.phone = None
    user.normalized_phone = None
    user.password_hash = hash_password(secrets.token_urlsafe(32))
    user.mfa_secret_encrypted = None
    user.mfa_enabled = False
    user.is_active = False
    user.deleted_at = now
    record_audit(db, actor_user_id=None, action="account_erased", resource_type="user", resource_id=user.id, metadata={"requested_at": now.isoformat()})
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    return {"status": "erased"}


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
