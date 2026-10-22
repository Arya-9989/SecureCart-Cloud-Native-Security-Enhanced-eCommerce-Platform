import { describe, expect, it } from "vitest";

import { formatMoney } from "./format";
import { safeNext } from "./redirect";
import { checkoutSchema, productSchema } from "./validation";

describe("safeNext", () => {
  it.each([
    ["/orders", "/orders"],
    ["/shop?category=audio", "/shop?category=audio"],
    ["//evil.example.com", "/"],
    ["/\\evil.example.com", "/"],
    ["https://evil.example.com", "/"],
    ["javascript:alert(1)", "/"],
    [null, "/"],
  ])("maps %s to %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});

describe("checkoutSchema", () => {
  const valid = {
    name: "Ada Lovelace",
    line1: "12 Analytical Way",
    city: "London",
    postal_code: "EC1A 1BB",
    country: "GB",
    payment_token: "tok_mock_approve",
  };

  it("accepts a complete address", () => {
    expect(checkoutSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects malformed postal codes and payment tokens", () => {
    expect(checkoutSchema.safeParse({ ...valid, postal_code: "<script>" }).success).toBe(false);
    for (const token of ["", "pm card", "<script>", "x".repeat(129)]) {
      expect(checkoutSchema.safeParse({ ...valid, payment_token: token }).success).toBe(false);
    }
  });

  it("accepts any provider's test method ids", () => {
    for (const token of ["tok_mock_decline", "pm_card_visa", "pm_card_chargeDeclined"]) {
      expect(checkoutSchema.safeParse({ ...valid, payment_token: token }).success).toBe(true);
    }
  });
});

describe("productSchema", () => {
  const valid = {
    name: "Pulse Speaker",
    sku: "AUD-PULSE",
    description: "",
    category_id: "1",
    price: "59.00",
    stock: "12",
    image_url: "/products/pulse.svg",
    is_active: true,
    is_featured: false,
  };

  it("coerces numeric fields", () => {
    const parsed = productSchema.parse(valid);
    expect(parsed.category_id).toBe(1);
    expect(parsed.stock).toBe(12);
  });

  it.each([
    ["price", "0"],
    ["price", "-3"],
    ["price", "1.999"],
    ["stock", "-1"],
    ["sku", "bad sku"],
    ["image_url", "javascript:alert(1)"],
    ["image_url", "//evil.example.com/x.png"],
    ["image_url", "http://insecure.example.com/x.png"],
  ])("rejects %s=%s", (field, value) => {
    expect(productSchema.safeParse({ ...valid, [field]: value }).success).toBe(false);
  });
});

describe("formatMoney", () => {
  it("formats decimal strings as currency", () => {
    expect(formatMoney("1234.5")).toBe("$1,234.50");
    expect(formatMoney("not-a-number")).toBe("$0.00");
  });
});
