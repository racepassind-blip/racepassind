from __future__ import annotations

import io
import struct
import tempfile
import unittest
import uuid
import zlib
from types import SimpleNamespace
from unittest.mock import Mock

from app.infrastructure.storage.local_adapter import LocalStorageAdapter
from app.services.image_validation import ImageValidationError, validate_qr_image
from app.services.organization_qr_service import remove_organization_qr, upload_organization_qr
from app.services.storage_service import StorageAccessError, StorageMetadata


def _png_32() -> bytes:
    raw = b"".join(b"\x00" + b"\x00\x00\x00\x00" * 32 for _ in range(32))

    def chunk(name: bytes, value: bytes) -> bytes:
        return struct.pack(">I", len(value)) + name + value + struct.pack(">I", zlib.crc32(name + value) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 32, 32, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


_PNG_32 = _png_32()


class StorageServiceTests(unittest.TestCase):
    def test_local_private_write_signed_read_and_idempotent_remove(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            storage = LocalStorageAdapter(directory, "http://localhost:8000", "test-secret")
            metadata = StorageMetadata("image/png", "png", len(_PNG_32), 32, 32)
            object_key = storage.put_private(io.BytesIO(_PNG_32), metadata)
            self.assertTrue(object_key.startswith("private/qr/"))
            self.assertNotIn("Runner", object_key)
            url = storage.get_read_url(object_key, 120)
            self.assertIn("signature=", url)
            query = dict(part.split("=", 1) for part in url.split("?", 1)[1].split("&"))
            payload, content_type = storage.read_private(object_key, int(query["expires"]), query["signature"])
            self.assertEqual(payload, _PNG_32)
            self.assertEqual(content_type, "image/png")
            self.assertTrue(storage.remove(object_key))
            self.assertFalse(storage.remove(object_key))
            with self.assertRaises(StorageAccessError):
                storage.read_private(object_key, int(query["expires"]), query["signature"])

    def test_image_validation_rejects_bad_type_extension_size_and_dimensions(self) -> None:
        with self.assertRaises(ImageValidationError):
            validate_qr_image(_PNG_32, filename="qr.jpg", content_type="image/png", max_upload_bytes=100000, max_dimension=4096)
        with self.assertRaises(ImageValidationError):
            validate_qr_image(_PNG_32, filename="qr.png", content_type="image/png", max_upload_bytes=10, max_dimension=4096)
        with self.assertRaises(ImageValidationError):
            validate_qr_image(_PNG_32, filename="qr.png", content_type="image/gif", max_upload_bytes=100000, max_dimension=4096)

    def test_image_validation_accepts_bounded_png(self) -> None:
        validated = validate_qr_image(
            _PNG_32,
            filename="organizer-qr.png",
            content_type="image/png",
            max_upload_bytes=100000,
            max_dimension=4096,
        )
        self.assertEqual(validated.width, 32)
        self.assertEqual(validated.height, 32)


if __name__ == "__main__":
    unittest.main()


class FakeStorage:
    def __init__(self) -> None:
        self.objects = {"private/qr/old.png": _PNG_32}
        self.removed: list[str] = []

    def put_private(self, file, metadata):
        self.objects["private/qr/new.png"] = file.read()
        return "private/qr/new.png"

    def get_read_url(self, object_key, expires_in):
        return f"https://storage.test/{object_key}?expires={expires_in}"

    def remove(self, object_key):
        self.removed.append(object_key)
        return self.objects.pop(object_key, None) is not None


class OrganizationQrServiceTests(unittest.TestCase):
    def test_replacement_commits_new_object_then_cleans_old_and_clear_is_idempotent(self) -> None:
        storage = FakeStorage()
        event = SimpleNamespace(
            id=uuid.uuid4(),
            organization_id=uuid.uuid4(),
            payment_settings=SimpleNamespace(
                qr_image_object_key="private/qr/old.png",
                qr_image_url="https://legacy.invalid/qr.png",
            ),
        )
        db = Mock()
        uploaded = upload_organization_qr(
            db,
            event=event,
            actor_user_id=uuid.uuid4(),
            payload=_PNG_32,
            filename="replacement.png",
            content_type="image/png",
            storage=storage,
            max_upload_bytes=100000,
            max_dimension=4096,
            signed_url_ttl_seconds=900,
        )
        self.assertEqual(uploaded["eventId"], str(event.id))
        self.assertEqual(event.payment_settings.qr_image_object_key, "private/qr/new.png")
        self.assertEqual(storage.removed, ["private/qr/old.png"])
        self.assertIn("private/qr/new.png", storage.objects)

        removed = remove_organization_qr(
            db,
            event=event,
            actor_user_id=uuid.uuid4(),
            storage=storage,
            signed_url_ttl_seconds=900,
        )
        self.assertTrue(removed["removed"])
        self.assertNotIn("private/qr/new.png", storage.objects)
        self.assertTrue(remove_organization_qr(
            db,
            event=event,
            actor_user_id=uuid.uuid4(),
            storage=storage,
            signed_url_ttl_seconds=900,
        )["removed"])
