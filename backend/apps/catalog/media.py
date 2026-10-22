"""Product image uploads: strict validation, re-encoding, and object storage.

An uploaded file is treated as hostile until it has been turned into fresh pixels:

1. **Size.** At most ``MAX_IMAGE_UPLOAD_BYTES`` (checked before reading, and again after).
2. **Magic bytes.** Only JPEG, PNG and WebP signatures are accepted. The client's filename
   and declared content type are ignored, so SVG (which can carry script) and anything else
   is refused before a decoder sees it.
3. **Polyglots.** A file that is also something else is refused:
   - markup markers anywhere in it (``<script``, ``<svg``, ``<html``, ``<!doctype``,
     ``<?php``, ``%PDF-``, ``<iframe``);
   - bytes after the format's own end (after PNG ``IEND``, past the RIFF length of a WebP,
     after a JPEG's final ``FFD9``).
4. **Decode.** Pillow must fully decode the image. The pixel count is capped before
   decoding (no decompression bombs), and the decoder must agree with the magic bytes.
5. **Re-encode.** The pixels are re-encoded as WebP: oriented from EXIF, downscaled to
   ``MAX_IMAGE_EDGE``, with no EXIF, GPS, ICC, XMP or text chunks. Whatever survived steps
   1 to 4 cannot survive this.

Stored objects get random keys (``products/<id>/<uuid>.webp``) in a private bucket and are
served through the API (``/api/media/...``) with an explicit ``Content-Type``, ``nosniff``
and a CSP of ``default-src 'none'``. The bucket is never exposed to browsers.
"""

from __future__ import annotations

import hashlib
import io
import logging
import re
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from functools import cache
from typing import IO, Any

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from PIL import Image, ImageOps, UnidentifiedImageError

logger = logging.getLogger("securecart.media")

MEDIA_PREFIX = "/api/media/"
KEY_RE = re.compile(r"^products/\d{1,12}/[0-9a-f]{32}\.webp$")
_SIGNATURES = {
    "JPEG": (b"\xff\xd8\xff",),
    "PNG": (b"\x89PNG\r\n\x1a\n",),
}
# Long enough that random compressed pixel data matches about one in 2,500 maximum-size
# uploads (estimated); archives appended to an image are caught by the end-of-image check.
_FOREIGN_MARKERS = re.compile(rb"<script|<svg[\s>]|<html|<!doctype|<\?php|%PDF-|<iframe", re.I)


class InvalidImage(Exception):
    """The upload is not an acceptable image. The message is safe to show to the admin."""


@dataclass(frozen=True)
class ProcessedImage:
    data: bytes
    width: int
    height: int
    sha256: str
    content_type: str = "image/webp"


def _sniff(data: bytes) -> str:
    for fmt, prefixes in _SIGNATURES.items():
        if data.startswith(prefixes):
            return fmt
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "WEBP"
    raise InvalidImage("Upload a JPEG, PNG or WebP image.")


def _has_trailing_data(fmt: str, data: bytes) -> bool:
    if fmt == "PNG":
        end = data.rfind(b"IEND")
        return end < 0 or len(data) > end + 8  # chunk type (4) + CRC (4)
    if fmt == "WEBP":
        declared = int.from_bytes(data[4:8], "little") + 8
        return declared != len(data) and declared + 1 != len(data)  # odd sizes are padded
    return not data.rstrip(b"\x00").endswith(b"\xff\xd9")  # JPEG


def process(upload: IO[bytes] | bytes) -> ProcessedImage:
    """Validate an upload and return the re-encoded WebP, or raise ``InvalidImage``."""
    limit = settings.MAX_IMAGE_UPLOAD_BYTES
    data = upload if isinstance(upload, bytes) else upload.read(limit + 1)
    if len(data) > limit:
        raise InvalidImage(f"Images must be {limit // (1024 * 1024)} MB or smaller.")
    if not data:
        raise InvalidImage("The file is empty.")
    fmt = _sniff(data)
    if _FOREIGN_MARKERS.search(data):
        raise InvalidImage("This file contains more than an image and was refused.")
    if _has_trailing_data(fmt, data):
        raise InvalidImage("This file has data after the end of the image and was refused.")
    try:
        with Image.open(io.BytesIO(data)) as probe:
            if probe.format != fmt:
                raise InvalidImage("The file's contents do not match its type.")
            width, height = probe.size
            if width < 1 or height < 1 or width * height > settings.MAX_IMAGE_PIXELS:
                raise InvalidImage("The image dimensions are too large.")
            probe.seek(0)  # first frame only (animated images become stills)
            probe.load()
            image = ImageOps.exif_transpose(probe)
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
    except InvalidImage:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise InvalidImage("The image could not be read.") from exc
    edge = settings.MAX_IMAGE_EDGE
    image.thumbnail((edge, edge), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    # A fresh encode carries no metadata: exif, icc_profile and xmp are not passed through.
    image.save(out, format="WEBP", quality=85, method=4)
    encoded = out.getvalue()
    return ProcessedImage(
        data=encoded,
        width=image.width,
        height=image.height,
        sha256=hashlib.sha256(encoded).hexdigest(),
    )


def new_key(product_id: int) -> str:
    return f"products/{product_id}/{uuid.uuid4().hex}.webp"


def key_from_url(url: str) -> str | None:
    """The storage key behind one of our media URLs, or None for any other URL."""
    if not url.startswith(MEDIA_PREFIX):
        return None
    key = url[len(MEDIA_PREFIX) :]
    return key if KEY_RE.match(key) else None


# --------------------------------------------------------------------------------------
# Storage backends
# --------------------------------------------------------------------------------------


class MediaNotFound(Exception):
    pass


@dataclass(frozen=True)
class StoredObject:
    body: Any  # iterable of bytes
    length: int
    content_type: str


class MediaStorage(ABC):
    @abstractmethod
    def put(self, key: str, data: bytes, content_type: str) -> None: ...

    @abstractmethod
    def get(self, key: str) -> StoredObject: ...

    @abstractmethod
    def delete(self, key: str) -> None: ...


class MemoryStorage(MediaStorage):
    """In-process storage for tests and single-process development."""

    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.objects[key] = (data, content_type)

    def get(self, key: str) -> StoredObject:
        if key not in self.objects:
            raise MediaNotFound(key)
        data, content_type = self.objects[key]
        return StoredObject([data], len(data), content_type)

    def delete(self, key: str) -> None:
        self.objects.pop(key, None)


class S3Storage(MediaStorage):
    """Any S3 API: MinIO locally, S3 (or R2, GCS interop, ...) in production."""

    def __init__(self) -> None:
        import boto3  # noqa: PLC0415 - only needed when S3 is configured
        from botocore.config import Config  # noqa: PLC0415

        self.bucket = settings.MEDIA_S3_BUCKET
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.MEDIA_S3_ENDPOINT or None,
            region_name=settings.MEDIA_S3_REGION,
            aws_access_key_id=settings.MEDIA_S3_ACCESS_KEY or None,
            aws_secret_access_key=settings.MEDIA_S3_SECRET_KEY or None,
            config=Config(
                connect_timeout=3,
                read_timeout=10,
                retries={"max_attempts": 3, "mode": "standard"},
                s3={"addressing_style": "path"},
                signature_version="s3v4",
            ),
        )

    def ensure_bucket(self) -> None:
        from botocore.exceptions import ClientError  # noqa: PLC0415

        try:
            self.client.head_bucket(Bucket=self.bucket)
        except ClientError:
            self.client.create_bucket(Bucket=self.bucket)
            logger.info("created media bucket %s", self.bucket)

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            CacheControl="public, max-age=31536000, immutable",
        )

    def get(self, key: str) -> StoredObject:
        from botocore.exceptions import ClientError  # noqa: PLC0415

        try:
            obj = self.client.get_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchKey", "404"}:
                raise MediaNotFound(key) from exc
            raise
        return StoredObject(
            obj["Body"].iter_chunks(64 * 1024), int(obj["ContentLength"]), obj["ContentType"]
        )

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)


@cache
def _memory() -> MemoryStorage:
    return MemoryStorage()


@cache
def _s3() -> S3Storage:
    return S3Storage()


def storage() -> MediaStorage | None:
    """The configured backend, or None when uploads are disabled."""
    backend = settings.MEDIA_STORAGE
    if backend == "s3":
        return _s3()
    if backend == "memory":
        return _memory()
    if backend in {"", "disabled"}:
        return None
    raise ImproperlyConfigured("MEDIA_STORAGE must be 's3', 'memory' or 'disabled'.")
