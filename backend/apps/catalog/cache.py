"""Server-side cache for the public catalog, invalidated by a version counter on every write.

Every cached response key embeds the current catalog version. Any change that can alter
what the catalog shows (a product or category saved or deleted, or stock reserved or
released by checkout) bumps the version **after its transaction commits**, so new reads
miss and recompute. Old entries are never served again and age out with
``CATALOG_CACHE_SECONDS``.

Why after commit: bumping first would let a reader pick up the new version, read the
not-yet-committed (old) rows and cache them under the new version. After commit, a reader
either still uses the old version (a key nobody reads once the bump lands) or sees the
committed data.

Keys are built only from the query parameters the catalog understands, so junk parameters
cannot multiply cache entries. A cache outage degrades to uncached responses.
"""

from __future__ import annotations

import hashlib
import logging
import time
from collections.abc import Callable
from urllib.parse import urlencode

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from rest_framework.request import Request
from rest_framework.response import Response

logger = logging.getLogger("securecart.cache")

VERSION_KEY = "catalog:version"
CACHEABLE_PARAMS = frozenset(
    {
        "search", "category", "min_price", "max_price", "in_stock", "featured", "ordering",
        "page", "page_size",
    }
)  # fmt: skip


def _fresh_version() -> int:
    return time.time_ns() // 1000


def version() -> int:
    try:
        current = cache.get(VERSION_KEY)
        if current is None:
            # Start from the clock, not 1: if the counter is ever evicted, the new one can
            # never collide with versions that still have live entries.
            cache.add(VERSION_KEY, _fresh_version(), timeout=None)
            current = cache.get(VERSION_KEY)
        return int(current) if current is not None else -1
    except Exception:
        logger.warning("catalog cache unavailable (version read)")
        return -1


def bump() -> None:
    try:
        try:
            cache.incr(VERSION_KEY)
        except ValueError:  # no counter yet (first write, or evicted)
            cache.add(VERSION_KEY, _fresh_version(), timeout=None)
    except Exception:
        logger.error("catalog cache invalidation failed; entries expire within the TTL")


def bump_after_commit() -> None:
    transaction.on_commit(bump)


def _key(request: Request, current: int) -> str:
    params = sorted(
        (k, v) for k, values in request.query_params.lists() if k in CACHEABLE_PARAMS
        for v in values
    )  # fmt: skip
    digest = hashlib.sha256(f"{request.path}?{urlencode(params)}".encode()).hexdigest()
    return f"catalog:v{current}:{digest}"


def cached(request: Request, compute: Callable[[], Response]) -> Response:
    """Serve ``compute()``'s 200 response from the cache when possible."""
    current = version()
    if current < 0 or request.method != "GET":
        return compute()
    key = _key(request, current)
    try:
        hit = cache.get(key)
    except Exception:
        hit = None
    if hit is not None:
        response = Response(hit)
        response["X-Cache"] = "HIT"
        return response
    response = compute()
    if response.status_code == 200:
        try:
            cache.set(key, response.data, timeout=settings.CATALOG_CACHE_SECONDS)
        except Exception:
            logger.warning("catalog cache unavailable (write)")
    response["X-Cache"] = "MISS"
    return response
