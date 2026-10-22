/**
 * The store's rules as the API applies them by default (`backend/config/settings.py`).
 * Storefront copy quotes these numbers, so they live in one place, and the backend test
 * `tests/test_platform.py::TestStoreRulesContract` fails if they drift from the server's
 * defaults. If a deployment overrides FREE_SHIPPING_THRESHOLD, FLAT_SHIPPING_FEE, TAX_RATE,
 * MAX_CART_LINE_QUANTITY, JWT_ACCESS_MINUTES, JWT_REFRESH_DAYS, THROTTLE_AUTH,
 * PASSWORD_RESET_TTL_MINUTES or EMAIL_VERIFICATION_TTL_HOURS, change the matching value here
 * too. Totals are always computed by the server.
 */
export const STORE_RULES = {
  freeShippingFrom: 75,
  flatShippingFee: 6.99,
  taxPercent: 8,
  maxPerLine: 10,
  accessTokenMinutes: 10,
  refreshTokenDays: 7,
  signInAttemptsPerMinute: 10,
  resetLinkMinutes: 30,
  verifyLinkHours: 24,
} as const;

const whole = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** "$75" and "$6.99", as the copy writes them. */
export const FREE_SHIPPING_FROM = `$${whole(STORE_RULES.freeShippingFrom)}`;
export const FLAT_SHIPPING_FEE = `$${whole(STORE_RULES.flatShippingFee)}`;
