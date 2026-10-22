# 0004. Redis for rate limits and the catalog cache; a lease-based scheduler

- Status: accepted
- Date: 2026-10-23

## Context

- **Throttle state** lived in Django's database cache. DRF's `SimpleRateThrottle` reads a
  client's request history, appends to it, and writes it back. Concurrent requests from one
  client, on different workers or replicas, overwrite each other's appends, so requests go
  uncounted. Measured on a shared Redis, with a limit of 10 and 40 simultaneous requests
  across two clients, that logic admitted **40 of 40 in each of 10 rounds**. The script
  that reimplements DRF's steps is quoted in the roadmap report.
- **The catalog** (`/api/products/`, product detail, categories) is read on every
  storefront page, and nothing cached it.
- **`expire_pending_orders`** existed only as a management command that "someone" had to
  schedule. With several API replicas, an in-process timer on each would run it N times.

## Options considered

**Rate limits.**
- Keep DRF's throttles on a Redis cache backend. Faster, but the same read-modify-write
  race.
- Fixed-window `INCR` + `EXPIRE`. Atomic, but it allows double the limit across a window
  boundary.
- **A sliding-window log in one Lua script (chosen).** A sorted set per key, run atomically
  by Redis using Redis's own clock (`TIME`), so replicas with skewed clocks agree. The
  limits are exact.

**Cache invalidation.**
- Per-key deletes on write. That needs a list of every key that might contain the changed
  product: every page, filter and search.
- TTL only. Shoppers would see stale stock for minutes after a checkout.
- **A version counter in every key, bumped after commit by every write (chosen).** That
  covers product and category saves and deletes (signals) and stock moves in checkout and
  the state machine, which use `UPDATE` and fire no signals. The TTL bounds memory.

**Scheduler.**
- A Kubernetes CronJob or host cron. Fine in Kubernetes, but it does nothing for compose or
  a VM, and it still needs overlap protection.
- A PostgreSQL advisory lock. It prevents overlap but not a second run in the same interval
  by an instance that ticks a moment later, and it is tied to one session's connection.
- A Redis lock. That puts correctness on a cache that is configured to evict.
- **A database lease row, the ShedLock pattern (chosen).** One conditional `UPDATE` per
  acquire, `lock_at_least_for` so each job runs once per interval across all instances, and
  `lock_at_most_for` so a crashed holder cannot wedge the job. It works on PostgreSQL and
  SQLite and needs no extra dependency.

## Decision

- **Redis 8 (`redis:8.8.3-alpine`) in compose**, configured as a cache:
  - no persistence, `maxmemory 64mb` with `allkeys-lru`;
  - password required (`REDIS_PASSWORD`);
  - non-root, read-only root filesystem, all capabilities dropped;
  - 0.5 s socket timeouts.
- **Every throttle derives from `AtomicRateThrottle`**, the project's own throttles and DRF's
  anonymous and user defaults alike. Same rates and keys, `Retry-After` computed from the
  oldest entry in the window, and DRF's original behaviour when no Redis is configured.
- **Behaviour when Redis is down.**
  - Credential and email limits fail **closed** (429): an outage must not unlock password
    guessing or mail floods.
  - General limits fail **open**.
  - `/api/health/` reports `"redis": "unavailable"` but stays 200. The API still works, so
    it should not be pulled from rotation.
- **The catalog cache** covers anonymous and authenticated GETs alike, because the public
  catalog is identical for both. Keys are built only from the query parameters the catalog
  understands, so junk parameters cannot multiply entries. Only 200 responses are cached,
  and an `X-Cache: HIT|MISS` header makes it observable. A cache outage degrades to
  uncached responses.
- **`run_scheduler`** is a long-running command run by its own compose service. It ticks
  every 15 s, writes a heartbeat file for its health check, stops cleanly on SIGTERM, and
  refreshes stale database connections between ticks. Its jobs:
  - `settle_pending_orders` (every 5 min) runs `expire_pending_orders`, including Stripe
    reconciliation;
  - `purge_expired_records` (hourly) drops expired one-time tokens, webhook ids older than
    30 days and expired refresh tokens.

## Consequences

- The stack gains two services: `redis`, and `scheduler`, which uses the API image.
  `REDIS_PASSWORD` becomes a required `.env` value, like the other secrets.
- Measured with the same setup as above, the Lua limiter admitted exactly 10 in each of
  10 rounds. A CI test with Redis as a service asserts this.
- With three scheduler replicas and a 30 s interval, the logs show one run per interval in
  total.
- Bumping the catalog version on every checkout lowers the hit rate under heavy buying.
  That is the price of never showing stale stock. The TTL (`CATALOG_CACHE_SECONDS`, 300)
  bounds how long an evicted version counter could matter, and versions start from the
  clock so they never repeat.
