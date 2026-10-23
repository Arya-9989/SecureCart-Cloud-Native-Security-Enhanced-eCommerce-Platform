# 0002. Email verification and password reset

- Status: accepted
- Date: 2026-10-23

## Context

Accounts had no recovery path, and nothing proved that a shopper's address was real. Both
features hand out bearer secrets by email, so they are a classic place to add weaknesses:
guessable or reusable links, links that leak through logs, endpoints that reveal which
addresses are registered, mailbombing, and "reset" flows that leave the attacker's session
alive.

The existing session model is a short-lived JWT access token (10 minutes, held in memory)
plus a rotating refresh token in an httpOnly cookie, with reuse detection. `revoke_all`
blacklisted refresh tokens only. Access tokens already issued kept working until they
expired, so "sign out everywhere" was really "sign out everywhere within 10 minutes".

## Options considered

**Token format.**
- Django's `PasswordResetTokenGenerator` (an HMAC over user state). It is stateless and
  invalidated by a password change. But it cannot be revoked individually, issuing a new one
  does not supersede the old one, and it is not single-use for verification.
- **A random secret with its hash stored in a table (chosen).** 32 bytes from `secrets`;
  only the SHA-256 is stored. With 256 bits of entropy a fast hash is correct: there is
  nothing to brute-force, and lookups by hash keep the comparison inside the database index.
  Each row has a purpose, expiry and `used_at`, plus a snapshot of the address it was sent to.

**Revoking access tokens.**
- A denylist of access-token JTIs. That means one write per live token, and it has to be
  checked on every request.
- Comparing `iat` with a `sessions_revoked_at` timestamp. This has one-second granularity,
  so tokens issued in the same second as the revocation survive it.
- **A per-user session epoch carried in every token (chosen).** `revoke_all` increments
  `User.session_epoch`. Tokens carry the epoch they were minted in (claim `sev`). Bearer
  authentication rejects a mismatch, and so does refresh rotation. The user row is already
  loaded on every request (roles are read from the database), so the check is free.

**Email delivery.**
- A synchronous send. Its latency would differ between registered and unregistered
  addresses, which is an enumeration oracle.
- A persisted outbox. The body contains the raw secret, so persisting it would undo the
  hashing.
- **On commit, on a small in-process thread pool, with bounded retries (chosen).** A dropped
  message is logged (without the link), and the user asks again.

## Decision

- Endpoints:
  - `POST /api/auth/password/forgot/` always answers `202` with the same body and headers.
  - `POST /api/auth/password/reset/` takes `{token, new_password}`.
  - `POST /api/auth/email/verify/` takes `{token}`.
  - `POST /api/auth/email/resend/` requires authentication.
  - Registration sends a verification link.
- **Single use and expiry.** Consuming a token locks its row (`SELECT ... FOR UPDATE`), and
  the token's effect runs in the same transaction. A rejected new password therefore rolls
  the consumption back and the link still works. A newer token supersedes older ones of the
  same purpose. Reset links last 30 minutes and verification links 24 hours (both
  configurable). A token dies if the account is suspended or its address changes.
- **No enumeration.**
  - Forgot-password returns an identical status, body and headers whether the address is
    registered, unknown or suspended.
  - It never answers sooner than `ACCOUNT_RECOVERY_MIN_RESPONSE_MS` (400 ms).
  - Mail is sent off the request path.
  - The per-recipient budget is spent for unknown addresses too.
- **Rate limits.** `account_email` (5/min per IP) on the endpoints that send mail, and a
  silent per-recipient budget (3/hour, keyed by a hash of the address) so a victim's inbox
  cannot be flooded. Token submission uses the existing per-IP `auth` limit (10/min).
- **A reset ends every session.**
  - It bumps the session epoch, which kills unexpired access tokens.
  - It blacklists every refresh token.
  - It supersedes outstanding reset links.
  - It emails a "your password was changed" notice and writes an audit event.
- **Links put the secret in the URL fragment** (`/reset-password#token=...`), which browsers
  never send to servers, so it cannot reach access logs, proxies or `Referer`. The SPA reads
  it once and then strips it from the address bar and history.
- **Checkout requires a confirmed address** (`REQUIRE_VERIFIED_EMAIL`, default on). It
  answers `403 email_unverified` before anything is reserved. The bag and checkout explain
  this and offer a fresh link. Seeded demo accounts are pre-confirmed.
- **SMTP comes from environment variables** (`EMAIL_HOST`, `EMAIL_PORT`, TLS/SSL, the
  credentials, a 10 s timeout). The console backend is refused unless `DEBUG` is on,
  because it would print reset links to the log. Compose ships Mailpit as the local SMTP
  sink.

## Consequences

- The epoch also hardens the existing flows that call `revoke_all`: password change, role
  or status change by an admin, and refresh-token reuse. Each now ends live access tokens
  immediately, not up to 10 minutes later.
- It closes a race that existed before: a refresh rotation committing while `revoke_all`
  ran could mint a token outside the blacklist sweep. The new PostgreSQL test
  `test_refresh_racing_a_revocation_never_leaves_a_live_session` fails 3 out of 3 runs with
  the epoch check removed, and passes with it.
- Tokens issued before this release carry no epoch claim and count as epoch 0, so nobody is
  signed out by the upgrade.
- Existing accounts start unconfirmed (`email_verified_at` is null) and must confirm before
  their next checkout. The migration does not mark them as confirmed, because nothing ever
  proved their addresses.
- In-process delivery can lose a message if the worker dies between commit and send. The
  user sees "check your email" and can ask again; the secret itself is never at risk.
- Registration still says "an account with this email already exists". It signs the new
  user in immediately, so it cannot give the same answer for an existing address. It is
  limited to 10 attempts a minute per IP. This is recorded as a known limitation rather than
  hidden.
