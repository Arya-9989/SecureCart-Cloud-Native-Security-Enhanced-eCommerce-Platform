import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { responseTo } from "@/test/network";
import { admin, page, server } from "@/test/server";
import { renderApp } from "@/test/utils";

/* Waits are tied to MSW responses and loaded modules, never to wall-clock deadlines. */

beforeAll(async () => {
  await Promise.all([
    import("@/components/layout/AdminLayout"),
    import("@/pages/admin/OrdersPage"),
  ]);
}, 60_000);

describe("Admin order export", () => {
  let saved: string | null = null;

  beforeEach(() => {
    saved = null;
    Object.assign(URL, { createObjectURL: () => "blob:csv", revokeObjectURL: () => undefined });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved = this.download;
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("exports the orders matching the current filters", async () => {
    server.use(
      http.get("*/api/admin/orders/", () => HttpResponse.json(page([]))),
      http.get("*/api/admin/orders/export/", () => {
        return new HttpResponse("number,total\n", {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="orders-20261023-0100.csv"',
          },
        });
      }),
    );
    const listed = responseTo("GET", "/api/admin/orders/");
    const { user } = renderApp("/admin/orders?status=shipped&search=maya", { user: admin });
    await listed;
    const exported = responseTo("GET", "/api/admin/orders/export/");
    await user.click(await screen.findByRole("button", { name: "Export CSV" }));
    const requested = new URL((await exported).url);
    await vi.waitFor(() => {
      expect(saved).toBe("orders-20261023-0100.csv");
    });
    expect(requested.searchParams.get("status")).toBe("shipped");
    expect(requested.searchParams.get("search")).toBe("maya");
  });
});
