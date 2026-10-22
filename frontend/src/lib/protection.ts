import { KeyRound, Lock, ScrollText, ShoppingBag, type LucideIcon } from "lucide-react";

import { STORE_RULES as R } from "./storeRules";

/**
 * The "how your order is protected" story. Every sentence here describes a mechanism that
 * exists in this repository (the `source` path says where), so the trust cues shown at
 * sign-in, bag, checkout and confirmation are claims the code backs up. Keep it that way:
 * if a mechanism changes, change this file in the same commit.
 */
export interface Protection {
  id: "sign-in" | "bag" | "checkout" | "after";
  stage: string;
  icon: LucideIcon;
  title: string;
  summary: string;
  details: string[];
  source: string;
}

export const PROTECTIONS: Protection[] = [
  {
    id: "sign-in",
    stage: "Sign-in",
    icon: KeyRound,
    title: "A session scripts can't read.",
    summary:
      "Your long-lived refresh token sits in a cookie JavaScript cannot touch, and the short-lived access token stays in memory, never in browser storage.",
    details: [
      "Passwords are hashed with Argon2, and new ones must pass length, common-password and similarity checks.",
      "The refresh cookie is httpOnly, Secure and SameSite=Strict, and is only sent to /api/auth/.",
      `Access tokens expire after ${R.accessTokenMinutes} minutes and live only in memory.`,
      "Each refresh rotates the token. Replaying a used one revokes every session on the account.",
      `Sign-in, registration and password changes are limited to ${R.signInAttemptsPerMinute} attempts a minute per IP address, and a wrong email or password gets the same answer.`,
    ],
    source: "backend/apps/accounts",
  },
  {
    id: "bag",
    stage: "Bag",
    icon: ShoppingBag,
    title: "Live stock, honest limits.",
    summary:
      "Your bag is kept on the server against your account, and every quantity is checked against the stock actually on hand.",
    details: [
      "Your bag follows you to any device you sign in on.",
      `Each line is capped at ${R.maxPerLine}, and never above the units in stock.`,
      "Nothing is held back from other shoppers until you place the order.",
    ],
    source: "backend/apps/cart",
  },
  {
    id: "checkout",
    stage: "Checkout",
    icon: Lock,
    title: "Charged once. Never oversold.",
    summary:
      "Placing an order locks the stock rows, reserves every line together, and only then takes payment.",
    details: [
      "Stock rows are locked in a fixed order, so two shoppers can never both buy the last unit.",
      "Every line is reserved together or not at all, with a database rule that stock can't go below zero.",
      "Each attempt carries an idempotency key, so a retry can't charge or reserve twice.",
      "Card details never reach this store. The browser sends only a payment token.",
      "If a payment is declined, the reserved stock is released straight away.",
    ],
    source: "backend/apps/orders/checkout.py",
  },
  {
    id: "after",
    stage: "After you order",
    icon: ScrollText,
    title: "Every change, on the record.",
    summary:
      "An order's status can only move through one state machine, and each step is written to its history.",
    details: [
      "You can cancel until the order ships. Stock is restocked and the payment refunded.",
      "Order links use random IDs, and any other account asking for your order gets “not found”.",
      "Staff changes are permission-checked on the server and written to an audit log with who, when and from where.",
    ],
    source: "backend/apps/orders/state.py",
  },
];

export function protection(id: Protection["id"]): Protection {
  const found = PROTECTIONS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown protection: ${id}`);
  return found;
}
