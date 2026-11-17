"""Acceso al bucket de Cloudflare R2 (API compatible con S3). Imágenes y pesos viven aquí."""
import os
import threading
import uuid
from pathlib import Path

import boto3
from botocore.config import Config

from .config import settings

_client = None
_lock = threading.Lock()


def client():
    global _client
    with _lock:
        if _client is None:
            _client = boto3.client(
                "s3",
                endpoint_url=settings.s3_endpoint,
                region_name=settings.s3_region,
                aws_access_key_id=settings.s3_access_key_id,
                aws_secret_access_key=settings.s3_secret_access_key,
                config=Config(signature_version="s3v4", retries={"max_attempts": 5, "mode": "standard"}),
            )
        return _client


def put_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    client().put_object(Bucket=settings.s3_bucket, Key=key, Body=data, ContentType=content_type)


def upload_file(path: str | Path, key: str) -> None:
    client().upload_file(str(path), settings.s3_bucket, key)


def get_bytes(key: str) -> bytes:
    return client().get_object(Bucket=settings.s3_bucket, Key=key)["Body"].read()


def cached_path(key: str) -> Path:
    """Descarga el objeto una sola vez a disco local (caché) y devuelve su ruta."""
    p = settings.cache_dir / "bucket" / key.lstrip("/")
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(p.name + f".{uuid.uuid4().hex}.part")
        client().download_file(settings.s3_bucket, key, str(tmp))
        os.replace(tmp, p)
    return p


def presign(key: str, seconds: int = 3600) -> str:
    return client().generate_presigned_url(
        "get_object", Params={"Bucket": settings.s3_bucket, "Key": key}, ExpiresIn=seconds
    )
