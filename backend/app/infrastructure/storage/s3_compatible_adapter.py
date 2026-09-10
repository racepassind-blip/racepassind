from __future__ import annotations

from typing import BinaryIO
from uuid import uuid4

from app.services.storage_service import StorageConfigurationError, StorageMetadata, StorageService


class S3CompatibleStorageAdapter(StorageService):
    """S3-protocol adapter; provider SDK details stay isolated in infrastructure."""

    def __init__(self, *, endpoint: str, bucket: str, region: str, access_key: str, secret_key: str) -> None:
        try:
            import boto3
        except ImportError as exc:  # pragma: no cover - exercised by deployment configuration
            raise StorageConfigurationError("S3-compatible storage requires the boto3 dependency") from exc
        if not all((endpoint, bucket, region, access_key, secret_key)):
            raise StorageConfigurationError("S3-compatible storage configuration is incomplete")
        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
        )

    def put_private(self, file: BinaryIO, metadata: StorageMetadata) -> str:
        object_key = f"private/qr/{uuid4().hex}.{metadata.extension}"
        self.client.upload_fileobj(
            file,
            self.bucket,
            object_key,
            ExtraArgs={
                "ContentType": metadata.content_type,
                "Metadata": {
                    "width": str(metadata.width),
                    "height": str(metadata.height),
                },
            },
        )
        return object_key

    def get_read_url(self, object_key: str, expires_in: int) -> str:
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": object_key},
            ExpiresIn=expires_in,
        )

    def remove(self, object_key: str) -> bool:
        self.client.delete_object(Bucket=self.bucket, Key=object_key)
        return True
