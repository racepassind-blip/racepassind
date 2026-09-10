from __future__ import annotations

from functools import lru_cache

from app.config import get_settings
from app.infrastructure.storage.local_adapter import LocalStorageAdapter
from app.infrastructure.storage.s3_compatible_adapter import S3CompatibleStorageAdapter
from app.services.storage_service import StorageService


@lru_cache(maxsize=1)
def get_storage_service() -> StorageService:
    settings = get_settings()
    if settings.storage_mode == "local":
        return LocalStorageAdapter(
            root=settings.storage_local_root,
            public_base_url=settings.storage_public_base_url,
            signing_secret=settings.ticket_signing_secret or "development-only-local-storage-secret",
        )
    return S3CompatibleStorageAdapter(
        endpoint=settings.storage_endpoint or "",
        bucket=settings.storage_bucket or "",
        region=settings.storage_region,
        access_key=settings.storage_access_key or "",
        secret_key=settings.storage_secret_key or "",
    )
