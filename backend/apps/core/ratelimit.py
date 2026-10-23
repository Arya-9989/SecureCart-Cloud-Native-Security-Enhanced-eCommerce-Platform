"""Atomic sliding-window rate limiting in Redis, correct across processes and replicas.

DRF's ``SimpleRateThrottle`` keeps each client's request history as a list in the cache and
updates it with ``get`` then ``set``. Two workers (or two replicas) handling the same client
at the same moment both read the old list, both append, and one write wins: requests go
uncounted and the limit is exceeded. Here the whole check-and-record step is one Lua script
that Redis runs atomically, so the limit holds however many replicas share the Redis:

- a sorted set per key holds one member per accepted request, scored by time;
- the script drops members older than the window, counts the rest, and adds the new
  request only if it is under the limit;
- time comes from Redis's own clock (``TIME``), so replicas with skewed clocks agree;
- the key expires with the window, so idle clients cost nothing.

Without ``REDIS_URL`` (development, single process) callers fall back to DRF's behaviour.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from functools import cache

import redis
from django.conf import settings

logger = logging.getLogger("securecart.ratelimit")

_SLIDING_WINDOW = """
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])
if count < limit then
  redis.call('ZADD', KEYS[1], now, ARGV[3])
  redis.call('PEXPIRE', KEYS[1], window)
  return {1, 0}
end
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local wait = window
if oldest[2] then wait = tonumber(oldest[2]) + window - now end
return {0, wait}
"""


@dataclass(frozen=True)
class Decision:
    allowed: bool
    retry_after: float  # seconds until a slot frees up (0 when allowed)


class RedisLimiter:
    def __init__(self, client: redis.Redis) -> None:
        self.client = client
        self.script = client.register_script(_SLIDING_WINDOW)

    def hit(self, key: str, limit: int, window_seconds: float) -> Decision:
        """Record one request for ``key`` if fewer than ``limit`` happened in the window."""
        if limit <= 0:
            return Decision(False, float(window_seconds))
        allowed, wait_ms = self.script(
            keys=[f"securecart:rl:{key}"],
            args=[int(window_seconds * 1000), limit, uuid.uuid4().hex],
        )
        return Decision(bool(allowed), max(0.0, int(wait_ms) / 1000))


@cache
def redis_client() -> redis.Redis | None:
    """A shared client for ``REDIS_URL`` (None when Redis is not configured)."""
    if not settings.REDIS_URL:
        return None
    return redis.Redis.from_url(
        settings.REDIS_URL,
        socket_connect_timeout=settings.REDIS_TIMEOUT_SECONDS,
        socket_timeout=settings.REDIS_TIMEOUT_SECONDS,
        health_check_interval=30,
    )


@cache
def limiter() -> RedisLimiter | None:
    client = redis_client()
    return RedisLimiter(client) if client is not None else None
