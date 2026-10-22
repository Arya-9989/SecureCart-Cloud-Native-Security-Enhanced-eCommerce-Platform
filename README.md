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

More screenshots: [how your order is protected](docs/screenshots/protection.png) · [shop](docs/screenshots/shop.png) · [product](docs/screenshots/product.png) · [bag](docs/screenshots/cart.png) · [order history](docs/screenshots/orders.png) · [sign in](docs/screenshots/login.png) · [admin products](docs/screenshots/admin-products.png) · [product editor](docs/screenshots/admin-product-edit.png) · [order fulfilment](docs/screenshots/admin-order-detail.png) · [audit log](docs/screenshots/admin-audit-log.png) · [dark mode](docs/screenshots/home-dark.png)

> All screenshots are captured from the Docker stack by [`scripts/screenshots.py`](scripts/screenshots.py), which drives the real UI against the seeded demo data. Product images are original SVGs drawn by [`scripts/generate_product_art.py`](scripts/generate_product_art.py).

---

## Features

**Storefront**
- Catalog with categories, search (name, description, SKU, category), price and availability filters, sorting and pagination, all reflected in the URL.
- Product pages with stock indicators ("Only 3 left", "Sold out") and related products.
- Server-side bag (cart) that follows the customer across devices, with per-line limits checked against live stock; previewed from the nav as a popover on desktop and a drawer on mobile.
- Checkout with address validation, a free-shipping threshold and tax, and a pluggable payment provider (an offline mock by default).
- Order history and detail with a status tracker, event timeline and self-service cancellation before shipping (restock and refund).
- Registration and sign-in, light/dark themes, responsive layouts, and loading, empty and error states throughout.
- A "How your order is protected" page (`/protection`) and quiet trust cues at sign-in, bag, checkout and order confirmation. Every statement describes a mechanism in this codebase and links to it; the copy lives in one file (`frontend/src/lib/protection.ts`).

**Design**: Apple Store calm on white and `#f5f5f7` with one deep-blue accent, Inter with optical sizing, designed light and dark themes, WCAG AA contrast throughout, reduced-motion support, and touch targets of at least 24px everywhere (WCAG 2.5.8) with 44px header controls and footer rows on phones. Product images are original SVG illustrations lit as one studio set, with one camera rule: standing products at eye level, desk objects from about 30° above.

**Admin console** (`/admin`, admin role only)
- Dashboard: revenue and order KPIs, a 30-day revenue chart (with a data-table view), orders by status, top products and low-stock alerts, plus a Ctrl/⌘K command palette.
- Product and inventory management: create, edit, hide/activate and delete (refused with `409` if the product has order history).
- Order monitoring and fulfilment: filter by status, search, and ship/deliver/cancel through the order state machine.
- User and role management: promote or demote admins and suspend accounts (each change revokes that user's sessions).
- Audit log of admin actions and authentication events, with actor, field-level diff, client IP and request ID.

## Architecture

```mermaid
flowchart LR
    browser["Browser<br/>React SPA"]

    subgraph compose["docker compose"]
        nginx["nginx (unprivileged)<br/>static SPA + CSP headers<br/>reverse proxy /api"]
        api["Django + DRF<br/>gunicorn"]
        db[("PostgreSQL 17")]
    end

    payment["PaymentProvider<br/>(mock by default)"]

    browser -- "single origin" --> nginx
    nginx -- "/api/*, /static/*" --> api
    api -- "ORM, row locks" --> db
    api -- "charge / refund" --> payment
```

The browser only ever talks to one origin: nginx serves the SPA and proxies `/api` to Django, so the refresh cookie can be `SameSite=Strict` and CORS stays closed by default.

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
| **Refresh rotation and theft detection** | Every refresh rotates the token and blacklists the old one. Replaying an already-rotated token is treated as theft: **all** of that user's refresh tokens are revoked and the event is audited. Rotation locks the token's row, so requests racing with the same token cannot both succeed: one rotates, the others count as replays (a PostgreSQL test races six of them). |
| **CSRF** | The cookie-authenticated endpoints (refresh, logout) also require an `X-CSRF-Protection: 1` header, which cross-site forms cannot send and cross-origin scripts cannot send without a CORS preflight that is denied. Everything else uses bearer tokens. |
| **Authorization (RBAC)** | An `IsAdminRole` permission guards every admin endpoint. The role is read from the database on each request, not from token claims, so demotion or suspension takes effect immediately. Admins cannot demote or suspend themselves, and role/status changes revoke the target user's sessions. |
| **Object-level access** | Orders and cart items are always queried through the requesting user, so another user's order returns `404` (no ID enumeration). Order URLs use UUIDs. |
| **Input validation** | DRF serializers on every write; database `CHECK` constraints (`price > 0`, `stock >= 0`, `quantity >= 1`); strict formats for SKUs, postal codes, country codes and image URLs (site-relative or `https://` only, so no `javascript:` or protocol-relative URLs). JSON-only parsers and a 1 MiB body limit. |
| **Brute force and abuse** | DRF throttling: 10/min per IP for login, register and password change (keyed by IP even for signed-in callers, so a stolen access token cannot brute-force the current password); 60/min for silent refresh (a separate budget, so page loads never lock users out); 20/min per user for checkout; plus global anonymous/user limits. A database-backed cache keeps counters consistent across gunicorn workers. |
| **User enumeration** | Unknown email, wrong password and inactive account all return the same message, and Django's auth backend equalises timing. |
| **Headers** | nginx sends a strict CSP (`script-src 'self'`, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` and COOP. Django adds its own CSP for the API docs and `Cache-Control: no-store` on API responses. HSTS and SSL redirect are configurable for TLS deployments. |
| **Error leakage** | Every API error, including unknown routes and unhandled exceptions, answers with the same JSON envelope and never includes exception details. |
| **Private pages and crawlers** | The bag, checkout, orders, admin and not-found pages carry `<meta name="robots" content="noindex">`. `robots.txt` only disallows `/api/`, because a crawler blocked from a page never sees its `noindex`. |
| **Open redirects** | The `?next=` parameter after sign-in only accepts same-site relative paths. |
| **Payments** | No card data reaches the backend: the client sends an opaque provider token. Checkout requires an `Idempotency-Key` header, so retries never double-charge or double-reserve, even when they race the first attempt: reservations are serialised per shopper and the key is re-checked under that lock. A retry gets the first attempt's answer, including its `402` if the card was declined. |
| **Audit trail** | Append-only `AuditLog` for admin create/update/delete, order transitions, role changes, logins, failed logins, password changes and refresh-token reuse, with actor, diff, client IP (proxy-aware) and request ID. |
| **Containers** | Non-root users, read-only root filesystems, `no-new-privileges`, all Linux capabilities dropped, health checks, and no secrets in images (compose refuses to start without `DJANGO_SECRET_KEY` and `POSTGRES_PASSWORD`). |

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
cp .env.example .env    # then set DJANGO_SECRET_KEY and POSTGRES_PASSWORD
docker compose up --build
```

Open <http://localhost:8080> (change the port with `HTTP_PORT` in `.env`). On first start the backend runs migrations and seeds a demo store: 18 products, 6 customers and 30 days of order history created through the real checkout service.

| Demo account | Email | Password |
|---|---|---|
| Admin | `admin@securecart.dev` | `SecureCart!Admin1` |
| Customer | `maya@example.com` | `SecureCart!Demo1` |

The sign-in page has one-click buttons for both (hide them with `VITE_DEMO_MODE=false`). At checkout, choose **Test card: approve** or **Test card: decline**. No real payment is processed.

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

Other commands: `uv run python manage.py expire_pending_orders --minutes 30` releases stock held by abandoned payments, and `python scripts/screenshots.py --base-url http://localhost:8080` regenerates the README screenshots.

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
| `DJANGO_CACHE_BACKEND` | `locmem` | `db` shares throttle state across workers (used in compose) |
| `THROTTLE_AUTH` / `THROTTLE_AUTH_REFRESH` / `THROTTLE_CHECKOUT` | `10/min` / `60/min` / `20/min` | Rate limits (credentials per IP, refresh per IP, checkout per user) |
| `THROTTLE_ANON` / `THROTTLE_USER` | `120/min` / `600/min` | Global limits for everything else |
| `NUM_PROXIES` | `0` | Trusted proxy hops for client IPs (`1` behind nginx) |
| `DJANGO_HSTS_SECONDS` / `DJANGO_SECURE_SSL_REDIRECT` / `DJANGO_BEHIND_TLS_PROXY` | `0` / `false` / `false` | TLS hardening for real deployments |
| `PAYMENT_PROVIDER` | `apps.payments.providers.mock.MockPaymentProvider` | Dotted path to a `PaymentProvider` subclass |
| `STORE_CURRENCY`, `FREE_SHIPPING_THRESHOLD`, `FLAT_SHIPPING_FEE`, `TAX_RATE`, `MAX_CART_LINE_QUANTITY` | `USD`, `75.00`, `6.99`, `0.08`, `10` | Store pricing rules |
| `RUN_MIGRATIONS` / `SEED_DEMO` | `true` / `false` (`true` in compose) | Container start-up tasks |
| `DEMO_ADMIN_PASSWORD` / `DEMO_CUSTOMER_PASSWORD` | see the demo table | Passwords used by `seed_demo` |
| `VITE_DEMO_MODE` | `true` | Build-time flag for the demo-account shortcuts |

## API overview

Interactive documentation is served by the backend at **`/api/docs/`** (Swagger UI) and **`/api/redoc/`**, generated from the code by drf-spectacular; the raw schema is at `/api/schema/`. Every error uses one envelope: `{"error": {"code", "message", "fields"?}}`.

| Area | Endpoints | Access |
|---|---|---|
| Auth | `POST /api/auth/register/`, `login/`, `refresh/`, `logout/` · `GET/PATCH /api/auth/me/` · `POST /api/auth/password/` | Public / authenticated |
| Catalog | `GET /api/products/` (`search`, `category`, `min_price`, `max_price`, `in_stock`, `featured`, `ordering`, `page`) · `GET /api/products/{slug}/` · `GET /api/categories/` | Public |
| Cart | `GET/DELETE /api/cart/` · `POST /api/cart/items/` · `PATCH/DELETE /api/cart/items/{id}/` | Customer (own cart) |
| Checkout | `POST /api/checkout/` with an `Idempotency-Key` header: `201`, `200` (replay), `402` (declined), `409` (stock or empty cart) | Customer |
| Orders | `GET /api/orders/` · `GET /api/orders/{id}/` · `POST /api/orders/{id}/cancel/` | Customer (own orders) |
| Admin | `/api/admin/dashboard/` · `/api/admin/products/` (CRUD) · `/api/admin/categories/` (CRUD) · `/api/admin/orders/` and `POST /api/admin/orders/{id}/transition/` · `/api/admin/users/` (list, role/status) · `/api/admin/audit-logs/` | Admin role |
| System | `GET /api/health/` | Public |

## Testing

```bash
cd backend && uv run pytest --cov     # 247 tests; set DATABASE_URL to run on PostgreSQL
cd frontend && npm test               # 64 tests
cd frontend && npm run e2e            # 18 Playwright + axe specs (needs a running, seeded API)
```

**Backend** (97% line coverage): registration and password policy; cookie attributes; refresh rotation and reuse detection; revocation on logout and password change; throttling, including password changes by a signed-in caller; an RBAC matrix built from the URL configuration itself, proving anonymous users get `401` and customers `403` on every admin route for every HTTP verb (55 cases), so a new admin endpoint is covered automatically; object isolation (other users' orders and cart items return `404`); immediate effect of demotion and suspension; checkout success, idempotent replays (a replayed decline repeats its `402`), insufficient stock with full rollback, declined payments releasing stock and an order cancelled while payment is in flight; the complete state-machine transition table; failed refunds rolling back; pending-order expiry; catalog filters and validation; audit diffs; security headers; the JSON error envelope for unknown routes and unhandled errors (with no details leaked); the dashboard maths; and a contract test that keeps the rules the storefront quotes (`frontend/src/lib/storeRules.ts`) equal to the server's defaults.

The concurrency guarantees have their own tests on PostgreSQL, with real threads: **eight shoppers race for three units and exactly three orders succeed while stock ends at zero; six retries with one idempotency key for the last unit all get the same single order; six refreshes with one token never mint more than one session; and a refund is requested without holding any product row lock.** They run in CI against a PostgreSQL service container (and are skipped on SQLite).

**Frontend**: the API client (silent refresh on `401`, deduplicated concurrent refreshes, no refresh for anonymous calls, nested field errors), redirect-target sanitising, form schemas, and full route rendering with MSW for the shop, product, bag, sign-in, registration, admin guard, command palette and checkout (including a fresh idempotency key after a decline, the same key on a retry after a dropped connection, with no claim that nothing was charged, and inline validation), noindex on private and not-found pages, and the footer credit. The tests wait on real milestones (MSW responses, loaded modules) rather than polling deadlines, so they behave the same on a loaded CI machine.

**End-to-end**: Playwright drives the production build (served by `vite preview` with nginx's exact CSP and headers) against a live, seeded API: home in both themes, shop filters, search, the protection page, the product page and its sticky buy bar, the bag popover and mobile drawer, a real checkout through the mock provider plus the decline path, a checkout completed with the keyboard alone, noindex and robots.txt, the phone footer's 44px disclosure rows, and the admin dashboard, palette and tables. Every page is checked with axe-core (WCAG 2.2 A/AA, zero serious or critical violations), every test fails on any console error or CSP violation, and the suite checks for horizontal overflow at 390px and infinite animations under reduced motion.

**Measured** (2026-10-22, the Docker stack behind nginx, every route in light and dark at 1440px and 390px): zero serious or critical axe violations, CLS at most 0.01, no horizontal overflow, no touch target under 24px, no console or CSP errors, and Lighthouse desktop 100 for performance, accessibility, best practices and SEO on every public route. Mobile performance (simulated slow 4G, 4x CPU) is 90 to 94. The bag, checkout, orders, admin and not-found pages score 63 to 66 on Lighthouse SEO by design: their `noindex` fails its "is crawlable" audit, which is the only SEO audit they fail. The first visit downloads about 75 KB of app JavaScript plus 102 KB of React (gzipped); forms, toasts, the phone bag drawer and the admin charts load on demand.

**CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs Ruff (backend and `scripts/`), mypy, migration-drift and OpenAPI validation checks and pytest on PostgreSQL with a 90% coverage gate; ESLint, Prettier, `tsc`, Vitest and the production build; the Playwright + axe suite against gunicorn (DEBUG off) on a seeded PostgreSQL; then builds both images, starts the compose stack with `--wait` on its health checks and smoke-tests it through nginx. Actions are pinned to commit SHAs.

## Project structure

```text
.
├── backend/
│   ├── config/                 # env-driven settings, URLs, test settings
│   ├── apps/
│   │   ├── accounts/           # user model, JWT cookie flow, RBAC permission, admin user API
│   │   ├── catalog/            # categories, products, public + admin viewsets, demo data
│   │   ├── cart/               # server-side cart
│   │   ├── orders/             # checkout service, state machine, pricing, order APIs
│   │   ├── payments/           # PaymentProvider interface, mock provider, registry
│   │   ├── audit/              # audit log model, service and admin API
│   │   ├── dashboard/          # admin KPIs
│   │   └── core/               # middleware, error envelope, health check, seed_demo
│   ├── tests/                  # pytest suite
│   └── Dockerfile, docker-entrypoint.sh, pyproject.toml, uv.lock
├── frontend/
│   ├── src/
│   │   ├── auth/               # session context and route guards
│   │   ├── components/         # UI primitives, layout, store and admin components
│   │   ├── pages/              # storefront and admin pages (+ tests)
│   │   ├── lib/                # API client, endpoints, types, validation, formatting
│   │   └── test/               # MSW server, fixtures, render helpers
│   ├── public/products/        # generated product artwork (SVG)
│   ├── e2e/                    # Playwright + axe end-to-end specs
│   ├── nginx/                  # server config and security headers
│   └── Dockerfile, package.json, package-lock.json
├── scripts/                    # product-art generator, screenshot capture
├── docs/screenshots/
├── docker-compose.yml
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
- **Migrations at container start.** Convenient for a single instance. With several replicas, set `RUN_MIGRATIONS=false` and run them as a release job.

## Roadmap (future work, not implemented)

- A real payment provider (Stripe or Razorpay in test mode) implementing the existing `PaymentProvider` interface, with webhook-driven status updates.
- Email verification and password reset.
- Product image uploads to object storage with server-side validation.
- Invoice PDF generation.
- Redis for caching and throttling, plus a scheduler for `expire_pending_orders`.
- Container image scanning.
- Deployment manifests (Kubernetes or a managed container service) with TLS termination.

## License

[MIT](LICENSE) © Arya Mahindrakar

---

Built by **Arya Mahindrakar**, B.Tech Cloud Technology & Information Security.
