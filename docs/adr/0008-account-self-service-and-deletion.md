# 0008. Account self-service: sign out everywhere, data export, account deletion

- Status: accepted
- Date: 2026-10-23

## Context

The API already had `PATCH /api/auth/me/` and `POST /api/auth/password/`, but the
storefront had no account page, so a shopper could not change their name or password,
end a session left open on another device, get a copy of their data, or leave. A
trust-first store needs all four, and deletion has to coexist with order records that the
schema protects (`Order.user` is `on_delete=PROTECT`) and that must be kept for invoicing.

## Options considered

- **Hard delete the user.** This means deleting or reassigning orders first, so invoices are
  lost or orphaned.
- **Deactivate only.** The person's name and email stay in the database indefinitely.
- **Anonymise the account in place (chosen).** Replace the email and name, make the
  password unusable, deactivate, revoke every session, and remove the bag, one-time tokens
  and refresh-token records.

## Decision

- `POST /api/auth/sessions/revoke/` ends every session, this one included. It reuses
  `revoke_all`, so unexpired access tokens die too (session epoch, ADR 0002).
- `GET /api/auth/me/export/` returns the profile, every order (lines, totals, shipping
  snapshot, history), the bag and the user's own audit events (sign-ins, with IP and user
  agent), as a JSON attachment. It is limited per user (`THROTTLE_ACCOUNT_DATA`, 10/hour)
  and audited.
- `POST /api/auth/me/delete/` requires the current password, so a stolen access token alone
  cannot delete an account; the endpoint is under the per-IP credential limit.
  - It is refused (`409`) while an order is pending, paid or shipped: the customer is still
    needed for delivery or refunds.
  - It is refused for administrators, so the store cannot lose its last admin by accident.
  - Otherwise the account is anonymised in one transaction to
    `deleted-<random>@deleted.invalid`, and the freed address can register again.
- The account page (`/account`, noindex) offers all of this, with confirmation dialogs for
  the two destructive actions.

## Consequences

- Orders keep the shipping name and address captured at checkout, because invoices must be
  retained. Earlier audit rows keep the email they recorded (security records with their own
  retention). Both are stated on the page and in this ADR, not hidden.
- Deletion is final: there is no undo window. A soft-delete grace period would need a
  scheduled purge job; the scheduler from ADR 0004 could host one later.
