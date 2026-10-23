<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/hero-dark.svg">
  <img src="docs/hero-light.svg" alt="SecureCart: Good things, bought safely. Trust-first commerce with httpOnly rotating refresh tokens, RBAC, oversell-proof checkout, idempotent payments, an audit log and a strict CSP.">
</picture>

# SecureCart

[![CI](https://github.com/Arya-9989/SecureCart-Cloud-Native-Security-Enhanced-eCommerce-Platform/actions/workflows/ci.yml/badge.svg)](https://github.com/Arya-9989/SecureCart-Cloud-Native-Security-Enhanced-eCommerce-Platform/actions/workflows/ci.yml)
![Python 3.12](https://img.shields.io/badge/python-3.12-3776ab)
![Django 5.2 LTS](https://img.shields.io/badge/django-5.2_LTS-0c4b33)
![React 19](https://img.shields.io/badge/react-19-149eca)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

**A security-first e-commerce platform: a Django REST API and a React storefront with an admin console, built so that the hard parts (sessions, authorization, inventory under concurrency, payments) are handled correctly.**

Customers browse a catalog, manage a server-side cart, check out and track orders. Administrators manage products, inventory, users and fulfilment from a dashboard, and every privileged action lands in an audit log. The whole stack runs in Docker behind nginx with one command.

![Storefront home page](docs/screenshots/home.png)

<table>
  <tr>
    <td><img src="docs/screenshots/admin-dashboard.png" alt="Admin dashboard with revenue chart"></td>
    <td><img src="docs/screenshots/checkout.png" alt="Checkout page"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/order-confirmation.png" alt="Order confirmation with status tracker"></td>
    <td><img src="docs/screenshots/admin-dashboard-dark.png" alt="Admin dashboard in dark mode"></td>
  </tr>
</table>

<p align="center">
  <img src="docs/screenshots/mobile-home.png" width="230" alt="Mobile home page">
  <img src="docs/screenshots/mobile-product.png" width="230" alt="Mobile product page">
  <img src="docs/screenshots/mobile-admin.png" width="230" alt="Mobile admin dashboard">
</p>

More screenshots: [account settings](docs/screenshots/account.png) · [password reset](docs/screenshots/forgot-password.png) · [product image upload](docs/screenshots/admin-product-image.png) · [how your order is protected](docs/screenshots/protection.png) ([the four-moments story, scrolling](docs/screenshots/protection-story.gif)) · [shop](docs/screenshots/shop.png) · [product](docs/screenshots/product.png) · [bag](docs/screenshots/cart.png) · [order history](docs/screenshots/orders.png) · [sign in](docs/screenshots/login.png) · [admin products](docs/screenshots/admin-products.png) · [product editor](docs/screenshots/admin-product-edit.png) · [order fulfilment](docs/screenshots/admin-order-detail.png) · [audit log](docs/screenshots/admin-audit-log.png) · [dark mode](docs/screenshots/home-dark.png)

> All screenshots are captured from the Docker stack by [`scripts/screenshots.py`](scripts/screenshots.py), which drives the real UI against the seeded demo data. Product images are original SVGs drawn by [`scripts/generate_product_art.py`](scripts/generate_product_art.py).

---

## Features

**Storefront**
- Catalog with categories, search (name, description, SKU, category), price and availability filters, sorting and pagination, all reflected in the URL.
- Product pages with stock indicators ("Only 3 left", "Sold out") and related products.
- Server-side bag (cart) that follows the customer across devices, with per-line limits checked against live stock; previewed from the nav as a popover on desktop and a drawer on mobile.
- Checkout with address validation, a free-shipping threshold and tax, and a pluggable payment provider: an offline mock by default, or **Stripe in test mode** (PaymentIntents confirmed by signed webhooks; the order page waits for the confirmation).
- Order history and detail with a status tracker, event timeline and self-service cancellation before shipping (restock and refund), plus a PDF invoice for every paid order, rendered on the server from the order's own snapshot.
- Registration and sign-in, light/dark themes, responsive layouts, and loading, empty and error states throughout.
- Public pages (home, shop and each category, `/protection` and every product) are prerendered at build time and hydrated, so they read completely before, or without, any JavaScript.
- An account page: change your name or password, see whether your email is confirmed, sign out on every device at once, download a copy of your data (JSON), and delete the account. Deletion anonymises it; orders are kept for invoicing.
- Email confirmation and password reset by emailed one-time link. Checkout waits for a confirmed address; the bag and checkout say why and offer a fresh link.
- A "How your order is protected" page (`/protection`), told as four moments that light up stage by stage as you scroll, and quiet trust cues at sign-in, bag, checkout and order confirmation. Every statement describes a mechanism in this codebase and links to it; the copy lives in one file (`frontend/src/lib/protection.ts`).

**Design**: Apple Store calm on white and `#f5f5f7` with one deep-blue accent, Inter with optical sizing, designed light and dark themes, WCAG AA contrast throughout, and touch targets of at least 24px everywhere (WCAG 2.5.8) with 44px header controls and footer rows on phones. Product images are original SVG illustrations lit as one studio set, with one camera rule: standing products at eye level, desk objects from about 30° above.

**Motion**: quiet and purposeful, with no animation library. `/protection` pins a four-moments story (sign-in, bag, checkout, after you order) whose stages light up along a rail as you scroll, and the checkout chapter's four steps light up in order; the local nav's underline slides between sections; on the home page the lead product steps forward as the page scrolls; a product card morphs into its product page (View Transitions); adding to the bag changes the pressed button to "Added" and the nav's bag icon acknowledges it; the admin revenue line draws in and its bars grow. Scroll-linked motion uses CSS scroll-driven animations, with a small scripted fallback where they are missing. Only opacity and transform animate, nothing is hidden before script or CSS support is confirmed, and with reduced motion every element shows its final state.

**Platform**
- Catalog responses are cached in Redis and invalidated the moment a product, category or stock level changes (`X-Cache: HIT|MISS` shows which).
- A scheduler service settles unpaid orders (releasing their stock, or reconciling with Stripe) and purges expired tokens. Each job runs once per interval however many scheduler instances run.

**Admin console** (`/admin`, admin role only)
- Dashboard: revenue and order KPIs, a 30-day revenue chart (with a data-table view), orders by status, top products and low-stock alerts, plus a Ctrl/⌘K command palette.
- Product and inventory management: create, edit, hide/activate and delete (refused with `409` if the product has order history), with image uploads that are validated, stripped of metadata, re-encoded as WebP and kept in object storage.
- Order monitoring and fulfilment: filter by status, search, and ship/deliver/cancel through the order state machine, plus a CSV export of the filtered orders. Cells a spreadsheet would run as formulas are neutralised, and each export is audited.
- User and role management: promote or demote admins and suspend accounts (each change revokes that user's sessions).
- Audit log of admin actions and authentication events, with actor, field-level diff, client IP and request ID.

## Architecture

```mermaid
flowchart LR
    browser["Browser<br/>React SPA"]

    subgraph compose["docker compose"]
        nginx["nginx (unprivileged)<br/>prerendered pages + SPA + CSP headers<br/>reverse proxy /api"]
        api["Django + DRF<br/>gunicorn"]
        scheduler["Scheduler<br/>run_scheduler"]
        db[("PostgreSQL 17")]
        redis[("Redis 8<br/>rate limits + catalog cache")]
        mail["Mailpit<br/>(local SMTP)"]
        minio[("MinIO<br/>product images")]
    end

    payment["PaymentProvider<br/>(mock by default, or Stripe test mode)"]

    browser -- "single origin" --> nginx
    nginx -- "/api/*, /static/*" --> api
    api -- "ORM, row locks" --> db
    api -- "atomic limits, cache" --> redis
    api -- "SMTP" --> mail
    api -- "S3 API" --> minio
    scheduler -- "job leases, settle orders" --> db
    api -- "charge / refund" --> payment
    payment -. "signed webhooks" .-> api
```

The browser only ever talks to one origin: nginx serves the SPA and proxies `/api` to Django, so the refresh cookie can be `SameSite=Strict` and CORS stays closed by default. The public pages are prerendered by `npm run build` (React's `react-dom/static`, `frontend/scripts/prerender.mjs`) from `frontend/prerender/catalog.json`, public catalog responses recorded from the seeded demo store, so the build needs no running API; nginx answers each of those URLs with its own HTML file, the app hydrates it and refetches live stock and prices at once. A backend test keeps the snapshot equal to `seed_demo`'s catalog; after changing the demo catalog, re-record it with `npm run prerender:capture -- http://localhost:8080`.

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant API as Checkout service
    participant DB as PostgreSQL
    participant P as Payment provider

    C->>API: POST /api/checkout/ (Idempotency-Key)
    API->>DB: BEGIN; SELECT products FOR UPDATE (ordered by id)
    API->>DB: verify stock, decrement, create order (pending_payment); COMMIT
    API->>P: charge(total, token, idempotency key)
    alt approved
        API->>DB: order -> paid, consume cart
        API-->>C: 201 Created
    else declined
        API->>DB: order -> payment_failed, release stock
        API-->>C: 402 Payment Required
    end
```

Row locks are held only for the reservation transaction, never across the payment call.

## Security model

| Concern | How it is handled |
|---|---|
| **Passwords** | Argon2 hashing (PBKDF2 kept only to verify legacy hashes) and Django's validators: minimum length 10, common-password and all-numeric checks, similarity to email/name. |
| **Session tokens** | Short-lived JWT access token (10 min) kept **in memory** by the SPA, never in `localStorage`. The refresh token (7 days) lives in an `httpOnly; Secure; SameSite=Strict` cookie scoped to `Path=/api/auth/`. |
| **Revoking sessions** | Every token carries the account's session epoch, checked on each request and on refresh. Password reset, password change, role or status changes and refresh-token reuse bump it, so every session ends at once, including access tokens that have not expired yet. This also closes a race in which a refresh committing during a revocation could mint a token the blacklist sweep missed; a PostgreSQL test that races them fails without the epoch check ([ADR 0002](docs/adr/0002-email-verification-and-password-reset.md)). |
| **Account recovery** | Reset and confirmation links carry a 256-bit secret, of which only the SHA-256 is stored. Each link works once (row-locked, so concurrent submissions cannot both succeed), expires (30 minutes for reset, 24 hours for confirmation), dies when a newer one is sent, and is bound to an active account and the address it was sent to. The secret travels in the URL fragment, which browsers never send to a server, and the page strips it from the address bar. A reset signs out every session and emails the owner a notice. |
| **Refresh rotation and theft detection** | Every refresh rotates the token and blacklists the old one. Replaying an already-rotated token is treated as theft: **all** of that user's refresh tokens are revoked and the event is audited. Rotation locks the token's row, so requests racing with the same token cannot both succeed: one rotates, the others count as replays (a PostgreSQL test races six of them). |
| **CSRF** | The cookie-authenticated endpoints (refresh, logout) also require an `X-CSRF-Protection: 1` header, which cross-site forms cannot send and cross-origin scripts cannot send without a CORS preflight that is denied. Everything else uses bearer tokens. |
| **Authorization (RBAC)** | An `IsAdminRole` permission guards every admin endpoint. The role is read from the database on each request, not from token claims, so demotion or suspension takes effect immediately. Admins cannot demote or suspend themselves, and role/status changes revoke the target user's sessions. |
| **Object-level access** | Orders, invoices and cart items are always queried through the requesting user, so another user's order or invoice returns `404` (no ID enumeration). Order URLs use UUIDs. |
| **Input validation** | DRF serializers on every write; database `CHECK` constraints (`price > 0`, `stock >= 0`, `quantity >= 1`); strict formats for SKUs, postal codes, country codes and image URLs (site-relative or `https://` only, so no `javascript:` or protocol-relative URLs). JSON-only parsers and a 1 MiB body limit. |
| **Brute force and abuse** | DRF throttling: 10/min per IP for login, register and password change (keyed by IP even for signed-in callers, so a stolen access token cannot brute-force the current password); 60/min for silent refresh (a separate budget, so page loads never lock users out); 20/min per user for checkout; 5/min per IP on endpoints that send email, plus a silent per-inbox budget (3/hour, which unknown addresses spend too) so nobody can flood someone else's inbox; plus global anonymous/user limits. Every limit is counted by one atomic Lua script in Redis (a sliding-window log on Redis's own clock), so it holds across workers and replicas. DRF's own read-then-write history admitted 40 of 40 requests against a limit of 10 under contention; the atomic limiter admits exactly 10. If Redis is down, credential and email limits fail closed and the rest fail open ([ADR 0004](docs/adr/0004-redis-rate-limits-catalog-cache-and-scheduler.md)). |
| **User enumeration** | Sign-in answers the same for an unknown email, a wrong password and an inactive account, and Django's auth backend equalises timing. Forgot-password answers byte-for-byte the same for registered, unknown and suspended addresses, never sooner than 400 ms, and sends mail off the request path, so neither the answer nor the response time reveals an account. Registration still says an address is taken, because it signs the new account in immediately; it is limited to 10 attempts a minute per IP. |
| **Headers** | nginx sends a strict CSP (`script-src 'self'`, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` and COOP. Django adds its own CSP for the API docs and `Cache-Control: no-store` on API responses. HSTS and SSL redirect are configurable for TLS deployments. |
| **Error leakage** | Every API error, including unknown routes and unhandled exceptions, answers with the same JSON envelope and never includes exception details. |
| **Private pages and crawlers** | The bag, checkout, orders, admin and not-found pages carry `<meta name="robots" content="noindex">`. `robots.txt` only disallows `/api/`, because a crawler blocked from a page never sees its `noindex`. |
| **Open redirects** | The `?next=` parameter after sign-in only accepts same-site relative paths. |
| **Payments** | No card data reaches the backend: the client sends an opaque provider token. Checkout requires an `Idempotency-Key` header, so retries never double-charge or double-reserve, even when they race the first attempt: reservations are serialised per shopper and the key is re-checked under that lock. A retry gets the first attempt's answer, including its `402` if the card was declined. |
| **File uploads** | Admin-only product image uploads accept only JPEG, PNG and WebP by magic bytes (client filenames and types are ignored, so SVG is out). Polyglots are refused: markup markers anywhere, or bytes after the image's own end. Images are capped at 5 MB and 40 megapixels, decoded fully, and re-encoded to WebP with no EXIF, GPS, ICC or text chunks. They are stored under random keys in a private bucket and served through the API with `nosniff`, a `default-src 'none'; sandbox` CSP and an explicit `image/webp` type ([ADR 0005](docs/adr/0005-product-image-uploads.md)). |
| **Payment webhooks** | Stripe events are accepted only with a valid `Stripe-Signature` (HMAC-SHA256 over the raw body, any of several `v1` signatures during a secret rotation) and a timestamp under 5 minutes old. The event id is stored in the same transaction as its effect, so a replay or a concurrent redelivery changes nothing, and a failed effect is retried by Stripe. A PaymentIntent must name one of our Stripe orders, match the stored reference and carry exactly the order's amount and currency; live events are refused by a test-mode store. A charge whose outcome is unknown (a timeout) is never treated as a decline, and money that arrives for an order already cancelled is refunded ([ADR 0003](docs/adr/0003-stripe-payment-intents-and-webhooks.md)). |
| **Audit trail** | Append-only `AuditLog` for admin create/update/delete, order transitions, role changes, logins, failed logins, password changes and refresh-token reuse, with actor, diff, client IP (proxy-aware) and request ID. |
| **Containers** | Non-root users, read-only root filesystems, `no-new-privileges`, all Linux capabilities dropped, health checks, and no secrets in images (compose refuses to start without `DJANGO_SECRET_KEY`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD` and `MINIO_ROOT_PASSWORD`). |
| **Image scanning** | CI scans every image compose runs with Trivy ([`scripts/scan_images.sh`](scripts/scan_images.sh)) and fails on any HIGH or CRITICAL vulnerability that has a fix. Trivy itself is a pinned release checked against a SHA-256 taken from its Sigstore-verified checksums file. Accepted findings live in [`.trivyignore.yaml`](.trivyignore.yaml): one entry per CVE, scoped to one file, with evidence and an expiry date at most 90 days out, after which the gate fails again ([ADR 0001](docs/adr/0001-container-image-scanning.md)). Dockerfiles are linted with hadolint. |

## Tech stack

| Layer | Choices |
|---|---|
| Backend | Python 3.12, Django 5.2 LTS, Django REST Framework, SimpleJWT (rotation + blacklist), django-filter, drf-spectacular (OpenAPI 3), argon2-cffi, gunicorn, WhiteNoise |
| Database | PostgreSQL 17 (SQLite for quick local runs; the concurrency test needs PostgreSQL) |
| Frontend | React 19, TypeScript (strict), Vite, Tailwind CSS v4, React Router, TanStack Query, React Hook Form + Zod, Recharts, Radix UI, sonner, vaul, cmdk, Lucide icons, self-hosted Inter Variable |
| Testing | pytest, pytest-django, coverage; Vitest, Testing Library, MSW; Playwright + axe-core |
| Quality | Ruff (lint + format), mypy (strict, django-stubs), ESLint (typescript-eslint strict, jsx-a11y), Prettier |
| Delivery | Multi-stage Dockerfiles, docker compose, nginx-unprivileged, GitHub Actions |

## Quickstart

### With Docker (recommended)

```bash
cp .env.example .env    # then set DJANGO_SECRET_KEY, POSTGRES_PASSWORD, REDIS_PASSWORD, MINIO_ROOT_PASSWORD
docker compose up --build
```

Open <http://localhost:8080> (change the port with `HTTP_PORT` in `.env`). Every email the app sends (confirmation and reset links) is caught by [Mailpit](https://mailpit.axllent.org) at <http://localhost:8025> (`MAILPIT_UI_PORT`). On first start the backend runs migrations and seeds a demo store: 18 products, 6 customers and 30 days of order history created through the real checkout service.

| Demo account | Email | Password |
|---|---|---|
| Admin | `admin@securecart.dev` | `SecureCart!Admin1` |
| Customer | `maya@example.com` | `SecureCart!Demo1` |

The sign-in page has one-click buttons for both (hide them with `VITE_DEMO_MODE=false`). At checkout, choose **Test card: approve** or **Test card: decline**. No real payment is processed.

### Stripe test mode (optional)

The mock provider is the default and needs nothing. To take real test-mode payments through Stripe with your own account:

```bash
# 1. In a second terminal, forward Stripe's events to the local stack and note the whsec_...
stripe listen --forward-to localhost:8080/api/payments/webhooks/stripe/
# 2. Add to .env (test keys only: live keys are refused unless STRIPE_ALLOW_LIVE_MODE=true)
PAYMENT_PROVIDER=apps.payments.providers.stripe_provider.StripePaymentProvider
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
# 3. Restart the API
docker compose up -d --build backend
```

Checkout then offers Stripe's test methods (`pm_card_visa` approves, `pm_card_chargeDeclined` declines). An approved order answers `202` and shows "Confirming your payment" until `payment_intent.succeeded` arrives through `stripe listen`. `stripe trigger payment_intent.succeeded` exercises the endpoint, but its event names no SecureCart order, so it is acknowledged and ignored. CI never needs keys: it runs against `stripe/stripe-mock` and webhook fixtures signed with Stripe's algorithm.

### Kubernetes (kind, with TLS)

`deploy/k8s` holds a Kustomize base (the application) and two overlays: `kind` (in-cluster PostgreSQL, Redis, MinIO and Mailpit, a self-signed certificate, demo data) and `production` (managed data services, cert-manager with Let's Encrypt, registry images). Every pod runs non-root with a read-only root filesystem, no capabilities, `RuntimeDefault` seccomp and no service-account token, under the namespace's enforced `restricted` Pod Security Standard. NetworkPolicies deny everything except the paths the app uses. The API has startup, readiness and liveness probes, and both web tiers have PodDisruptionBudgets ([ADR 0007](docs/adr/0007-kubernetes-manifests-and-tls.md)).

```bash
deploy/k8s/scripts/kind-up.sh     # cluster, Traefik, images, secrets, TLS, apply, smoke test
# https://securecart.localtest.me:5403 (the script prints the certificate to trust)
deploy/k8s/scripts/kind-down.sh   # delete the cluster
```

### Local development

Requirements: Python 3.12 with [uv](https://docs.astral.sh/uv/), and Node 22+.

```bash
# Terminal 1, from the repo root: API on http://localhost:8000
cd backend
uv sync
export DJANGO_DEBUG=true DATABASE_URL=sqlite:///db.sqlite3 REFRESH_COOKIE_SECURE=false
uv run python manage.py migrate
uv run python manage.py seed_demo
uv run python manage.py runserver

# Terminal 2, from the repo root: SPA on http://localhost:5173
# (proxies /api to :8000, so cookies behave as in production)
cd frontend
npm install
npm run dev
```

Different ports: `uv run python manage.py runserver 127.0.0.1:8001` for the API, then `VITE_PORT=5180 VITE_DEV_API_PROXY=http://127.0.0.1:8001 npm run dev` for the SPA.

Other commands: `uv run python manage.py run_scheduler` runs the periodic jobs (compose runs it as the `scheduler` service; `--once` runs one tick), `uv run python manage.py expire_pending_orders --minutes 30` settles abandoned payments by hand, and `python scripts/screenshots.py --base-url http://localhost:8080` regenerates the README screenshots. To scan the images as CI does, run `docker compose build && scripts/scan_images.sh gate` (needs [Trivy](https://trivy.dev) on `PATH`, or point `TRIVY` at the binary).

## Configuration

All configuration comes from environment variables, and the defaults are the secure choice. With Docker, set them in `.env`: `docker-compose.yml` passes every variable below through to the backend. The storefront quotes the pricing, cart and session rules in its copy; those numbers live in `frontend/src/lib/storeRules.ts`, and a backend test fails if they drift from the defaults here, so change both if you override them.

| Variable | Default | Purpose |
|---|---|---|
| `DJANGO_SECRET_KEY` | *(required unless `DJANGO_DEBUG=true`)* | Django signing key |
| `DJANGO_DEBUG` | `false` | Development mode |
| `DATABASE_URL` | `sqlite:///backend/db.sqlite3` | `postgres://user:pass@host:5432/db` or `sqlite:///path` |
| `DJANGO_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Comma-separated host allow-list |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | *(empty)* | Origins trusted for CSRF checks |
| `CORS_ALLOWED_ORIGINS` | *(empty)* | Only needed if the SPA is served from a different origin |
| `JWT_SIGNING_KEY` | `DJANGO_SECRET_KEY` | Separate key so tokens can be rotated independently |
| `JWT_ACCESS_MINUTES` / `JWT_REFRESH_DAYS` | `10` / `7` | Token lifetimes |
| `REFRESH_COOKIE_SECURE` | `true` | `Secure` flag on the refresh cookie (`localhost` counts as secure) |
| `REDIS_URL` | *(empty)* | Redis for atomic rate limits and the catalog cache (compose: the `redis` service, password from `REDIS_PASSWORD`, which is required there) |
| `DJANGO_CACHE_BACKEND` | `redis` with `REDIS_URL`, else `locmem` | `redis`, `db` or `locmem` |
| `CATALOG_CACHE_SECONDS` | `300` | Longest a cached catalog response lives (writes invalidate it immediately) |
| `STORE_NAME` / `STORE_ADDRESS` / `INVOICE_FOOTER` | `SecureCart` / a sample address (lines separated by `\|`) / a demo-store notice | Seller details printed on invoices |
| `MEDIA_STORAGE` | `disabled` (`s3` in compose) | `s3`, `memory` (tests) or `disabled` (uploads answer `503`) |
| `MEDIA_S3_ENDPOINT` / `MEDIA_S3_BUCKET` / `MEDIA_S3_REGION` / `MEDIA_S3_ACCESS_KEY` / `MEDIA_S3_SECRET_KEY` | *(AWS)* / `securecart-media` / `us-east-1` / *(empty)* / *(empty)* | Object storage (compose: MinIO with `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`, the latter required) |
| `MAX_IMAGE_UPLOAD_BYTES` / `MAX_IMAGE_PIXELS` / `MAX_IMAGE_EDGE` | `5242880` / `40000000` / `2000` | Upload limits and the stored size |
| `PENDING_ORDER_TIMEOUT_MINUTES` / `SCHEDULER_PENDING_ORDERS_EVERY_SECONDS` | `30` / `300` | When the scheduler settles unpaid orders, and how often it looks |
| `THROTTLE_AUTH` / `THROTTLE_AUTH_REFRESH` / `THROTTLE_CHECKOUT` | `10/min` / `60/min` / `20/min` | Rate limits (credentials per IP, refresh per IP, checkout per user) |
| `THROTTLE_ANON` / `THROTTLE_USER` | `120/min` / `600/min` | Global limits for everything else |
| `NUM_PROXIES` | `0` | Trusted proxy hops for client IPs (`1` behind nginx) |
| `DJANGO_HSTS_SECONDS` / `DJANGO_SECURE_SSL_REDIRECT` / `DJANGO_BEHIND_TLS_PROXY` | `0` / `false` / `false` | TLS hardening for real deployments |
| `PAYMENT_PROVIDER` | `apps.payments.providers.mock.MockPaymentProvider` | Dotted path to a `PaymentProvider` subclass (`apps.payments.providers.stripe_provider.StripePaymentProvider` for Stripe) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | *(empty)* | Stripe test-mode secret key and webhook signing secret; both are required when Stripe is the provider |
| `STRIPE_ALLOW_LIVE_MODE` | `false` | Live keys are refused unless this is `true` |
| `STRIPE_API_BASE` / `STRIPE_TIMEOUT_SECONDS` / `STRIPE_MAX_NETWORK_RETRIES` / `STRIPE_WEBHOOK_TOLERANCE_SECONDS` | `https://api.stripe.com` / `10` / `2` / `300` | Client settings (the base is pointed at stripe-mock in tests) |
| `STORE_CURRENCY`, `FREE_SHIPPING_THRESHOLD`, `FLAT_SHIPPING_FEE`, `TAX_RATE`, `MAX_CART_LINE_QUANTITY` | `USD`, `75.00`, `6.99`, `0.08`, `10` | Store pricing rules |
| `LOG_FORMAT` / `LOG_LEVEL` | `json` (`text` with `DJANGO_DEBUG=true`) / `INFO` | One JSON object per log line, each tagged with the request's `X-Request-ID` (the same ID the audit log stores) |
| `RUN_MIGRATIONS` / `SEED_DEMO` | `true` / `false` (`true` in compose) | Container start-up tasks |
| `DEMO_ADMIN_PASSWORD` / `DEMO_CUSTOMER_PASSWORD` | see the demo table | Passwords used by `seed_demo` |
| `VITE_DEMO_MODE` | `true` | Build-time flag for the demo-account shortcuts |
| `EMAIL_BACKEND` | `smtp` (`console` only with `DJANGO_DEBUG=true`) | `smtp`, `console` or `locmem`; `console` prints links to the log, so it is refused outside debug |
| `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_HOST_USER` / `EMAIL_HOST_PASSWORD` | `localhost` / `587` / *(empty)* / *(empty)* | SMTP relay (compose: `mailpit` / `1025`) |
| `EMAIL_USE_TLS` / `EMAIL_USE_SSL` / `EMAIL_TIMEOUT_SECONDS` | on for port 587 / on for port 465 / `10` | Transport security and timeout |
| `DEFAULT_FROM_EMAIL` | `SecureCart <no-reply@securecart.dev>` | Sender address |
| `APP_BASE_URL` | `http://localhost:8080` | Public storefront origin used in emailed links |
| `PASSWORD_RESET_TTL_MINUTES` / `EMAIL_VERIFICATION_TTL_HOURS` | `30` / `24` | Link lifetimes |
| `REQUIRE_VERIFIED_EMAIL` | `true` | Checkout requires a confirmed address |
| `THROTTLE_ACCOUNT_EMAIL` / `THROTTLE_ACCOUNT_EMAIL_RECIPIENT` | `5/min` / `3/hour` | Mail-sending limits per IP and per inbox |
| `THROTTLE_ACCOUNT_DATA` | `10/hour` | Data exports per user |
| `ACCOUNT_RECOVERY_MIN_RESPONSE_MS` | `400` | Minimum forgot-password response time |
| `EMAIL_DELIVERY` / `EMAIL_SEND_ATTEMPTS` / `EMAIL_RETRY_BACKOFF_SECONDS` | `background` / `3` / `2` | Send after commit on a worker thread, with retries |

## API overview

Interactive documentation is served by the backend at **`/api/docs/`** (Swagger UI) and **`/api/redoc/`**, generated from the code by drf-spectacular; the raw schema is at `/api/schema/`. Every error uses one envelope: `{"error": {"code", "message", "fields"?}}`.

| Area | Endpoints | Access |
|---|---|---|
| Auth | `POST /api/auth/register/`, `login/`, `refresh/`, `logout/` · `GET/PATCH /api/auth/me/` · `POST /api/auth/password/` | Public / authenticated |
| Account | `POST /api/auth/sessions/revoke/` (sign out everywhere) · `GET /api/auth/me/export/` (JSON download) · `POST /api/auth/me/delete/` (password required; `409` with open orders or for admins) | Authenticated |
| Recovery | `POST /api/auth/password/forgot/` (always `202`) · `POST /api/auth/password/reset/` · `POST /api/auth/email/verify/` · `POST /api/auth/email/resend/` (authenticated) | Public / authenticated |
| Catalog | `GET /api/products/` (`search`, `category`, `min_price`, `max_price`, `in_stock`, `featured`, `ordering`, `page`) · `GET /api/products/{slug}/` · `GET /api/categories/` | Public |
| Cart | `GET/DELETE /api/cart/` · `POST /api/cart/items/` · `PATCH/DELETE /api/cart/items/{id}/` | Customer (own cart) |
| Checkout | `POST /api/checkout/` with an `Idempotency-Key` header: `201`, `200` (replay), `202` (Stripe: awaiting the webhook), `402` (declined), `403` (address not confirmed), `409` (stock or empty cart) | Customer |
| Payments | `GET /api/payments/config/` (provider, mode, test methods) · `POST /api/payments/webhooks/stripe/` (Stripe-signed) | Public |
| Orders | `GET /api/orders/` · `GET /api/orders/{id}/` · `POST /api/orders/{id}/cancel/` · `GET /api/orders/{id}/invoice/` (PDF; `409` if unpaid) | Customer (own orders) |
| Media | `GET /api/media/products/{id}/{key}.webp` (uploaded product images) | Public |
| Admin | `/api/admin/dashboard/` · `/api/admin/products/` (CRUD, `POST {id}/image/` multipart upload) · `/api/admin/categories/` (CRUD) · `/api/admin/orders/` with `POST {id}/transition/`, `GET {id}/invoice/` and `GET export/` (CSV) · `/api/admin/users/` (list, role/status) · `/api/admin/audit-logs/` | Admin role |
| System | `GET /api/health/` | Public |

## Testing

```bash
cd backend && uv run pytest --cov     # 531 tests; set DATABASE_URL for PostgreSQL, and
                                      # MAILPIT_URL, STRIPE_MOCK_URL, REDIS_URL, MINIO_URL
                                      # for the integration tests (CI sets all of them)
cd frontend && npm test               # 115 tests
cd frontend && npm run e2e            # 29 Playwright + axe specs (needs a running, seeded API)
```

**Backend** (98% line coverage on PostgreSQL with every service): registration and password policy; cookie attributes; refresh rotation and reuse detection; revocation on logout and password change; throttling, including password changes by a signed-in caller; an RBAC matrix built from the URL configuration itself, proving anonymous users get `401` and customers `403` on every admin route for every HTTP verb (55 cases), so a new admin endpoint is covered automatically; object isolation (other users' orders and cart items return `404`); immediate effect of demotion and suspension; checkout success, idempotent replays (a replayed decline repeats its `402`), insufficient stock with full rollback, declined payments releasing stock and an order cancelled while payment is in flight; the complete state-machine transition table; failed refunds rolling back; pending-order expiry; catalog filters and validation; audit diffs; security headers; the JSON error envelope for unknown routes and unhandled errors (with no details leaked); the dashboard maths; and a contract test that keeps the rules the storefront quotes (`frontend/src/lib/storeRules.ts`) equal to the server's defaults. The roadmap features add:
- **Account recovery:** one-time tokens (hashed, single-use, expiring, superseded), byte-identical and time-padded forgot-password answers, inbox budgets, sessions ending on reset, and real SMTP delivery through Mailpit.
- **Stripe:** signed webhook fixtures generated with Stripe's algorithm (bad, stale, tampered, rotated, replayed and live-mode events), stripe-mock contract tests and reconciliation.
- **Redis:** atomic rate limits under contention, and catalog-cache invalidation on every write path.
- **Scheduler:** job leases.
- **Image uploads:** SVG, polyglots, trailing data, decompression bombs, metadata stripping and private-bucket checks, against MinIO.
- **Invoices:** parsed back from the PDF.
- **Account and admin:** account export and deletion, the CSV export's formula neutralising, and JSON logs carrying request IDs.

The concurrency guarantees have their own tests on PostgreSQL, with real threads: **eight shoppers race for three units and exactly three orders succeed while stock ends at zero; six retries with one idempotency key for the last unit all get the same single order; six refreshes with one token never mint more than one session; a refresh racing a full revocation never leaves a live session (this test fails without the session epoch); one reset link submitted six times at once succeeds once; six simultaneous deliveries of one Stripe event pay the order once; eight scheduler instances ticking together run a job once; and a refund is requested without holding any product row lock.** They run in CI against a PostgreSQL service container (and are skipped on SQLite).

**Frontend**: the API client (silent refresh on `401`, deduplicated concurrent refreshes, no refresh for anonymous calls, nested field errors), redirect-target sanitising, form schemas, and full route rendering with MSW for the shop, product, bag, sign-in, registration, admin guard, command palette and checkout (including a fresh idempotency key after a decline, the same key on a retry after a dropped connection, with no claim that nothing was charged, and inline validation), noindex on private and not-found pages, and the footer credit. The prerender is tested end to end in Node: every page's HTML carries its content and no inline script, hydrating it produces no mismatch, and a product still showing build-time data is confirmed against the live API before it is added to the bag. The motion tests cover the story's static, reduced-motion and scripted states, the add-to-bag cue with and without motion, and the chart draw-in. The tests wait on real milestones (MSW responses, loaded modules) rather than polling deadlines, so they behave the same on a loaded CI machine.

**End-to-end**: Playwright drives the production build (served by `vite preview` with nginx's exact CSP and headers) against a live, seeded API: home in both themes, shop filters, search, the protection page, the product page and its sticky buy bar, the bag popover and mobile drawer, a real checkout through the mock provider plus the decline path, a checkout completed with the keyboard alone, noindex and robots.txt, the phone footer's 44px disclosure rows, and the admin dashboard, palette and tables; account recovery through real SMTP (register, confirm, reset, sign in with the new password, a replayed link refused); an admin image upload served back as sanitised WebP; an invoice download with another account refused; and the account page's data export and deletion; the public pages with JavaScript off, hydration in place, the four-moments story at points through its pinned range, the card-to-page morph, and reduced motion (every stage lit, no view transition). Every page is checked with axe-core (WCAG 2.2 A/AA, zero serious or critical violations), every test fails on any console error or CSP violation, and the suite checks for horizontal overflow at 390px and infinite animations under reduced motion.

**Measured** (2026-10-23, the Docker stack behind nginx, every audited route in light and dark at 1440px and 390px): no axe violations reported, CLS at most 0.0072, no horizontal overflow, no touch target under 24px, no console or CSP errors, and Lighthouse desktop 100 for performance, accessibility, best practices and SEO on every public route. Mobile performance (simulated slow 4G, 4x CPU) is 89 to 94 on the public routes and 90 to 93 on the signed-in ones; it moves by a point or two between runs on the same build (three repeat runs of a product page gave 90, 91 and 90). With JavaScript off, the measured public pages (home, shop, a category, `/protection` and a product page) show 100% of the words they show with it on (the sign-in and password-reset forms are not prerendered and need JavaScript, as before); scrolling those pages drops no frames (0% of frames over 20 ms), and with reduced motion no text is left hidden. The bag, checkout, orders, admin and not-found pages score 63 to 66 on Lighthouse SEO by design: their `noindex` fails its "is crawlable" audit, which is the only SEO audit they fail. The first visit downloads about 75 KB of app JavaScript plus 101 KB of React (gzipped); forms, toasts, the phone bag drawer and the admin charts load on demand.

**CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs these jobs:
- **Backend:** Ruff (backend and `scripts/`), mypy, migration-drift and OpenAPI validation checks, then pytest with a 90% coverage gate on PostgreSQL, with Mailpit, stripe-mock, Redis and MinIO beside it.
- **Frontend:** ESLint, Prettier, `tsc`, Vitest and the production build.
- **End-to-end:** the Playwright + axe suite against gunicorn (DEBUG off) on a seeded PostgreSQL, inside Playwright's pinned image on two workers. This job used to take up to 14 minutes, almost all of it apt installing browser libraries (20.6 MB at 28.6 kB/s on one run); in CI-equivalent local runs it now takes 85 to 108 seconds.
- **Image scan:** Trivy on every image and hadolint on both Dockerfiles.
- **Kubernetes:** both overlays rendered, then checked with `kubeconform -strict` and `trivy config`.
- **Docker:** builds the images, starts the compose stack with `--wait` on its health checks, and smoke-tests it through nginx (Redis cache hit, scheduler heartbeat, reset email arriving in Mailpit).

Actions are pinned to commit SHAs.

## Project structure

```text
.
├── backend/
│   ├── config/                 # env-driven settings, URLs, test settings
│   ├── apps/
│   │   ├── accounts/           # users, JWT cookie flow + session epoch, RBAC, recovery, self-service
│   │   ├── catalog/            # products, categories, catalog cache, image uploads, demo data
│   │   ├── cart/               # server-side cart
│   │   ├── orders/             # checkout, state machine, pricing, invoices, CSV export
│   │   ├── payments/           # PaymentProvider, mock + Stripe providers, signed webhooks
│   │   ├── audit/              # audit log model, service and admin API
│   │   ├── dashboard/          # admin KPIs
│   │   └── core/               # middleware, logging, rate limiter, scheduler, health, seed_demo
│   ├── tests/                  # pytest suite
│   └── Dockerfile, docker-entrypoint.sh, pyproject.toml, uv.lock
├── frontend/
│   ├── src/
│   │   ├── auth/               # session context and route guards
│   │   ├── components/         # UI primitives, layout, store and admin components
│   │   ├── pages/              # storefront and admin pages (+ tests)
│   │   ├── lib/                # API client, endpoints, types, validation, formatting
│   │   ├── prerender/          # which pages are prerendered, payload and hydration rules
│   │   └── test/               # MSW server, fixtures, render helpers
│   ├── public/products/        # generated product artwork (SVG)
│   ├── e2e/                    # Playwright + axe end-to-end specs
│   ├── prerender/catalog.json  # recorded catalog responses the build prerenders from
│   ├── scripts/prerender.mjs   # build-time prerender (and snapshot capture)
│   ├── nginx/                  # server config and security headers
│   └── Dockerfile, package.json, package-lock.json
├── deploy/k8s/                 # Kustomize base, kind + production overlays, kind scripts
├── scripts/                    # image scanning, product-art generator, screenshot capture
├── docs/adr/                   # architecture decision records
├── docs/screenshots/
├── docker-compose.yml
├── .trivyignore.yaml           # accepted scanner findings, each scoped and expiring
└── .env.example
```

## Design decisions

- **Refresh cookie plus in-memory access token, not tokens in `localStorage`.** Any script running on the page can read storage; nothing can read an `httpOnly` cookie. Keeping the short-lived access token in memory means a page reload costs one silent refresh, which the client deduplicates across concurrent requests.
- **Pessimistic locking for stock.** `SELECT … FOR UPDATE` on the cart's products, taken in primary-key order to avoid deadlocks, makes overselling impossible without retry loops, and a `stock >= 0` check constraint is the backstop. A conditional `UPDATE … WHERE stock >= n` would also work, but locking keeps multi-line orders all-or-nothing and easy to reason about.
- **Payment outside the transaction.** Holding row locks across a network call would serialise checkout on the slowest gateway response. Instead the order is reserved as `pending_payment`, charged, then finalised; declines release stock, and `expire_pending_orders` cleans up if a process dies between steps. The trade-off is a short window in which stock is reserved but not yet paid for.
- **Explicit state machine.** Every status change goes through `orders.state.transition`, which locks the order, validates the move against one transition table, applies side effects (restock, refund, timestamps) and records an event. Customers and admins get different allowed subsets, and only checkout can set `paid` or `payment_failed`.
- **Snapshots on order lines.** Name, SKU, image and unit price are copied at purchase time, so catalog edits never rewrite history. Products with history cannot be hard-deleted; they are hidden instead.
- **Role checked against the database.** A role claim in the JWT would stay valid for the token's lifetime after a demotion. Reading `user.role` per request costs nothing extra, because authentication already loads the user.
- **Refresh-token reuse revokes everything.** This follows OAuth refresh-rotation guidance. The cost is that two tabs refreshing at exactly the same instant can sign the user out; the client's single-flight refresh makes that rare.
- **Django 5.2 LTS and ESLint 9.** Both are deliberate: 5.2 is the long-term-support line, and ESLint 9 is the newest major that `eslint-plugin-jsx-a11y` supports, so accessibility linting stays on.
- **Prerendering from a recorded snapshot, not SSR.** The public pages only need the public catalog, so rendering them once per build keeps nginx static (no Node server in production) and lets the Docker image and CI build without a backend. The cost is that the HTML can lag the live catalog until the next build; the app refetches on load, and a product that has not been confirmed live yet is looked up before it goes into a bag. New products still work at once through the SPA shell.
- **Migrations at container start.** Convenient for a single instance. With several replicas, set `RUN_MIGRATIONS=false` and run them as a release job.

## License

[MIT](LICENSE) © Arya Mahindrakar

---

Built by **Arya Mahindrakar**, B.Tech Cloud Technology & Information Security.
