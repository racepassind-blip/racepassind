from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ValidatedImage:
    content_type: str
    extension: str
    size_bytes: int
    width: int
    height: int


_ALLOWED = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
}


class ImageValidationError(ValueError):
    """Raised when an uploaded image is not a supported bounded QR image."""


def _dimensions(payload: bytes, content_type: str) -> tuple[int, int]:
    if content_type == "image/png":
        if len(payload) < 24 or payload[:8] != b"\x89PNG\r\n\x1a\n" or payload[12:16] != b"IHDR":
            raise ImageValidationError("The uploaded image is malformed")
        return int.from_bytes(payload[16:20], "big"), int.from_bytes(payload[20:24], "big")

    if content_type == "image/webp":
        if len(payload) < 30 or payload[:4] != b"RIFF" or payload[8:12] != b"WEBP":
            raise ImageValidationError("The uploaded image is malformed")
        if payload[12:16] == b"VP8X" and len(payload) >= 30:
            width = 1 + int.from_bytes(payload[24:27], "little")
            height = 1 + int.from_bytes(payload[27:30], "little")
            return width, height
        raise ImageValidationError("The uploaded WebP image format is unsupported")

    if len(payload) < 4 or payload[:2] != b"\xff\xd8":
        raise ImageValidationError("The uploaded image is malformed")
    index = 2
    while index + 9 < len(payload):
        if payload[index] != 0xFF:
            index += 1
            continue
        while index < len(payload) and payload[index] == 0xFF:
            index += 1
        if index >= len(payload):
            break
        marker = payload[index]
        index += 1
        if marker in {0xD8, 0xD9}:
            continue
        if index + 2 > len(payload):
            break
        segment_length = int.from_bytes(payload[index:index + 2], "big")
        if segment_length < 2 or index + segment_length > len(payload):
            break
        if marker in set(range(0xC0, 0xC4)) | set(range(0xC5, 0xC8)) | set(range(0xC9, 0xCC)) | set(range(0xCD, 0xD0)):
            if segment_length < 7:
                break
            height = int.from_bytes(payload[index + 3:index + 5], "big")
            width = int.from_bytes(payload[index + 5:index + 7], "big")
            return width, height
        index += segment_length
    raise ImageValidationError("The uploaded image dimensions could not be read")


def validate_qr_image(
    payload: bytes,
    *,
    filename: str | None,
    content_type: str | None,
    max_upload_bytes: int,
    max_dimension: int,
) -> ValidatedImage:
    normalized_type = (content_type or "").lower().split(";", 1)[0].strip()
    extension = _ALLOWED.get(normalized_type)
    if extension is None:
        raise ImageValidationError("Only PNG, JPEG, or WebP images are supported")
    if not filename or "." not in filename or filename.rsplit(".", 1)[1].lower() != extension:
        raise ImageValidationError("The file extension must match the image type")
    if not payload or len(payload) > max_upload_bytes:
        raise ImageValidationError(f"Image must be between 1 byte and {max_upload_bytes} bytes")

    width, height = _dimensions(payload, normalized_type)
    if width < 32 or height < 32 or width > max_dimension or height > max_dimension:
        raise ImageValidationError(f"Image dimensions must be between 32 and {max_dimension} pixels")
    return ValidatedImage(normalized_type, extension, len(payload), width, height)
