"""Catalog caching with write invalidation, and rate limits that hold across replicas."""

from __future__ import annotations

import os
import threading
import time
from collections.abc import Iterator
from decimal import Decimal
from typing import Any
from unittest import mock

import pytest
import redis
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.throttles import AuthRateThrottle
from apps.catalog import cache as catalog_cache
from apps.catalog.models import Product
from apps.core import ratelimit
from apps.core.throttling import AnonRateThrottle
from tests.conftest import add_to_cart, checkout

pytestmark = pytest.mark.django_db

REDIS_URL = os.environ.get("REDIS_URL", "")
needs_redis = pytest.mark.skipif(not REDIS_URL, reason="set REDIS_URL to run against Redis")
UNREACHABLE = "redis://127.0.0.1:9/0"


@pytest.fixture
def redis_settings() -> Iterator[None]:
    """Point the limiter and the Django cache at the real Redis from REDIS_URL."""
    ratelimit.redis_client.cache_clear()
    ratelimit.limiter.cache_clear()
    caches = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": REDIS_URL,
            "KEY_PREFIX": f"test-{os.getpid()}",
        }
    }
    with override_settings(REDIS_URL=REDIS_URL, CACHES=caches):
        cache.clear()
        client = ratelimit.redis_client()
        assert client is not None
        for key in client.scan_iter("securecart:rl:*"):
            client.delete(key)
        yield
        cache.clear()
    ratelimit.redis_client.cache_clear()
    ratelimit.limiter.cache_clear()


@pytest.fixture
def unreachable_redis() -> Iterator[None]:
    ratelimit.redis_client.cache_clear()
    ratelimit.limiter.cache_clear()
    with override_settings(REDIS_URL=UNREACHABLE, REDIS_TIMEOUT_SECONDS=0.2):
        yield
    ratelimit.redis_client.cache_clear()
    ratelimit.limiter.cache_clear()


def _get(client: APIClient, url: str) -> Any:
    response = client.get(url)
    assert response.status_code == 200
    return response


# ---------------------------------------------------------------------------------------
# Catalog cache (runs on the local-memory cache; the Redis variant is below)
# ---------------------------------------------------------------------------------------


class TestCatalogCache:
    def test_second_read_is_served_from_the_cache(self, api: APIClient, product: Product) -> None:
        assert _get(api, "/api/products/")["X-Cache"] == "MISS"
        assert _get(api, "/api/products/")["X-Cache"] == "HIT"
        assert _get(api, f"/api/products/{product.slug}/")["X-Cache"] == "MISS"
        assert _get(api, f"/api/products/{product.slug}/")["X-Cache"] == "HIT"
        assert _get(api, "/api/categories/")["X-Cache"] == "MISS"
        assert _get(api, "/api/categories/")["X-Cache"] == "HIT"

    def test_admin_edit_invalidates(
        self,
        api: APIClient,
        admin_api: APIClient,
        product: Product,
        django_capture_on_commit_callbacks: Any,
    ) -> None:
        _get(api, f"/api/products/{product.slug}/")
        with django_capture_on_commit_callbacks(execute=True):
            response = admin_api.patch(f"/api/admin/products/{product.pk}/", {"price": "42.00"})
        assert response.status_code == 200
        fresh = _get(api, f"/api/products/{product.slug}/")
        assert fresh["X-Cache"] == "MISS"
        assert fresh.data["price"] == "42.00"

    def test_hiding_a_product_removes_it_from_cached_lists(
        self, api: APIClient, product: Product, django_capture_on_commit_callbacks: Any
    ) -> None:
        assert _get(api, "/api/products/").data["count"] == 1
        with django_capture_on_commit_callbacks(execute=True):
            product.is_active = False
            product.save()
        assert _get(api, "/api/products/").data["count"] == 0

    def test_checkout_stock_change_invalidates(
        self,
        api: APIClient,
        customer_api: APIClient,
        customer: User,
        product: Product,
        django_capture_on_commit_callbacks: Any,
    ) -> None:
        assert _get(api, f"/api/products/{product.slug}/").data["stock"] == 10
        add_to_cart(customer, product, 3)
        with django_capture_on_commit_callbacks(execute=True):
            assert checkout(customer_api).status_code == 201
        assert _get(api, f"/api/products/{product.slug}/").data["stock"] == 7

    def test_nothing_is_invalidated_before_commit(self, product: Product) -> None:
        before = catalog_cache.version()
        product.name = "Renamed"
        product.save()  # inside the test transaction: the bump waits for commit
        assert catalog_cache.version() == before

    def test_unknown_parameters_share_one_entry(self, api: APIClient, product: Product) -> None:
        _get(api, "/api/products/?search=aurora")
        assert _get(api, "/api/products/?utm_source=x&search=aurora")["X-Cache"] == "HIT"
        assert _get(api, "/api/products/?search=other")["X-Cache"] == "MISS"

    def test_errors_are_never_cached(self, api: APIClient, product: Product) -> None:
        for _ in range(2):
            response = api.get("/api/products/missing/")
            assert response.status_code == 404
            assert response.get("X-Cache") != "HIT"

    def test_cache_outage_degrades_to_uncached(self, api: APIClient, product: Product) -> None:
        broken = mock.Mock()
        broken.get.side_effect = ConnectionError("down")
        broken.add.side_effect = ConnectionError("down")
        with mock.patch.object(catalog_cache, "cache", broken):
            response = api.get("/api/products/")
        assert response.status_code == 200
        assert response.data["count"] == 1
        assert "X-Cache" not in response

    def test_authenticated_and_anonymous_share_the_public_catalog(
        self, api: APIClient, customer_api: APIClient, product: Product
    ) -> None:
        _get(api, "/api/products/")
        assert _get(customer_api, "/api/products/")["X-Cache"] == "HIT"


# ---------------------------------------------------------------------------------------
# Throttles without Redis, and with Redis unreachable
# ---------------------------------------------------------------------------------------


class TestThrottleFallbacks:
    def test_credential_limits_fail_closed_when_redis_is_down(
        self, api: APIClient, customer: User, unreachable_redis: None
    ) -> None:
        with mock.patch.object(AuthRateThrottle, "get_rate", return_value="10/min"):
            response = api.post(
                "/api/auth/login/", {"email": customer.email, "password": "whatever"}
            )
        assert response.status_code == 429

    def test_general_limits_fail_open_when_redis_is_down(
        self, api: APIClient, product: Product, unreachable_redis: None
    ) -> None:
        with mock.patch.object(AnonRateThrottle, "get_rate", return_value="10/min"):
            assert api.get("/api/products/").status_code == 200

    def test_health_reports_redis_without_failing(
        self, api: APIClient, unreachable_redis: None
    ) -> None:
        response = api.get("/api/health/")
        assert response.status_code == 200
        assert response.data == {"status": "ok", "redis": "unavailable"}


# ---------------------------------------------------------------------------------------
# Against a real Redis (CI service container; locally `docker compose up redis`)
# ---------------------------------------------------------------------------------------


@needs_redis
@pytest.mark.redis
@pytest.mark.usefixtures("redis_settings")
class TestRedis:
    def test_limit_holds_across_replicas_under_contention(self) -> None:
        # Two "replicas": separate clients and limiters on one Redis, 40 concurrent requests,
        # limit 10. DRF's get-then-set history would let extra requests through here.
        replicas = [
            ratelimit.RedisLimiter(redis.Redis.from_url(REDIS_URL)),
            ratelimit.RedisLimiter(redis.Redis.from_url(REDIS_URL)),
        ]
        barrier = threading.Barrier(40)
        allowed: list[bool] = []
        lock = threading.Lock()

        def hit(i: int) -> None:
            barrier.wait()
            decision = replicas[i % 2].hit("contention", limit=10, window_seconds=60)
            with lock:
                allowed.append(decision.allowed)

        threads = [threading.Thread(target=hit, args=(i,)) for i in range(40)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        assert sum(allowed) == 10
        assert len(allowed) == 40

    def test_window_slides(self) -> None:
        limiter = ratelimit.limiter()
        assert limiter is not None
        assert limiter.hit("slide", 2, 1).allowed
        assert limiter.hit("slide", 2, 1).allowed
        denied = limiter.hit("slide", 2, 1)
        assert not denied.allowed
        assert 0 < denied.retry_after <= 1
        time.sleep(1.1)
        assert limiter.hit("slide", 2, 1).allowed

    def test_api_limit_and_retry_after(self, api: APIClient, customer: User) -> None:
        with mock.patch.object(AuthRateThrottle, "get_rate", return_value="3/min"):
            statuses = [
                api.post("/api/auth/login/", {"email": customer.email, "password": "x"})
                for _ in range(4)
            ]
        assert [r.status_code for r in statuses] == [401, 401, 401, 429]
        assert 0 < int(statuses[-1]["Retry-After"]) <= 60

    def test_catalog_cache_on_redis(
        self,
        api: APIClient,
        admin_api: APIClient,
        product: Product,
        django_capture_on_commit_callbacks: Any,
    ) -> None:
        assert _get(api, "/api/products/")["X-Cache"] == "MISS"
        assert _get(api, "/api/products/")["X-Cache"] == "HIT"
        with django_capture_on_commit_callbacks(execute=True):
            admin_api.patch(f"/api/admin/products/{product.pk}/", {"price": "33.00"})
        fresh = _get(api, "/api/products/")
        assert fresh["X-Cache"] == "MISS"
        assert fresh.data["results"][0]["price"] == "33.00"
        assert Decimal(fresh.data["results"][0]["price"]) == Decimal("33.00")

    def test_health_reports_redis(self, api: APIClient) -> None:
        assert api.get("/api/health/").data == {"status": "ok", "redis": "ok"}
