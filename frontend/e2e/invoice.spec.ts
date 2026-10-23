import { readFile } from "node:fs/promises";

import { ACCOUNTS, apiAuth, expect, signIn, test } from "./fixtures";

test.describe("Invoice", () => {
  test("a customer downloads the PDF for a paid order; another account cannot", async ({
    page,
    request,
  }) => {
    const headers = await apiAuth(request, "customer");
    const list = await request.get("/api/orders/?page_size=50", { headers });
    const orders = (await list.json()) as {
      results: { id: string; number: string; status: string }[];
    };
    const paid = orders.results.find((o) => ["paid", "shipped", "delivered"].includes(o.status));
    if (!paid) throw new Error("the seeded customer has no paid order; run seed_demo");

    await signIn(page, "customer");
    await page.goto(`/orders/${paid.id}`);
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download invoice" }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(`invoice-${paid.number}.pdf`);
    const path = await download.path();
    const bytes = await readFile(path);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");

    // The admin may read it too; nobody else gets past "not found".
    const adminHeaders = await apiAuth(request, "admin");
    const asAdmin = await request.get(`/api/admin/orders/${paid.id}/invoice/`, {
      headers: adminHeaders,
    });
    expect(asAdmin.status()).toBe(200);
    const anonymous = await request.get(`/api/orders/${paid.id}/invoice/`);
    expect(anonymous.status()).toBe(401);
    // Another seeded customer (seed_demo gives every demo customer the same password).
    const other = await request.post("/api/auth/login/", {
      data: { email: "liam@example.com", password: ACCOUNTS.customer.password },
    });
    expect(other.ok()).toBe(true);
    const { access } = (await other.json()) as { access: string };
    const asOther = await request.get(`/api/orders/${paid.id}/invoice/`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    expect(asOther.status()).toBe(404);
  });
});
