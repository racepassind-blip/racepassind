from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_csrf, require_roles
from app.schemas.checkins import CheckinScanIn
from app.services.checkin_service import (
    CheckinCredentialError,
    CheckinNotAllowedError,
    check_in_registration,
)
from app.services.rate_limit_service import RateLimitExceeded, enforce_checkin_attempt_limit
from db import get_db
from models import User

router = APIRouter()


@router.post("/scan")
def scan_checkin(
    payload: CheckinScanIn,
    request: Request,
    user: User = Depends(require_roles("organizer", "admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    client_ip = request.client.host if request.client else "unknown"
    material = payload.credential or payload.registration_reference or ""
    try:
        enforce_checkin_attempt_limit(db, material=material, user_id=str(user.id), client_ip=client_ip)
        db.commit()
        return check_in_registration(
            db,
            user,
            credential=payload.credential,
            registration_reference=payload.registration_reference,
            device_info=request.headers.get("user-agent"),
        )
    except RateLimitExceeded as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    except IntegrityError:
        db.rollback()
        return check_in_registration(
            db,
            user,
            credential=payload.credential,
            registration_reference=payload.registration_reference,
            device_info=request.headers.get("user-agent"),
        )
    except CheckinCredentialError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Check-in credential invalid or not authorized") from exc
    except CheckinNotAllowedError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
