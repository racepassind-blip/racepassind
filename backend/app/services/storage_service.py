from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Protocol


@dataclass(frozen=True)
class StorageMetadata:
    content_type: str
    extension: str
    size_bytes: int
    width: int
    height: int


class StorageService(Protocol):
    def put_private(self, file: BinaryIO, metadata: StorageMetadata) -> str:
        ...

    def get_read_url(self, object_key: str, expires_in: int) -> str:
        ...

    def remove(self, object_key: str) -> bool:
        ...


class StorageError(RuntimeError):
    """Base error for storage operations."""


class StorageConfigurationError(StorageError):
    """Raised when an adapter is not configured safely."""


class StorageAccessError(StorageError):
    """Raised when a signed private object cannot be read."""


def ensure_storage_root(root: str) -> Path:
    path = Path(root).expanduser().resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path
