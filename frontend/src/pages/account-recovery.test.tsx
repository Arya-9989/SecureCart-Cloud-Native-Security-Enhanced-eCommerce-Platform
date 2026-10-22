import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeAll, describe, expect, it } from "vitest";

import { responseTo } from "@/test/network";
import { customer, makeOrder, server } from "@/test/server";
import { renderApp } from "@/test/utils";

/* Waits are tied to MSW responses and loaded modules, never to wall-clock deadlines. */

beforeAll(async () => {
  await Promise.all([
    import("@/pages/AccountPages"),
    import("@/pages/AuthPages"),
    import("@/pages/CheckoutPage"),
  ]);
}, 60_000);

const unverified = { ...customer, email_verified: false };
const invalidToken = {
  error: {
    code: "invalid",
    message: "Invalid input.",
    fields: { token: ["This link is invalid or has expired. Ask for a new one."] },
  },
};

describe("Forgot password", () => {
  it("is linked from the sign-in page", async () => {
    renderApp("/login");
    expect(await screen.findByRole("link", { name: "Forgot your password?" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("asks for an address and answers the same way whatever the server knows", async () => {
    let sent: unknown = null;
    server.use(
      http.post("*/api/auth/password/forgot/", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ detail: "If an account exists…" }, { status: 202 });
      }),
    );
    const { user } = renderApp("/forgot-password");
    await user.type(await screen.findByLabelText("Email"), "maya@example.com");
    const answered = responseTo("POST", "/api/auth/password/forgot/");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    await answered;
    expect(await screen.findByRole("heading", { name: "Check your email." })).toBeInTheDocument();
    expect(screen.getByText(/If that address has an account/)).toBeInTheDocument();
    expect(screen.getByText("maya@example.com")).toBeInTheDocument();
    expect(sent).toEqual({ email: "maya@example.com" });
  });

  it("validates the address before calling the API", async () => {
    const { user } = renderApp("/forgot-password");
    await user.click(await screen.findByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
  });

  it("explains a rate limit", async () => {
    server.use(
      http.post("*/api/auth/password/forgot/", () =>
        HttpResponse.json(
          { error: { code: "throttled", message: "Request was throttled." } },
          { status: 429 },
        ),
      ),
    );
    const { user } = renderApp("/forgot-password");
    await user.type(await screen.findByLabelText("Email"), "maya@example.com");
    const answered = responseTo("POST", "/api/auth/password/forgot/");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    await answered;
    expect(await screen.findByRole("alert")).toHaveTextContent("Request was throttled.");
  });
});

describe("Reset password", () => {
  it("reads the secret from the fragment, then removes it from the address bar", async () => {
    let body: unknown = null;
    server.use(
      http.post("*/api/auth/password/reset/", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ detail: "changed" });
      }),
    );
    const { user, router } = renderApp("/reset-password#token=abc123secret");
    await screen.findByRole("heading", { name: "Choose a new password." });
    await waitFor(() => {
      expect(router.state.location.hash).toBe("");
    });
    await user.type(screen.getByLabelText("New password"), "Brand-New-Secret-77!");
    await user.type(screen.getByLabelText("Confirm new password"), "Brand-New-Secret-77!");
    const answered = responseTo("POST", "/api/auth/password/reset/");
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    await answered;
    expect(await screen.findByRole("heading", { name: "Password changed." })).toBeInTheDocument();
    expect(body).toEqual({ token: "abc123secret", new_password: "Brand-New-Secret-77!" });
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("shows the server's password rules next to the field", async () => {
    server.use(
      http.post("*/api/auth/password/reset/", () =>
        HttpResponse.json(
          {
            error: {
              code: "invalid",
              message: "Invalid input.",
              fields: { new_password: ["This password is too common."] },
            },
          },
          { status: 400 },
        ),
      ),
    );
    const { user } = renderApp("/reset-password#token=abc");
    await user.type(await screen.findByLabelText("New password"), "password1234");
    await user.type(screen.getByLabelText("Confirm new password"), "password1234");
    const answered = responseTo("POST", "/api/auth/password/reset/");
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    await answered;
    expect(await screen.findByText("This password is too common.")).toBeInTheDocument();
  });

  it("turns a used or expired link into a way to get a new one", async () => {
    server.use(
      http.post("*/api/auth/password/reset/", () =>
        HttpResponse.json(invalidToken, { status: 400 }),
      ),
    );
    const { user } = renderApp("/reset-password#token=stale");
    await user.type(await screen.findByLabelText("New password"), "Brand-New-Secret-77!");
    await user.type(screen.getByLabelText("Confirm new password"), "Brand-New-Secret-77!");
    const answered = responseTo("POST", "/api/auth/password/reset/");
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    await answered;
    expect(
      await screen.findByRole("heading", { name: "This link has expired." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get a new link" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("handles a link without a secret", async () => {
    renderApp("/reset-password");
    expect(
      await screen.findByRole("heading", { name: "This link has expired." }),
    ).toBeInTheDocument();
  });

  it("is kept out of search results", async () => {
    renderApp("/reset-password#token=x");
    await screen.findByRole("heading", { name: "Choose a new password." });
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  });
});

describe("Email confirmation", () => {
  it("confirms once and refreshes the signed-in profile", async () => {
    let posts = 0;
    server.use(
      http.post("*/api/auth/email/verify/", () => {
        posts += 1;
        return HttpResponse.json({ detail: "confirmed" });
      }),
      http.get("*/api/auth/me/", () => HttpResponse.json(customer)),
    );
    const meLoaded = responseTo("GET", "/api/auth/me/");
    renderApp("/verify-email#token=verify-secret", { user: unverified });
    expect(await screen.findByRole("heading", { name: "Email confirmed." })).toBeInTheDocument();
    await meLoaded;
    expect(posts).toBe(1);
    expect(screen.getByRole("link", { name: "Go to your bag" })).toHaveAttribute("href", "/cart");
  });

  it("offers a new link when this one no longer works", async () => {
    server.use(
      http.post("*/api/auth/email/verify/", () => HttpResponse.json(invalidToken, { status: 400 })),
    );
    renderApp("/verify-email#token=used");
    expect(
      await screen.findByRole("heading", { name: "This link has expired." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in to get a new link" })).toBeInTheDocument();
  });
});

describe("Unconfirmed shoppers", () => {
  it("see why they cannot check out yet, and can ask for a fresh link", async () => {
    let resent = 0;
    server.use(
      http.post("*/api/auth/email/resend/", () => {
        resent += 1;
        return HttpResponse.json({ detail: "sent" }, { status: 202 });
      }),
    );
    const bagLoaded = responseTo("GET", "/api/cart/");
    const { user } = renderApp("/cart", { user: unverified });
    await bagLoaded;
    expect(
      await screen.findByRole("heading", { name: "Confirm your email to check out." }),
    ).toBeInTheDocument();
    const answered = responseTo("POST", "/api/auth/email/resend/");
    await user.click(screen.getByRole("button", { name: "Send a new link" }));
    await answered;
    expect(await screen.findByText(/A new link is on its way/)).toBeInTheDocument();
    expect(resent).toBe(1);
  });

  it("confirmed shoppers see no notice", async () => {
    const bagLoaded = responseTo("GET", "/api/cart/");
    renderApp("/cart", { user: customer });
    await bagLoaded;
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText("Confirm your email to check out.")).not.toBeInTheDocument();
  });

  it("are told at checkout when the server refuses an unconfirmed address", async () => {
    server.use(
      http.post("*/api/checkout/", () =>
        HttpResponse.json(
          { error: { code: "email_unverified", message: "Confirm your email address." } },
          { status: 403 },
        ),
      ),
      http.get("*/api/auth/me/", () => HttpResponse.json(unverified)),
      http.get("*/api/orders/:id/", () => HttpResponse.json(makeOrder())),
    );
    const bagLoaded = responseTo("GET", "/api/cart/");
    // The tab still believes the address is confirmed; the server knows better.
    const { user } = renderApp("/checkout", { user: customer });
    await bagLoaded;
    await screen.findByRole("heading", { name: "Checkout." });
    await user.type(screen.getByLabelText("Street address"), "1 Market Street");
    await user.type(screen.getByLabelText("City"), "Austin");
    await user.type(screen.getByLabelText("Postal code"), "78701");
    const refused = responseTo("POST", "/api/checkout/");
    const reloaded = responseTo("GET", "/api/auth/me/");
    await user.click(screen.getByRole("button", { name: /Place order/ }));
    await refused;
    await reloaded;
    expect(
      await screen.findByRole("heading", { name: "Confirm your email to check out." }),
    ).toBeInTheDocument();
  });
});
