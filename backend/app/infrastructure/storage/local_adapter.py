from __future__ import annotations

import hashlib
import hmac
import json
import time
from pathlib import Path
from secrets import token_hex
from typing import BinaryIO
from urllib.parse import quote

from app.services.storage_service import (
    StorageAccessError,
    StorageMetadata,
    StorageService,
    ensure_storage_root,
)


class LocalStorageAdapter(StorageService):
    """Development-only private storage with signed backend read URLs."""

    def __init__(self, root: str, public_base_url: str, signing_secret: str) -> None:
        if not signing_secret:
            raise ValueError("Local storage signing secret is required")
        self.root = ensure_storage_root(root)
        self.public_base_url = public_base_url.rstrip("/")
        self.signing_secret = signing_secret.encode("utf-8")

    def _safe_path(self, object_key: str) -> Path:
        path = (self.root / object_key).resolve()
        if self.root != path and self.root not in path.parents:
            raise StorageAccessError("Invalid storage object")
        return path

    def _signature(self, object_key: str, expires_at: int) -> str:
        material = f"{object_key}:{expires_at}".encode("utf-8")
        return hmac.new(self.signing_secret, material, hashlib.sha256).hexdigest()

    def put_private(self, file: BinaryIO, metadata: StorageMetadata) -> str:
        object_key = f"private/qr/{token_hex(16)}.{metadata.extension}"
        path = self._safe_path(object_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(f"{path.suffix}.tmp-{token_hex(6)}")
        temporary.write_bytes(file.read())
        temporary.replace(path)
        path.with_suffix(f"{path.suffix}.json").write_text(
            json.dumps({"content_type": metadata.content_type}), encoding="utf-8"
        )
        return object_key

    def get_read_url(self, object_key: str, expires_in: int) -> str:
        expires_at = int(time.time()) + expires_in
        signature = self._signature(object_key, expires_at)
        return (
            f"{self.public_base_url}/api/v1/storage/local/{quote(object_key, safe='/')}"
            f"?expires={expires_at}&signature={signature}"
        )

    def read_private(self, object_key: str, expires_at: int, signature: str) -> tuple[bytes, str]:
        if expires_at < int(time.time()) or not hmac.compare_digest(signature, self._signature(object_key, expires_at)):
            raise StorageAccessError("Signed storage URL is invalid or expired")
        path = self._safe_path(object_key)
        try:
            payload = path.read_bytes()
            metadata = json.loads(path.with_suffix(f"{path.suffix}.json").read_text(encoding="utf-8"))
        except (FileNotFoundError, OSError, ValueError, KeyError) as exc:
            raise StorageAccessError("Storage object not found") from exc
        return payload, str(metadata["content_type"])

    def remove(self, object_key: str) -> bool:
        path = self._safe_path(object_key)
        removed = False
        for candidate in (path, path.with_suffix(f"{path.suffix}.json")):
            try:
                candidate.unlink()
                removed = True
            except FileNotFoundError:
                continue
        return removed
