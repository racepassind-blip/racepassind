from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, StrictInt
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_csrf, require_roles
from app.services.audit_service import record_audit
from app.services.auth_service import hash_password, normalize_email, normalize_phone, public_user
from app.services.organization_fee_service import (
    OrganizationFeeValidationError,
    OrganizationNotFoundError,
    serialize_organization_fee,
    update_organization_fee_settings,
)
from db import get_db
from models import Organization, OrganizationMember, User

router = APIRouter()


class OrganizerCreateIn(BaseModel):
    organization_name: str = Field(min_length=2, max_length=160)
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=320)
    phone: str | None = Field(default=None, max_length=32)
    temporary_password: str = Field(min_length=12, max_length=256)


class FeeSettingsIn(BaseModel):
    fee_type: Literal["none", "fixed_per_registration", "percentage"]
    fee_value_paise: StrictInt = Field(default=0, ge=0)
    fee_percentage_basis_points: StrictInt = Field(default=0, ge=0, le=10_000)


@router.post("/organizers", status_code=status.HTTP_201_CREATED)
def create_organizer(
    payload: OrganizerCreateIn,
    response: Response,
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    email = normalize_email(payload.email)
    if db.scalar(select(User).where(User.normalized_email == email)) is not None:
        raise HTTPException(status_code=409, detail="An account with that email already exists")

    organizer = User(
        name=payload.name.strip(),
        email=email,
        normalized_email=email,
        phone=payload.phone.strip() if payload.phone else None,
        normalized_phone=normalize_phone(payload.phone),
        password_hash=hash_password(payload.temporary_password),
        role="organizer",
        is_active=True,
    )
    organization = Organization(
        name=payload.organization_name.strip(),
        created_by=admin.id,
        status="active",
        fee_type="none",
        fee_value_paise=0,
        fee_percentage_basis_points=0,
    )
    db.add_all([organizer, organization])
    try:
        db.flush()
        db.add(OrganizationMember(organization_id=organization.id, user_id=organizer.id, member_role="organizer"))
        record_audit(
            db,
            actor_user_id=admin.id,
            action="organizer_created",
            resource_type="organization",
            resource_id=organization.id,
            metadata={"organization_status": organization.status},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Organizer could not be created") from exc

    return {
        "organizer": public_user(organizer),
        "organization": {"id": str(organization.id), "name": organization.name, "status": organization.status},
    }


@router.get("/organizers")
def list_organizers(
    _: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> list[dict]:
    organizations = db.scalars(select(Organization).order_by(Organization.created_at.desc())).all()
    return [serialize_organization_fee(organization) for organization in organizations]


@router.put("/organizers/{organization_id}/fee-settings")
def update_fee_settings(
    organization_id: UUID,
    payload: FeeSettingsIn,
    admin: User = Depends(require_roles("admin")),
    _: None = Depends(require_csrf),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return update_organization_fee_settings(
            db,
            organization_id=organization_id,
            actor_user_id=admin.id,
            fee_type=payload.fee_type,
            fee_value_paise=payload.fee_value_paise,
            fee_percentage_basis_points=payload.fee_percentage_basis_points,
        )
    except OrganizationNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found") from exc
    except OrganizationFeeValidationError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
