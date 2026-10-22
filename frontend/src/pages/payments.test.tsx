import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeAll, describe, expect, it } from "vitest";

import { responseTo } from "@/test/network";
import { customer, makeOrder, server } from "@/test/server";
import { renderApp } from "@/test/utils";

/* Waits are tied to MSW responses and loaded modules, never to wall-clock deadlines. */

beforeAll(async () => {
  await import("@/pages/CheckoutPage");
}, 60_000);

const stripeConfig = {
  provider: "stripe",
  mode: "test",
  confirms_asynchronously: true,
  test_methods: [
    { token: "pm_card_visa", label: "Test card: Visa", description: "Stripe approves this card." },
    {
      token: "pm_card_chargeDeclined",
      label: "Test card: declined",
      description: "Stripe declines this card.",
    },
  ],
};

describe("Checkout with Stripe in test mode", () => {
  it("offers Stripe's test methods and sends the chosen one", async () => {
    let sent: unknown = null;
    const pending = makeOrder({ status: "pending_payment", payment_provider: "stripe" });
    server.use(
      http.get("*/api/payments/config/", () => HttpResponse.json(stripeConfig)),
      http.post("*/api/checkout/", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(pending, { status: 202 });
      }),
      http.get("*/api/orders/:id/", () => HttpResponse.json(pending)),
    );
    const configured = responseTo("GET", "/api/payments/config/");
    const { user, router } = renderApp("/checkout", { user: customer });
    await configured;
    await screen.findByRole("heading", { name: "Checkout." });
    expect(await screen.findByText("Stripe test mode")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Test card: Visa/ })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: /Test card: declined/ }));
    await user.type(screen.getByLabelText("Street address"), "1 Market Street");
    await user.type(screen.getByLabelText("City"), "Austin");
    await user.type(screen.getByLabelText("Postal code"), "78701");
    const placed = responseTo("POST", "/api/checkout/");
    await user.click(screen.getByRole("button", { name: /Place order/ }));
    await placed;
    expect(sent).toMatchObject({ payment_token: "pm_card_chargeDeclined" });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/orders/${pending.id}`);
    });
  });
});

describe("An order awaiting the provider's webhook", () => {
  it("says the payment is being confirmed, then shows the confirmation once paid", async () => {
    let reads = 0;
    const pending = makeOrder({ status: "pending_payment", payment_provider: "stripe" });
    server.use(
      http.get("*/api/orders/:id/", () => {
        reads += 1;
        return HttpResponse.json(
          reads === 1 ? pending : { ...pending, status: "paid", paid_at: "2026-10-23T00:00:00Z" },
        );
      }),
    );
    const firstRead = responseTo("GET", `/api/orders/${pending.id}/`);
    renderApp(`/orders/${pending.id}?placed=1`, { user: customer });
    await firstRead;
    expect(
      await screen.findByRole("heading", { name: "Confirming your payment." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Stripe \(test mode\) is confirming the charge/)).toBeInTheDocument();
    // The page polls (every 2 s); the next read reports the webhook's outcome.
    await responseTo("GET", `/api/orders/${pending.id}/`);
    expect(
      await screen.findByRole("heading", { name: "Thank you. Your order is confirmed." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/captured by Stripe \(test mode\)/)).toBeInTheDocument();
  });
});
