"""DRF throttles whose counting is atomic in Redis (``apps.core.ratelimit``).

Every throttle in the project derives from ``AtomicRateThrottle``: same rates, same cache
keys, same ``Retry-After`` semantics as DRF, but correct when several workers or replicas
share the limit. Without Redis they behave exactly like DRF's ``SimpleRateThrottle``.

If Redis is unreachable, ``fail_open`` decides: general limits let the request through
(availability), while the limits that guard credentials and outgoing email refuse it
(security). Either way the failure is logged.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from redis.exceptions import RedisError
from rest_framework import throttling

from apps.core import ratelimit

if TYPE_CHECKING:  # rest_framework.views imports this module through its settings
    from rest_framework.request import Request
    from rest_framework.views import APIView

logger = logging.getLogger("securecart.ratelimit")


class AtomicRateThrottle(throttling.SimpleRateThrottle):
    #: Allow requests through when Redis is down (False for security-critical limits).
    fail_open = True
    _retry_after: float | None = None

    def allow_request(self, request: Request, view: APIView) -> bool:
        if self.rate is None:
            return True
        key = self.get_cache_key(request, view)
        if key is None:
            return True
        return self.allow_key(key)

    def allow_key(self, key: str) -> bool:
        num_requests, duration = self.parse_rate(self.rate)
        limit, window = num_requests or 0, duration or 0
        backend = ratelimit.limiter()
        if backend is None:
            # Single-process fallback: DRF's own history list in the Django cache.
            self.key = key
            self.history = self.cache.get(self.key, [])
            self.now = self.timer()
            while self.history and self.history[-1] <= self.now - window:
                self.history.pop()
            if len(self.history) >= limit:
                return bool(self.throttle_failure())
            return bool(self.throttle_success())
        try:
            decision = backend.hit(key, limit, window)
        except RedisError as exc:
            logger.error("rate limiter unavailable scope=%s error=%s", self.scope, exc)
            self._retry_after = 1.0
            return self.fail_open
        self._retry_after = decision.retry_after
        return decision.allowed

    def wait(self) -> float | None:
        if self._retry_after is not None:
            return self._retry_after
        return super().wait()


class AnonRateThrottle(AtomicRateThrottle, throttling.AnonRateThrottle):
    """DRF's anonymous limit, counted atomically."""


class UserRateThrottle(AtomicRateThrottle, throttling.UserRateThrottle):
    """DRF's per-user limit, counted atomically."""
