from __future__ import annotations

import secrets
import datetime as dt
import hashlib
import io
import re
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import CSRF_COOKIE, SESSION_COOKIE, get_client_ip, get_current_user, require_csrf
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
from app.infrastructure.storage.factory import get_storage_service
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


ORGANIZER_ID_PROOF_TYPES = {"PAN", "GST", "REGISTRATION_CERTIFICATE", "ASSOCIATION_ID", "OTHER"}
ORGANIZER_ID_PROOF_MIME = {"application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}


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
    client_ip = get_client_ip(request)
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
            ip_address=get_client_ip(request),
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
    request: Request,
    organization_name: str = Form(...), name: str = Form(...), email: str = Form(...), phone: str = Form(...),
    password: str = Form(...), privacy_policy_accepted: bool = Form(...), organization_type: str = Form(...),
    address: str = Form(...), city: str = Form(...), state: str = Form(...), pincode: str = Form(...),
    event_history: str = Form(...), discovery_source: str = Form(...), payment_preference: str = Form(...),
    id_proof_type: str = Form(...), id_proof: UploadFile = File(...),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
    upi_id: str = Form(""), payee_name: str = Form(""), legal_name: str = Form(""), pan_number: str = Form(""),
) -> dict:
    """Submit an organizer application for admin review."""
    try:
        payload = OrganizerApplicationIn(organization_name=organization_name.strip(), name=name.strip(), email=email, phone=phone,
            password=password, privacy_policy_accepted=privacy_policy_accepted)
    except ValidationError:
        raise HTTPException(422, "Check your contact details, password and privacy consent")
    for value, minimum, maximum in ((address, 5, 1000), (city, 2, 120), (state, 2, 120), (event_history, 10, 2000)):
        if not minimum <= len(value.strip()) <= maximum:
            raise HTTPException(422, "Enter your complete address and describe your event. Please stay within the character limits shown on the form.")
    if not re.fullmatch(r"[1-9][0-9]{5}", pincode.strip()):
        raise HTTPException(422, "Enter a valid six-digit PIN code")
    if discovery_source not in {"REFERRAL", "SOCIAL_MEDIA", "SEARCH", "EVENT", "OTHER"}:
        raise HTTPException(422, "Choose how you heard about SportPass")
    organization_type = organization_type.strip().upper()
    payment_preference = payment_preference.strip().upper()
    id_proof_type = id_proof_type.strip().upper()
    if organization_type not in {"RUNNING_CLUB", "CYCLING_CLUB", "TREK_ORGANIZER", "BADMINTON_ACADEMY", "SPORTS_ACADEMY", "OTHER"}:
        raise HTTPException(422, "Choose a valid organization type")
    if payment_preference not in {"DIRECT_UPI", "CASHFREE", "BOTH", "UNSURE"}:
        raise HTTPException(422, "Choose a valid payment preference")
    payment_details = {}
    if payment_preference in {"DIRECT_UPI", "BOTH"}:
        if not isinstance(upi_id, str) or not re.fullmatch(r"[A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64}", upi_id.strip()) or not 2 <= len(payee_name.strip()) <= 200:
            raise HTTPException(422, "Enter your UPI ID and payee name")
        payment_details.update({"upiId": upi_id.strip(), "payeeName": payee_name.strip()})
    if payment_preference in {"CASHFREE", "BOTH"}:
        if not isinstance(pan_number, str) or not re.fullmatch(r"[A-Z]{5}[0-9]{4}[A-Z]", pan_number.strip().upper()) or not 2 <= len(legal_name.strip()) <= 200:
            raise HTTPException(422, "Enter your legal name and valid PAN for gateway verification")
        payment_details.update({"legalName": legal_name.strip(), "panNumber": pan_number.strip().upper()})
    if id_proof_type not in ORGANIZER_ID_PROOF_TYPES:
        raise HTTPException(422, "Choose a valid ID proof type")
    settings = get_settings()
    proof_payload = id_proof.file.read(settings.storage_max_upload_bytes + 1)
    proof_type = (id_proof.content_type or "").lower()
    if not proof_payload or len(proof_payload) > settings.storage_max_upload_bytes or proof_type not in ORGANIZER_ID_PROOF_MIME:
        raise HTTPException(422, f"Upload a PDF, PNG, JPEG, or WebP ID proof up to {settings.storage_max_upload_bytes / 1_000_000:g} MB")
    if proof_type == "application/pdf" and not proof_payload.startswith(b"%PDF-"):
        raise HTTPException(422, "The uploaded PDF is invalid")
    if proof_type == "image/png" and not proof_payload.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(422, "The uploaded PNG is invalid")
    if proof_type == "image/jpeg" and not proof_payload.startswith(b"\xff\xd8\xff"):
        raise HTTPException(422, "The uploaded JPEG is invalid")
    if proof_type == "image/webp" and not (proof_payload.startswith(b"RIFF") and proof_payload[8:12] == b"WEBP"):
        raise HTTPException(422, "The uploaded WebP is invalid")
    email = normalize_email(payload.email)
    client_ip = get_client_ip(request)
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

    # Serialize submissions for the same email, including the first submission
    # where there is no application row to lock yet.
    if db.get_bind().dialect.name == "postgresql":
        lock_key = int.from_bytes(hashlib.sha256(("organizer-application:" + email).encode()).digest()[:8], "big", signed=True)
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
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

    previous = db.scalar(select(OrganizerApplication).where(OrganizerApplication.normalized_email == email).order_by(OrganizerApplication.created_at.desc()).with_for_update())
    if previous and (previous.status != "changes_requested" or not verify_password(payload.password, previous.password_hash)):
        raise HTTPException(409, "Sign in to check your application status. Resubmission requires a request for changes and your original password.")
    storage = get_storage_service()
    from app.services.storage_service import StorageMetadata
    try:
        object_key = storage.put_private(io.BytesIO(proof_payload), StorageMetadata(content_type=proof_type, extension=ORGANIZER_ID_PROOF_MIME[proof_type], size_bytes=len(proof_payload), width=0, height=0, purpose="organizer_application"))
    except Exception as exc:
        raise HTTPException(503, "ID proof storage is temporarily unavailable") from exc
    old_key = previous.id_proof_object_key if previous else None

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
            organization_type=organization_type, address=address.strip(), city=city.strip(), state=state.strip(), pincode=pincode.strip(),
            event_history=event_history.strip(), discovery_source=discovery_source.strip(), payment_preference=payment_preference,
            payment_details=payment_details,
            id_proof_type=id_proof_type, id_proof_filename=(id_proof.filename or "id-proof")[:255], id_proof_object_key=object_key,
            id_proof_content_type=proof_type, id_proof_size_bytes=len(proof_payload),
        )
        if previous:
            for column in ("organization_name", "applicant_name", "phone", "normalized_phone", "privacy_policy_version", "privacy_policy_accepted_at", "organization_type", "address", "city", "state", "pincode", "event_history", "discovery_source", "payment_preference", "id_proof_type", "id_proof_filename", "id_proof_object_key", "id_proof_content_type", "id_proof_size_bytes"):
                setattr(previous, column, getattr(application, column))
            application = previous
            application.payment_details = payment_details
            application.status = "pending"
            application.rejection_reason = None
        db.add(application)
        db.flush()
        record_audit(
            db,
            actor_user_id=None,
            action="organizer_application_resubmitted" if previous else "organizer_application_submitted",
            resource_type="organizer_application",
            resource_id=application.id,
            metadata={"organization_name": application.organization_name},
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        if object_key: storage.remove(object_key)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        if object_key: storage.remove(object_key)
        raise HTTPException(status_code=409, detail="Could not submit organizer application") from exc
    except Exception:
        db.rollback()
        try:
            storage.remove(object_key)
        except Exception:
            import logging
            logging.getLogger(__name__).warning("Could not clean up an uncommitted organizer proof")
        raise

    if old_key and old_key != object_key:
        try:
            storage.remove(old_key)
        except Exception:
            import logging
            logging.getLogger(__name__).warning("Could not remove superseded organizer proof for application %s", application.id)
    from app.api.v1.admin import notify_application_review
    notify_application_review(db, application)
    return {"applicationId": str(application.id), "status": "pending"}


@router.post("/organizer-application/status")
def organizer_application_status(payload: LoginIn, request: Request, response: Response,
    _: None = Depends(require_csrf), db: Session = Depends(get_db)) -> dict:
    email = normalize_email(payload.email)
    try:
        enforce_login_limit(db, email=email, client_ip=get_client_ip(request))
        db.commit()
    except RateLimitExceeded as exc:
        db.rollback()
        raise HTTPException(429, str(exc), headers={"Retry-After": str(exc.retry_after_seconds)}) from exc
    application = db.scalar(select(OrganizerApplication).where(OrganizerApplication.normalized_email == email).order_by(OrganizerApplication.created_at.desc()))
    user = db.get(User, application.approved_user_id) if application and application.approved_user_id else None
    if not application or not verify_password(payload.password, user.password_hash if user else application.password_hash):
        raise HTTPException(401, "Invalid email or password")
    from app.api.v1.admin import _serialize_organizer_application
    response.headers["Cache-Control"] = "no-store"
    return _serialize_organizer_application(application)


@router.get("/organizer-application/mine")
def my_organizer_application(response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    from app.api.v1.admin import _serialize_organizer_application
    application = db.scalar(select(OrganizerApplication).where(OrganizerApplication.approved_user_id == user.id))
    response.headers["Cache-Control"] = "no-store"
    return {"application": _serialize_organizer_application(application) if application else None}


@router.post("/login")
def login(
    payload: LoginIn,
    response: Response,
    request: Request,
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    email = normalize_email(payload.email)
    client_ip = get_client_ip(request)
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
        ip_address=get_client_ip(request),
    )
    record_audit(db, actor_user_id=user.id, action="login_succeeded", resource_type="user", resource_id=user.id)
    db.commit()
    _set_session_cookies(response, raw_session, csrf_token)
    return {"user": public_user(user), "csrfToken": csrf_token}


@router.post("/forgot-password")
def forgot_password(payload: ForgotPasswordIn, request: Request, _: None = Depends(require_csrf), db: Session = Depends(get_db)) -> dict[str, str]:
    email = normalize_email(payload.email)
    client_ip = get_client_ip(request)
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
    elif user is None:
        application = db.scalar(select(OrganizerApplication).where(OrganizerApplication.normalized_email == email,
            OrganizerApplication.status.in_(("pending", "changes_requested", "rejected"))).order_by(OrganizerApplication.created_at.desc()).with_for_update())
        if application:
            raw = secrets.token_urlsafe(48)
            application.recovery_token_hash = hashlib.sha256(raw.encode()).hexdigest()
            application.recovery_expires_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=30)
            db.commit()
            frontend = get_settings().frontend_origins[0] if get_settings().frontend_origins else str(request.base_url).rstrip("/")
            send_email(db, recipient=application.email, subject="Reset your SportPass application password",
                body=f"Use this link within 30 minutes: {frontend}/reset-password?token={raw}\nAfter resetting, track your application at {frontend}/signup?type=organizer&status=1",
                email_type="PASSWORD_RESET")
    return {"message": "If an account or application exists for this email, you will receive a reset link shortly."}


@router.post("/reset-password")
def reset_password(payload: ResetPasswordIn, response: Response, request: Request, db: Session = Depends(get_db)) -> dict[str, str]:
    client_ip = get_client_ip(request)
    try:
        enforce_password_reset_attempt_limit(db, token=payload.token, client_ip=client_ip)
        db.commit()
    except RateLimitExceeded as exc:
        db.rollback()
        raise HTTPException(status_code=429, detail=str(exc), headers={"Retry-After": str(exc.retry_after_seconds)}) from exc
    now = dt.datetime.now(dt.timezone.utc)
    token = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == hashlib.sha256(payload.token.encode()).hexdigest(), PasswordResetToken.used_at.is_(None)).with_for_update())
    if token is None:
        application = db.scalar(select(OrganizerApplication).where(OrganizerApplication.recovery_token_hash == hashlib.sha256(payload.token.encode()).hexdigest(),
            OrganizerApplication.status.in_(("pending", "changes_requested", "rejected"))).with_for_update())
        expires = application.recovery_expires_at if application else None
        if expires and expires.tzinfo is None:
            expires = expires.replace(tzinfo=dt.timezone.utc)
        if not application or not expires or expires <= now:
            raise HTTPException(400, "This reset link is invalid or expired")
        application.password_hash = hash_password(payload.password)
        application.recovery_token_hash = None
        application.recovery_expires_at = None
        record_audit(db, actor_user_id=None, action="organizer_application_password_reset", resource_type="organizer_application", resource_id=application.id)
        db.commit()
        return {"message": "Password reset successfully. Check your organizer application status.", "next": "/signup?type=organizer&status=1"}
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
