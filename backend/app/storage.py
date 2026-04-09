from __future__ import annotations

import mimetypes
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import boto3

from .config import settings


@dataclass
class StoredAsset:
    storage_key: str
    public_url: str
    mime_type: str


class StorageBackend(Protocol):
    def save_bytes(self, storage_key: str, content: bytes, mime_type: str | None = None) -> StoredAsset:
        ...

    def delete(self, storage_key: str) -> None:
        ...

    def path_for(self, storage_key: str) -> Path | None:
        ...


class LocalStorageBackend:
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def save_bytes(self, storage_key: str, content: bytes, mime_type: str | None = None) -> StoredAsset:
        target = self.base_dir / storage_key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        guessed_type = mime_type or mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        return StoredAsset(
            storage_key=storage_key,
            public_url=f"{settings.api_prefix}/assets/{storage_key}",
            mime_type=guessed_type,
        )

    def delete(self, storage_key: str) -> None:
        target = self.base_dir / storage_key
        if target.exists():
            target.unlink()

    def path_for(self, storage_key: str) -> Path | None:
        return self.base_dir / storage_key


class S3StorageBackend:
    def __init__(self) -> None:
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url or None,
            region_name=None if settings.s3_region == "auto" else settings.s3_region,
            aws_access_key_id=settings.aws_access_key_id or None,
            aws_secret_access_key=settings.aws_secret_access_key or None,
        )

    def save_bytes(self, storage_key: str, content: bytes, mime_type: str | None = None) -> StoredAsset:
        guessed_type = mime_type or mimetypes.guess_type(storage_key)[0] or "application/octet-stream"
        self.client.put_object(
            Bucket=settings.s3_bucket,
            Key=storage_key,
            Body=content,
            ContentType=guessed_type,
        )
        public_base = settings.storage_public_base_url.rstrip("/")
        public_url = (
            f"{public_base}/{storage_key}"
            if public_base
            else f"{settings.api_prefix}/assets/{storage_key}"
        )
        return StoredAsset(storage_key=storage_key, public_url=public_url, mime_type=guessed_type)

    def delete(self, storage_key: str) -> None:
        self.client.delete_object(Bucket=settings.s3_bucket, Key=storage_key)

    def path_for(self, storage_key: str) -> Path | None:
        return None


def get_storage_backend() -> StorageBackend:
    if settings.storage_backend == "s3" and settings.s3_bucket:
        return S3StorageBackend()

    return LocalStorageBackend(settings.storage_dir)
