# 0003. Stripe PaymentIntents behind PaymentProvider, with webhook-driven order status

- Status: accepted
- Date: 2026-10-23

## Context

Checkout called `PaymentProvider.charge()` and trusted its answer synchronously. That fits
the offline mock, but not a real gateway:

- A card can need more time (3-D Secure, bank processing).
- A network failure after the request reached the gateway leaves the outcome unknown.
- The gateway's own record (delivered by webhook) is the source of truth.

The webhook endpoint is public and unauthenticated by design, so it has to authenticate
every message itself and survive replays.

The work must run without a Stripe account. CI uses `stripe/stripe-mock` (Stripe's official
mock, which validates every request against the real OpenAPI spec but returns canned
objects) plus webhook fixtures signed with Stripe's published algorithm. A live run needs
the owner's test-mode keys.

## Options considered

- **Stripe Checkout (hosted page).** It has the least code, but it redirects away from the
  storefront and hides the PaymentIntent lifecycle this project is meant to show.
- **PaymentIntents confirmed client-side with Stripe Elements.** This is the production
  pattern for collecting real cards. It needs Stripe.js from `js.stripe.com`, which loosens
  the strict CSP (`script-src 'self'`), and a live publishable key to demonstrate.
- **PaymentIntents created and confirmed server-side for a PaymentMethod id (chosen).**
  Stripe's documented test PaymentMethods (`pm_card_visa`, `pm_card_chargeDeclined`) make
  this a real test-mode payment with no card data anywhere and no CSP change. The
  PaymentIntent and webhook machinery are identical to the Elements flow, so adding
  Elements later changes only how the PaymentMethod id is obtained.

## Decision

- **`StripePaymentProvider` implements the existing `PaymentProvider` interface.**
  - The interface gains `confirms_asynchronously`, `retrieve`, `cancel`, a `pending` flag
    on `ChargeResult`, and `public_config()`, which serves `GET /api/payments/config/` so
    checkout renders the provider's test methods.
  - The mock stays the default and is unchanged in behaviour.
- **Charging.**
  - One PaymentIntent per order, created with `confirm=true`, cards only (no redirects),
    `metadata.order_id`, and the idempotency key `charge-<order id>`.
  - Amounts are converted to minor units with zero-decimal currencies handled.
  - The client has a 10 s timeout and 2 network retries.
- **Result mapping.**
  - A decline (`CardError`, or `requires_payment_method`) is final: `402`, stock released.
  - `succeeded`, `processing` or `requires_action` leave the order `pending_payment`, and
    checkout answers `202`.
  - A connection error or 5xx is reported as **pending, never declined**, because Stripe
    may have captured the money.
- **Webhook-driven status** (`POST /api/payments/webhooks/stripe/`, a raw-body Django view):
  1. Verify the signature with the official library: HMAC-SHA256 over `"{t}.{body}"`,
     constant-time, with any `v1` signature accepted during secret rotation.
  2. Reject timestamps older than `STRIPE_WEBHOOK_TOLERANCE_SECONDS` (300).
  3. Reject an event whose `livemode` differs from the key's mode.
  4. Insert the event id into `WebhookEvent` (unique) **in the same transaction as its
     effect**. A replay or redelivery then becomes `duplicate`, concurrent deliveries
     serialise on the index, and a failed effect rolls the id back so Stripe's retry is
     processed.
  5. Bind the PaymentIntent to the order through `metadata.order_id`, a provider match, and
     the stored reference. Unknown orders are acknowledged and ignored, so Stripe does not
     retry them forever.
  6. On success, the received amount and currency must equal the order's. A mismatch is
     audited and the order is not paid.
- **Effects.**
  - `succeeded` marks the order paid and consumes the bag. If the order was cancelled or
    expired meanwhile, the payment is refunded (idempotency key `late-<order id>`).
  - `payment_failed` releases the stock.
  - `canceled` cancels only an order that is still pending: it can never refund a paid
    order.
- **Reconciliation.** `expire_pending_orders` asks Stripe about stale pending orders before
  cancelling them:
  - `succeeded` is marked paid (the webhook was lost);
  - `processing` is left alone;
  - anything else is cancelled at Stripe, then here.
- **Safety switches.**
  - Live keys (`sk_live_`, `rk_live_`) are refused unless `STRIPE_ALLOW_LIVE_MODE=true`.
  - The provider refuses to start without `STRIPE_WEBHOOK_SECRET`.

## Consequences

- With Stripe, a successful checkout answers `202` and the order page polls (every 2 s,
  for about 3 minutes) until the webhook lands. The mock still answers `201` with a paid
  order.
- stripe-mock is stateless and always answers `requires_payment_method`. Integration tests
  against it therefore prove request validity and response handling. Status transitions
  are proven by unit tests with constructed PaymentIntents and by signed webhook fixtures.
- Collecting real cards needs Stripe Elements (Stripe.js, plus a CSP allowance for
  `js.stripe.com`). That is not built; live mode stays off and is refused by default.
- Running live test mode needs the owner's `STRIPE_SECRET_KEY` (`sk_test_...`) and
  `STRIPE_WEBHOOK_SECRET`, which comes from `stripe listen --forward-to
  localhost:8080/api/payments/webhooks/stripe/`. The README has the exact `.env`.
