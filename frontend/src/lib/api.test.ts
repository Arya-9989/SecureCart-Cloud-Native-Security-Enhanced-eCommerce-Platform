import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { customer, server, session } from "@/test/server";

import { ApiError, apiFetch, refreshSession, setSession } from "./api";

describe("apiFetch", () => {
  it("sends the in-memory access token as a bearer header", async () => {
    let seen: string | null = null;
    server.use(
      http.get("*/api/auth/me/", ({ request }) => {
        seen = request.headers.get("Authorization");
        return HttpResponse.json(customer);
      }),
    );
    setSession("abc");
    await apiFetch("/auth/me/");
    expect(seen).toBe("Bearer abc");
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    session.user = customer;
    const seen: (string | null)[] = [];
    server.use(
      http.get("*/api/orders/", ({ request }) => {
        const auth = request.headers.get("Authorization");
        seen.push(auth);
        return auth === "Bearer fresh-token"
          ? HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
          : HttpResponse.json(
              { error: { code: "token_not_valid", message: "Expired" } },
              { status: 401 },
            );
      }),
    );
    setSession("expired-token");
    const data = await apiFetch<{ count: number }>("/orders/");
    expect(data.count).toBe(0);
    expect(seen).toEqual(["Bearer expired-token", "Bearer fresh-token"]);
  });

  it("does not attempt a refresh for anonymous requests", async () => {
    let refreshes = 0;
    server.use(
      http.post("*/api/auth/refresh/", () => {
        refreshes += 1;
        return HttpResponse.json({}, { status: 401 });
      }),
      http.get("*/api/cart/", () =>
        HttpResponse.json(
          { error: { code: "not_authenticated", message: "Login" } },
          { status: 401 },
        ),
      ),
    );
    await expect(apiFetch("/cart/")).rejects.toMatchObject({ status: 401 });
    expect(refreshes).toBe(0);
  });

  it("deduplicates concurrent refreshes", async () => {
    let refreshes = 0;
    server.use(
      http.post("*/api/auth/refresh/", async () => {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json({ access: "fresh-token", user: customer });
      }),
    );
    const users = await Promise.all([refreshSession(), refreshSession(), refreshSession()]);
    expect(refreshes).toBe(1);
    expect(users.every((u) => u?.email === customer.email)).toBe(true);
  });

  it("parses the error envelope including nested field errors", async () => {
    server.use(
      http.post("*/api/checkout/", () =>
        HttpResponse.json(
          {
            error: {
              code: "invalid",
              message: "Invalid input.",
              fields: { shipping_address: { postal_code: ["Enter a valid value."] } },
            },
          },
          { status: 400 },
        ),
      ),
    );
    const error = await apiFetch("/checkout/", { method: "POST", body: {} }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.fieldError("shipping_address.postal_code")).toBe("Enter a valid value.");
    expect(apiError.fieldError("shipping_address.city")).toBeUndefined();
  });

  it("falls back to a friendly message for unexpected server errors", async () => {
    server.use(http.get("*/api/products/", () => new HttpResponse("boom", { status: 502 })));
    await expect(apiFetch("/products/")).rejects.toThrow(/went wrong on our side/);
  });
});
