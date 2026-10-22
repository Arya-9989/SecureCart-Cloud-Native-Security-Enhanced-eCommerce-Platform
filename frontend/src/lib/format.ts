import type { OrderStatus } from "./types";

const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(value: string | number, currency = "USD"): string {
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
    moneyFormatters.set(currency, formatter);
  }
  const amount = typeof value === "number" ? value : Number.parseFloat(value);
  return formatter.format(Number.isFinite(amount) ? amount : 0);
}

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Pending payment",
  paid: "Paid",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  payment_failed: "Payment failed",
};

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]?.[0], parts.at(-1)?.[0]] : [parts[0]?.[0]];
  return letters.join("").toUpperCase() || "?";
}

/** Random key per checkout attempt; reused on retries so the server can deduplicate. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
