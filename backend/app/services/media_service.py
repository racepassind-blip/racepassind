from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.services.audit_service import record_audit
from app.services.image_validation import ImageValidationError, ValidatedImage, validate_image
from app.services.storage_service import StorageError, StorageMetadata, StorageService

MEDIA_REFERENCE_PREFIX = "storage://"


@dataclass(frozen=True)
class UploadedMedia:
    reference: str
    url: str
    content_type: str
    extension: str
    size_bytes: int
    width: int
    height: int


def media_reference(object_key: str) -> str:
    return f"{MEDIA_REFERENCE_PREFIX}{object_key}"


def object_key_from_reference(reference: str | None) -> str | None:
    if not reference or not reference.startswith(MEDIA_REFERENCE_PREFIX):
        return None
    return reference.removeprefix(MEDIA_REFERENCE_PREFIX)


def resolve_media_url(reference: str | None, storage: StorageService | None, ttl_seconds: int) -> str | None:
    if not reference:
        return None
    object_key = object_key_from_reference(reference)
    if object_key is None or storage is None:
        return reference
    return storage.get_read_url(object_key, ttl_seconds)


def _record_failure(
    db: Session,
    *,
    actor_user_id: UUID | None,
    owner_type: str,
    owner_id: UUID | str,
    purpose: str,
    stage: str,
    error: Exception,
    request_id: str | None,
    size_bytes: int | None = None,
) -> None:
    # Failure audit must survive rollback of the media/reference transaction.
    db.rollback()
    try:
        record_audit(
            db,
            actor_user_id=actor_user_id,
            action="media_upload_failed",
            resource_type=owner_type,
            resource_id=owner_id,
            metadata={
                "purpose": purpose,
                "stage": stage,
                "error_type": type(error).__name__,
                "error_message": str(error),
                "request_id": request_id,
                "size_bytes": size_bytes,
            },
        )
        db.commit()
    except Exception:
        db.rollback()


def upload_media(
    db: Session,
    *,
    owner: Any,
    owner_type: str,
    owner_id: UUID | str,
    reference_field: str,
    actor_user_id: UUID | None,
    payload: bytes,
    filename: str | None,
    content_type: str | None,
    purpose: str,
    storage: StorageService,
    max_upload_bytes: int,
    max_dimension: int,
    signed_url_ttl_seconds: int,
    request_id: str | None = None,
) -> UploadedMedia:
    try:
        validated: ValidatedImage = validate_image(
            payload,
            filename=filename,
            content_type=content_type,
            max_upload_bytes=max_upload_bytes,
            max_dimension=max_dimension,
        )
    except ImageValidationError as exc:
        _record_failure(
            db,
            actor_user_id=actor_user_id,
            owner_type=owner_type,
            owner_id=owner_id,
            purpose=purpose,
            stage="validation",
            error=exc,
            request_id=request_id,
            size_bytes=len(payload),
        )
        raise

    metadata = StorageMetadata(
        content_type=validated.content_type,
        extension=validated.extension,
        size_bytes=validated.size_bytes,
        width=validated.width,
        height=validated.height,
        purpose=purpose,
    )
    old_reference = getattr(owner, reference_field, None)
    old_object_key = object_key_from_reference(old_reference)
    try:
        new_object_key = storage.put_private(io.BytesIO(payload), metadata)
    except Exception as exc:
        error = StorageError("Media storage is unavailable")
        _record_failure(
            db,
            actor_user_id=actor_user_id,
            owner_type=owner_type,
            owner_id=owner_id,
            purpose=purpose,
            stage="storage_write",
            error=exc,
            request_id=request_id,
            size_bytes=validated.size_bytes,
        )
        raise error from exc

    new_reference = media_reference(new_object_key)
    try:
        setattr(owner, reference_field, new_reference)
        record_audit(
            db,
            actor_user_id=actor_user_id,
            action="media_uploaded",
            resource_type=owner_type,
            resource_id=owner_id,
            metadata={
                "purpose": purpose,
                "content_type": validated.content_type,
                "size_bytes": validated.size_bytes,
                "width": validated.width,
                "height": validated.height,
                "replaced": bool(old_object_key),
                "request_id": request_id,
            },
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        try:
            storage.remove(new_object_key)
        except Exception:
            pass
        _record_failure(
            db,
            actor_user_id=actor_user_id,
            owner_type=owner_type,
            owner_id=owner_id,
            purpose=purpose,
            stage="database_commit",
            error=exc,
            request_id=request_id,
            size_bytes=validated.size_bytes,
        )
        raise StorageError("Media upload could not be saved") from exc

    if old_object_key and old_object_key != new_object_key:
        try:
            storage.remove(old_object_key)
        except Exception as exc:
            try:
                record_audit(
                    db,
                    actor_user_id=actor_user_id,
                    action="media_delete_failed",
                    resource_type=owner_type,
                    resource_id=owner_id,
                    metadata={
                        "purpose": purpose,
                        "stage": "replace_cleanup",
                        "error_type": type(exc).__name__,
                        "request_id": request_id,
                    },
                )
                db.commit()
            except Exception:
                db.rollback()

    return UploadedMedia(
        reference=new_reference,
        url=storage.get_read_url(new_object_key, signed_url_ttl_seconds),
        content_type=validated.content_type,
        extension=validated.extension,
        size_bytes=validated.size_bytes,
        width=validated.width,
        height=validated.height,
    )


def validate_media_payload(payload: bytes, filename: str | None, content_type: str | None, max_upload_bytes: int, max_dimension: int) -> ValidatedImage:
    return validate_image(
        payload,
        filename=filename,
        content_type=content_type,
        max_upload_bytes=max_upload_bytes,
        max_dimension=max_dimension,
    )


def record_media_failure(
    db: Session,
    *,
    actor_user_id: UUID | None,
    owner_type: str,
    owner_id: UUID | str,
    purpose: str,
    stage: str,
    error: Exception,
    request_id: str | None = None,
    size_bytes: int | None = None,
) -> None:
    _record_failure(
        db,
        actor_user_id=actor_user_id,
        owner_type=owner_type,
        owner_id=owner_id,
        purpose=purpose,
        stage=stage,
        error=error,
        request_id=request_id,
        size_bytes=size_bytes,
    )
