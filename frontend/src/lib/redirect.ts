/** Only allow same-site relative redirects to prevent open-redirects via ?next=. */
export function safeNext(raw: string | null, fallback = "/"): string {
  if (!raw?.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}
