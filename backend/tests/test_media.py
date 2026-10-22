"""Product image uploads: validation, sanitisation, storage, serving and authorization."""

from __future__ import annotations

import io
import os
import struct
import zlib
from collections.abc import Iterator
from typing import Any

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.catalog import media
from apps.catalog.models import Product

pytestmark = pytest.mark.django_db

MINIO_URL = os.environ.get("MINIO_URL", "")


def image_bytes(fmt: str = "PNG", size: tuple[int, int] = (64, 48), **save: Any) -> bytes:
    buffer = io.BytesIO()
    mode = "RGBA" if fmt == "PNG" else "RGB"
    Image.new(mode, size, (200, 30, 60, 255) if mode == "RGBA" else (200, 30, 60)).save(
        buffer, format=fmt, **save
    )
    return buffer.getvalue()


def jpeg_with_gps() -> bytes:
    exif = Image.Exif()
    exif[0x010F] = "SpyCam Inc"  # Make
    exif[0x8825] = {1: "N", 2: (37.0, 46.0, 30.0), 3: "W", 4: (122.0, 25.0, 9.0)}  # GPSInfo
    return image_bytes("JPEG", exif=exif.tobytes())


def upload(client: APIClient, product: Product, data: bytes, name: str = "photo.png") -> Any:
    file = SimpleUploadedFile(name, data, content_type="image/png")
    return client.post(
        f"/api/admin/products/{product.pk}/image/", {"image": file}, format="multipart"
    )


@pytest.fixture
def store() -> Iterator[media.MemoryStorage]:
    media._memory.cache_clear()
    with override_settings(MEDIA_STORAGE="memory"):
        backend = media.storage()
        assert isinstance(backend, media.MemoryStorage)
        yield backend
    media._memory.cache_clear()


class TestValidation:
    @pytest.mark.parametrize("fmt", ["PNG", "JPEG", "WEBP"])
    def test_accepted_formats_are_reencoded_as_webp(self, fmt: str) -> None:
        processed = media.process(image_bytes(fmt))
        assert processed.data[:4] == b"RIFF"
        assert processed.data[8:12] == b"WEBP"
        assert (processed.width, processed.height) == (64, 48)

    def test_metadata_is_stripped(self) -> None:
        original = jpeg_with_gps()
        assert b"SpyCam" in original
        processed = media.process(original)
        assert b"SpyCam" not in processed.data
        with Image.open(io.BytesIO(processed.data)) as out:
            assert not out.getexif()
            assert "icc_profile" not in out.info

    def test_large_images_are_downscaled(self, settings: Any) -> None:
        settings.MAX_IMAGE_EDGE = 100
        processed = media.process(image_bytes("PNG", (400, 200)))
        assert (processed.width, processed.height) == (100, 50)

    @pytest.mark.parametrize(
        ("payload", "message"),
        [
            (b"", "empty"),
            (
                b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
                "JPEG, PNG or WebP",
            ),
            (b'<?xml version="1.0"?><svg onload="alert(1)"/>', "JPEG, PNG or WebP"),
            (b"<html><script>alert(1)</script></html>", "JPEG, PNG or WebP"),
            (b"GIF89a" + b"\x00" * 32, "JPEG, PNG or WebP"),
            (b"%PDF-1.7\n", "JPEG, PNG or WebP"),
            # PNG signature and end marker around garbage: plausible framing, undecodable body.
            (b"\x89PNG\r\n\x1a\n" + b"garbage" * 10 + b"IEND\xaeB`\x82", "could not be read"),
        ],
    )
    def test_non_images_are_refused(self, payload: bytes, message: str) -> None:
        with pytest.raises(media.InvalidImage, match=message):
            media.process(payload)

    def test_png_with_html_appended_is_a_polyglot(self) -> None:
        with pytest.raises(media.InvalidImage, match="data after the end"):
            media.process(image_bytes("PNG") + b"PK\x03\x04 zip archive follows")

    def test_jpeg_with_script_inside_a_comment_is_refused(self) -> None:
        data = image_bytes("JPEG")
        comment = b"<script>alert(document.cookie)</script>"
        segment = b"\xff\xfe" + struct.pack(">H", len(comment) + 2) + comment
        polyglot = data[:2] + segment + data[2:]
        with pytest.raises(media.InvalidImage, match="more than an image"):
            media.process(polyglot)

    def test_png_text_chunk_with_markup_is_refused(self) -> None:
        data = image_bytes("PNG")
        text = b"Comment\x00<html><body>hi</body></html>"
        chunk = struct.pack(">I", len(text)) + b"tEXt" + text
        chunk += struct.pack(">I", zlib.crc32(b"tEXt" + text) & 0xFFFFFFFF)
        polyglot = data[:33] + chunk + data[33:]  # after the IHDR chunk
        with pytest.raises(media.InvalidImage, match="more than an image"):
            media.process(polyglot)

    def test_webp_with_trailing_bytes_is_refused(self) -> None:
        with pytest.raises(media.InvalidImage, match="data after the end"):
            media.process(image_bytes("WEBP") + b"\x00trailing payload")

    def test_jpeg_with_trailing_data_is_refused(self) -> None:
        with pytest.raises(media.InvalidImage, match="data after the end"):
            media.process(image_bytes("JPEG") + b"<?= trailing ?>")

    def test_magic_bytes_must_match_the_decoder(self) -> None:
        # A JPEG signature in front of a PNG body.
        forged = b"\xff\xd8\xff" + image_bytes("PNG")[3:] + b"\xff\xd9"
        with pytest.raises(media.InvalidImage):
            media.process(forged)

    def test_decompression_bombs_are_refused(self, settings: Any) -> None:
        settings.MAX_IMAGE_PIXELS = 1000
        with pytest.raises(media.InvalidImage, match="too large"):
            media.process(image_bytes("PNG", (100, 100)))

    def test_size_limit(self, settings: Any) -> None:
        settings.MAX_IMAGE_UPLOAD_BYTES = 100
        with pytest.raises(media.InvalidImage, match="MB or smaller"):
            media.process(image_bytes("PNG", (200, 200)) + b"x" * 200)

    @pytest.mark.parametrize(
        ("url", "key"),
        [
            ("/api/media/products/7/" + "a" * 32 + ".webp", "products/7/" + "a" * 32 + ".webp"),
            ("/api/media/products/7/../../secrets.webp", None),
            ("/products/aurora.svg", None),
            ("https://evil.example/x.webp", None),
        ],
    )
    def test_only_our_keys_are_recognised(self, url: str, key: str | None) -> None:
        assert media.key_from_url(url) == key


class TestUploadEndpoint:
    def test_admin_upload_stores_a_sanitised_webp(
        self, admin_api: APIClient, product: Product, store: media.MemoryStorage
    ) -> None:
        response = upload(admin_api, product, jpeg_with_gps(), name="../../etc/passwd.svg")
        assert response.status_code == 200, response.data
        product.refresh_from_db()
        assert product.image_url.startswith("/api/media/products/")
        assert response.data["image_url"] == product.image_url
        key = media.key_from_url(product.image_url)
        assert key is not None
        data, content_type = store.objects[key]
        assert content_type == "image/webp"
        assert b"SpyCam" not in data
        entry = AuditLog.objects.get(action="admin.product.image_uploaded")
        assert entry.changes["bytes"] == len(data)
        assert "image_url" in entry.changes

    def test_replacing_an_image_deletes_the_old_object(
        self,
        admin_api: APIClient,
        product: Product,
        store: media.MemoryStorage,
        django_capture_on_commit_callbacks: Any,
    ) -> None:
        with django_capture_on_commit_callbacks(execute=True):
            upload(admin_api, product, image_bytes())
            first = media.key_from_url(Product.objects.get(pk=product.pk).image_url)
            upload(admin_api, product, image_bytes("JPEG"))
        assert first not in store.objects
        assert len(store.objects) == 1

    def test_rejected_upload_changes_nothing(
        self, admin_api: APIClient, product: Product, store: media.MemoryStorage
    ) -> None:
        before = product.image_url
        response = upload(admin_api, product, b"<svg onload=alert(1)>", name="x.png")
        assert response.status_code == 400
        assert response.data["error"]["fields"]["image"] == ["Upload a JPEG, PNG or WebP image."]
        product.refresh_from_db()
        assert product.image_url == before
        assert store.objects == {}

    def test_missing_file(self, admin_api: APIClient, product: Product, store: Any) -> None:
        response = admin_api.post(
            f"/api/admin/products/{product.pk}/image/", {}, format="multipart"
        )
        assert response.status_code == 400

    def test_oversized_upload_is_refused_before_processing(
        self, admin_api: APIClient, product: Product, store: Any, settings: Any
    ) -> None:
        settings.MAX_IMAGE_UPLOAD_BYTES = 1024
        response = upload(admin_api, product, image_bytes("PNG") + b"\x00" * 200_000)
        assert response.status_code == 413
        assert store.objects == {}

    def test_uploads_disabled(self, admin_api: APIClient, product: Product) -> None:
        with override_settings(MEDIA_STORAGE="disabled"):
            response = upload(admin_api, product, image_bytes())
        assert response.status_code == 503

    def test_customers_cannot_upload(
        self, customer_api: APIClient, product: Product, store: media.MemoryStorage
    ) -> None:
        response = upload(customer_api, product, image_bytes())
        assert response.status_code == 403
        assert store.objects == {}

    def test_anonymous_cannot_upload(
        self, api: APIClient, product: Product, store: media.MemoryStorage
    ) -> None:
        assert upload(api, product, image_bytes()).status_code == 401
        assert store.objects == {}

    def test_unknown_product(self, admin_api: APIClient, store: Any) -> None:
        response = admin_api.post(
            "/api/admin/products/999999/image/",
            {"image": SimpleUploadedFile("a.png", image_bytes())},
            format="multipart",
        )
        assert response.status_code == 404


class TestServing:
    def test_served_with_hardened_headers(
        self, admin_api: APIClient, api: APIClient, product: Product, store: Any
    ) -> None:
        upload(admin_api, product, image_bytes())
        product.refresh_from_db()
        response = api.get(product.image_url)
        assert response.status_code == 200
        assert response["Content-Type"] == "image/webp"
        assert response["X-Content-Type-Options"] == "nosniff"
        assert response["Content-Security-Policy"] == "default-src 'none'; sandbox"
        assert response["Cache-Control"] == "public, max-age=31536000, immutable"
        body = b"".join(response.streaming_content)  # type: ignore[attr-defined]
        assert body[:4] == b"RIFF"

    @pytest.mark.parametrize(
        "path",
        [
            "products/1/" + "0" * 32 + ".webp",  # well-formed but absent
            "products/1/../../etc/passwd",
            "products/1/" + "0" * 32 + ".svg",
            "%2e%2e/%2e%2e/settings.py",
        ],
    )
    def test_anything_else_is_not_found(self, api: APIClient, store: Any, path: str) -> None:
        assert api.get(f"/api/media/{path}").status_code == 404

    def test_only_safe_methods(self, api: APIClient, store: Any) -> None:
        assert api.post("/api/media/products/1/" + "0" * 32 + ".webp").status_code == 405

    def test_objects_not_written_by_the_pipeline_are_never_served(
        self, api: APIClient, store: media.MemoryStorage
    ) -> None:
        key = "products/1/" + "f" * 32 + ".webp"
        store.objects[key] = (b"<script>alert(1)</script>", "text/html")
        assert api.get(f"/api/media/{key}").status_code == 404


@pytest.mark.skipif(not MINIO_URL, reason="set MINIO_URL to run against MinIO")
class TestMinio:
    @pytest.fixture
    def s3(self) -> Iterator[media.S3Storage]:
        media._s3.cache_clear()
        with override_settings(
            MEDIA_STORAGE="s3",
            MEDIA_S3_ENDPOINT=MINIO_URL,
            MEDIA_S3_BUCKET=f"test-media-{os.getpid()}",
            MEDIA_S3_ACCESS_KEY=os.environ.get("MINIO_ACCESS_KEY", "minioadmin"),
            MEDIA_S3_SECRET_KEY=os.environ.get("MINIO_SECRET_KEY", "minioadmin"),
        ):
            backend = media.storage()
            assert isinstance(backend, media.S3Storage)
            backend.ensure_bucket()
            yield backend
        media._s3.cache_clear()

    def test_round_trip_through_the_api(
        self, s3: media.S3Storage, admin_api: APIClient, api: APIClient, product: Product
    ) -> None:
        assert upload(admin_api, product, jpeg_with_gps()).status_code == 200
        product.refresh_from_db()
        response = api.get(product.image_url)
        assert response.status_code == 200
        body = b"".join(response.streaming_content)  # type: ignore[attr-defined]
        assert body[8:12] == b"WEBP"
        assert b"SpyCam" not in body
        key = media.key_from_url(product.image_url)
        assert key is not None
        head = s3.client.head_object(Bucket=s3.bucket, Key=key)
        assert head["ContentType"] == "image/webp"

    def test_missing_object_is_not_found(self, s3: media.S3Storage, api: APIClient) -> None:
        assert api.get("/api/media/products/1/" + "0" * 32 + ".webp").status_code == 404

    def test_bucket_is_private(
        self, s3: media.S3Storage, admin_api: APIClient, product: Product
    ) -> None:
        import urllib.error  # noqa: PLC0415
        import urllib.request  # noqa: PLC0415

        upload(admin_api, product, image_bytes())
        product.refresh_from_db()
        key = media.key_from_url(product.image_url)
        with pytest.raises(urllib.error.HTTPError) as denied:
            urllib.request.urlopen(f"{MINIO_URL}/{s3.bucket}/{key}", timeout=5)  # noqa: S310
        assert denied.value.code == 403

    def test_init_command_is_idempotent(self, s3: media.S3Storage) -> None:
        from django.core.management import call_command  # noqa: PLC0415

        out = io.StringIO()
        call_command("init_media_storage", stdout=out)
        call_command("init_media_storage", stdout=out)
        assert "is ready" in out.getvalue()
