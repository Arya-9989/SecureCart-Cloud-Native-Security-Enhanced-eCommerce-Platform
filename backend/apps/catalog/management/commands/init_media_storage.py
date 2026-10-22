"""Create the private media bucket if it does not exist yet (idempotent)."""

from __future__ import annotations

import time
from typing import Any

from botocore.exceptions import BotoCoreError, ClientError
from django.core.management.base import BaseCommand, CommandError

from apps.catalog import media


class Command(BaseCommand):
    help = "Ensure the product-image bucket exists (MEDIA_STORAGE=s3 only)."

    def handle(self, *args: Any, **options: Any) -> None:
        backend = media.storage()
        if not isinstance(backend, media.S3Storage):
            self.stdout.write("Media storage is not S3; nothing to do.")
            return
        # The object store may still be starting (compose starts it alongside the API).
        for attempt in range(1, 11):
            try:
                backend.ensure_bucket()
            except (BotoCoreError, ClientError) as exc:
                if attempt == 10:
                    raise CommandError(f"Media storage unreachable: {exc}") from exc
                time.sleep(2)
                continue
            break
        self.stdout.write(f"Media bucket '{backend.bucket}' is ready.")
