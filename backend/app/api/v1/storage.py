from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.infrastructure.storage.factory import get_storage_service
from app.infrastructure.storage.local_adapter import LocalStorageAdapter
from app.services.storage_service import StorageAccessError, StorageService

router = APIRouter()


@router.get("/local/{object_key:path}")
def read_local_private_object(
    object_key: str,
    expires: int = Query(gt=0),
    signature: str = Query(min_length=64, max_length=64),
    storage: StorageService = Depends(get_storage_service),
) -> Response:
    if not isinstance(storage, LocalStorageAdapter):
        raise HTTPException(status_code=404, detail="Storage object not found")
    try:
        payload, content_type = storage.read_private(object_key, expires, signature)
    except StorageAccessError as exc:
        raise HTTPException(status_code=404, detail="Storage object not found") from exc
    return Response(
        content=payload,
        media_type=content_type,
        headers={"Cache-Control": "private, max-age=60"},
    )
