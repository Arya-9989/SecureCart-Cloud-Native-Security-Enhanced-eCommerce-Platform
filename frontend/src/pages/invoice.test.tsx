import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { responseTo } from "@/test/network";
import { customer, makeOrder, server } from "@/test/server";
import { renderApp } from "@/test/utils";

/* Waits are tied to MSW responses, never to wall-clock deadlines. */

describe("Invoice download", () => {
  const created: string[] = [];
  let clicked: string | null = null;

  beforeEach(() => {
    clicked = null;
    // jsdom has no object URLs; provide the two static methods the download uses.
    Object.assign(URL, {
      createObjectURL: () => {
        created.push("blob:invoice");
        return "blob:invoice";
      },
      revokeObjectURL: () => undefined,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked = this.download;
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("fetches the PDF with the session and saves it under the server's filename", async () => {
    const order = makeOrder();
    let auth: string | null = null;
    server.use(
      http.get("*/api/orders/:id/", () => HttpResponse.json(order)),
      http.get("*/api/orders/:id/invoice/", ({ request }) => {
        auth = request.headers.get("Authorization");
        return new HttpResponse("%PDF-1.4 test", {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="invoice-${order.number}.pdf"`,
          },
        });
      }),
    );
    const loaded = responseTo("GET", `/api/orders/${order.id}/`);
    const { user } = renderApp(`/orders/${order.id}`, { user: customer });
    await loaded;
    const downloaded = responseTo("GET", `/api/orders/${order.id}/invoice/`);
    await user.click(await screen.findByRole("button", { name: "Download invoice" }));
    await downloaded;
    await vi.waitFor(() => {
      expect(clicked).toBe(`invoice-${order.number}.pdf`);
    });
    expect(auth).toBe("Bearer fresh-token");
    expect(created).toContain("blob:invoice");
  });

  it("is not offered for an order that was never paid", async () => {
    const order = makeOrder({ status: "payment_failed", paid_at: null, can_cancel: false });
    server.use(http.get("*/api/orders/:id/", () => HttpResponse.json(order)));
    const loaded = responseTo("GET", `/api/orders/${order.id}/`);
    renderApp(`/orders/${order.id}`, { user: customer });
    await loaded;
    await screen.findByRole("heading", { name: order.number });
    expect(screen.queryByRole("button", { name: "Download invoice" })).not.toBeInTheDocument();
  });
});
