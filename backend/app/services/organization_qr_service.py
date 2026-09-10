from __future__ import annotations

import datetime as dt
import io
from uuid import UUID

from sqlalchemy.orm import Session

from app.services.audit_service import record_audit
from app.services.image_validation import ImageValidationError, validate_qr_image
from app.services.storage_service import StorageMetadata, StorageService
from models import Event, EventPaymentSettings


class OrganizationQrNotConfiguredError(ValueError):
    """Raised when an event has no payment settings to attach an uploaded QR to."""


def qr_image_response(settings: EventPaymentSettings | None, storage: StorageService, ttl_seconds: int) -> dict:
    if settings is None or not settings.qr_image_object_key:
        return {"qrImageUrl": None, "qrImageExpiresAt": None}
    expires_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=ttl_seconds)
    return {
        "qrImageUrl": storage.get_read_url(settings.qr_image_object_key, ttl_seconds),
        "qrImageExpiresAt": expires_at.isoformat(),
    }


def upload_organization_qr(
    db: Session,
    *,
    event: Event,
    actor_user_id: UUID,
    payload: bytes,
    filename: str | None,
    content_type: str | None,
    storage: StorageService,
    max_upload_bytes: int,
    max_dimension: int,
    signed_url_ttl_seconds: int,
) -> dict:
    settings = event.payment_settings
    if settings is None:
        raise OrganizationQrNotConfiguredError("Configure UPI payment settings before uploading a QR image")
    validated = validate_qr_image(
        payload,
        filename=filename,
        content_type=content_type,
        max_upload_bytes=max_upload_bytes,
        max_dimension=max_dimension,
    )
    metadata = StorageMetadata(
        content_type=validated.content_type,
        extension=validated.extension,
        size_bytes=validated.size_bytes,
        width=validated.width,
        height=validated.height,
    )
    old_object_key = settings.qr_image_object_key
    new_object_key = storage.put_private(io.BytesIO(payload), metadata)
    try:
        settings.qr_image_object_key = new_object_key
        settings.qr_image_url = None
        settings.qr_image_content_type = validated.content_type
        settings.qr_image_size_bytes = validated.size_bytes
        settings.qr_image_width = validated.width
        settings.qr_image_height = validated.height
        settings.qr_image_uploaded_at = dt.datetime.now(dt.timezone.utc)
        record_audit(
            db,
            actor_user_id=actor_user_id,
            action="organizer_qr_image_uploaded",
            resource_type="event",
            resource_id=event.id,
            metadata={
                "organization_id": str(event.organization_id),
                "content_type": validated.content_type,
                "size_bytes": validated.size_bytes,
                "width": validated.width,
                "height": validated.height,
                "replaced": bool(old_object_key),
            },
        )
        db.commit()
    except Exception:
        db.rollback()
        storage.remove(new_object_key)
        raise

    if old_object_key and old_object_key != new_object_key:
        try:
            storage.remove(old_object_key)
        except Exception:
            # The new database reference is authoritative; cleanup can be retried later.
            pass

    response = {"eventId": str(event.id), **qr_image_response(settings, storage, signed_url_ttl_seconds)}
    response["contentType"] = validated.content_type
    response["sizeBytes"] = validated.size_bytes
    response["width"] = validated.width
    response["height"] = validated.height
    return response


def remove_organization_qr(
    db: Session,
    *,
    event: Event,
    actor_user_id: UUID,
    storage: StorageService,
    signed_url_ttl_seconds: int,
) -> dict:
    settings = event.payment_settings
    if settings is None or not settings.qr_image_object_key:
        return {"eventId": str(event.id), "removed": True, "qrImageUrl": None, "qrImageExpiresAt": None}

    old_object_key = settings.qr_image_object_key
    settings.qr_image_object_key = None
    settings.qr_image_url = None
    settings.qr_image_content_type = None
    settings.qr_image_size_bytes = None
    settings.qr_image_width = None
    settings.qr_image_height = None
    settings.qr_image_uploaded_at = None
    record_audit(
        db,
        actor_user_id=actor_user_id,
        action="organizer_qr_image_removed",
        resource_type="event",
        resource_id=event.id,
        metadata={"organization_id": str(event.organization_id)},
    )
    db.commit()
    try:
        storage.remove(old_object_key)
    except Exception:
        pass
    return {"eventId": str(event.id), "removed": True, "qrImageUrl": None, "qrImageExpiresAt": None}
