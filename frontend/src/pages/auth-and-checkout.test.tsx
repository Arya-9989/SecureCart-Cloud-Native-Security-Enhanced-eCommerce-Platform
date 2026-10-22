import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { admin, customer, makeOrder, server } from "@/test/server";
import { renderApp } from "@/test/utils";

describe("Login", () => {
  it("validates input before calling the API", async () => {
    const { user } = renderApp("/login");
    await user.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByText("Enter your password")).toBeInTheDocument();
  });

  it("shows the server's generic error on bad credentials", async () => {
    server.use(
      http.post("*/api/auth/login/", () =>
        HttpResponse.json(
          { error: { code: "authentication_failed", message: "Invalid email or password." } },
          { status: 401 },
        ),
      ),
    );
    const { user } = renderApp("/login");
    await user.type(await screen.findByLabelText("Email"), "maya@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
  });

  it("signs in and returns to the requested page", async () => {
    server.use(
      http.post("*/api/auth/login/", () => HttpResponse.json({ access: "tok", user: customer })),
      http.get("*/api/orders/", () =>
        HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
      ),
    );
    const { user, router } = renderApp("/login?next=%2Forders");
    await user.type(await screen.findByLabelText("Email"), "maya@example.com");
    await user.type(screen.getByLabelText("Password"), "SecureCart!Demo1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/orders");
    });
    expect(await screen.findByText("No orders yet")).toBeInTheDocument();
  });

  it("ignores off-site redirect targets", async () => {
    server.use(
      http.post("*/api/auth/login/", () => HttpResponse.json({ access: "tok", user: customer })),
    );
    const { user, router } = renderApp("/login?next=%2F%2Fevil.example.com");
    await user.type(await screen.findByLabelText("Email"), "maya@example.com");
    await user.type(screen.getByLabelText("Password"), "x");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
  });
});

describe("Register", () => {
  it("maps server field errors onto the form", async () => {
    server.use(
      http.post("*/api/auth/register/", () =>
        HttpResponse.json(
          {
            error: {
              code: "invalid",
              message: "Invalid input.",
              fields: { email: ["An account with this email already exists."] },
            },
          },
          { status: 400 },
        ),
      ),
    );
    const { user } = renderApp("/register");
    await user.type(await screen.findByLabelText("Full name"), "Maya Patel");
    await user.type(screen.getByLabelText("Email"), "maya@example.com");
    await user.type(screen.getByLabelText("Password"), "long-enough-pass");
    await user.type(screen.getByLabelText("Confirm password"), "long-enough-pass");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(
      await screen.findByText("An account with this email already exists."),
    ).toBeInTheDocument();
  });

  it("checks that passwords match", async () => {
    const { user } = renderApp("/register");
    await user.type(await screen.findByLabelText("Password"), "long-enough-pass");
    await user.type(screen.getByLabelText("Confirm password"), "different-pass");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Passwords don't match")).toBeInTheDocument();
  });
});

describe("Admin guard", () => {
  it("refuses customers", async () => {
    renderApp("/admin", { user: customer });
    expect(await screen.findByText("Administrator access required")).toBeInTheDocument();
  });

  it("renders the dashboard for admins", async () => {
    server.use(
      http.get("*/api/admin/dashboard/", () =>
        HttpResponse.json({
          currency: "USD",
          revenue_total: "5120.00",
          revenue_30d: "2100.00",
          average_order_value: "160.00",
          orders_total: 32,
          orders_by_status: {
            pending_payment: 0,
            paid: 3,
            shipped: 5,
            delivered: 20,
            cancelled: 2,
            payment_failed: 2,
          },
          customers_total: 6,
          products_active: 18,
          revenue_by_day: [{ date: "2026-10-22", revenue: "120.00", orders: 1 }],
          top_products: [
            {
              product_id: 1,
              product_name: "Aurora Wireless Headphones",
              units: 9,
              revenue: "1701.00",
            },
          ],
          low_stock: [{ id: 3, name: "Arc Laptop Stand", sku: "WRK-ARC", stock: 0 }],
        }),
      ),
    );
    renderApp("/admin", { user: admin });
    expect(await screen.findByText("$5,120.00")).toBeInTheDocument();
    expect(screen.getByText("Out of stock")).toBeInTheDocument();
    expect(screen.getByText("Aurora Wireless Headphones")).toBeInTheDocument();
  });
});

describe("Checkout", () => {
  async function fillAddress(user: ReturnType<typeof renderApp>["user"]) {
    await user.type(await screen.findByLabelText("Street address"), "1 Market Street");
    await user.type(screen.getByLabelText("City"), "Austin");
    await user.type(screen.getByLabelText("Postal code"), "78701");
  }

  it("places the order with an idempotency key and opens the confirmation", async () => {
    const keys: (string | null)[] = [];
    let body: unknown = null;
    server.use(
      http.post("*/api/checkout/", async ({ request }) => {
        keys.push(request.headers.get("Idempotency-Key"));
        body = await request.json();
        return HttpResponse.json(makeOrder(), { status: 201 });
      }),
      http.get("*/api/orders/:id/", () => HttpResponse.json(makeOrder())),
    );
    const { user, router } = renderApp("/checkout", { user: customer });
    await fillAddress(user);
    await user.click(screen.getByRole("button", { name: /Place order/ }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/orders/${makeOrder().id}`);
    });
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toMatchObject({
      payment_token: "tok_mock_approve",
      shipping_address: { name: "Maya Patel", city: "Austin", country: "US" },
    });
    expect(await screen.findByText("Thank you. Your order is confirmed.")).toBeInTheDocument();
  });

  it("explains a decline and uses a fresh key for the next attempt", async () => {
    const keys: (string | null)[] = [];
    server.use(
      http.post("*/api/checkout/", ({ request }) => {
        keys.push(request.headers.get("Idempotency-Key"));
        return HttpResponse.json(
          { error: { code: "payment_declined", message: "Card declined (mock).", order_id: "x" } },
          { status: 402 },
        );
      }),
    );
    const { user } = renderApp("/checkout", { user: customer });
    await fillAddress(user);
    await user.click(screen.getByRole("button", { name: /Place order/ }));
    expect(await screen.findByText("Card declined (mock).")).toBeInTheDocument();
    expect(screen.getByText("Nothing was charged and your bag is unchanged.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Place order/ }));
    await waitFor(() => {
      expect(keys).toHaveLength(2);
    });
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("lists items that ran out of stock", async () => {
    server.use(
      http.post("*/api/checkout/", () =>
        HttpResponse.json(
          {
            error: {
              code: "insufficient_stock",
              message: "Some items are no longer available in that quantity.",
              items: [
                { product_id: 1, name: "Aurora Wireless Headphones", requested: 3, available: 1 },
              ],
            },
          },
          { status: 409 },
        ),
      ),
    );
    const { user } = renderApp("/checkout", { user: customer });
    await fillAddress(user);
    await user.click(screen.getByRole("button", { name: /Place order/ }));
    expect(
      await screen.findByText("Aurora Wireless Headphones: requested 3, 1 available"),
    ).toBeInTheDocument();
  });
});
