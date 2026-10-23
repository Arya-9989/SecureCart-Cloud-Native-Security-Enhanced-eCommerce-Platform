import { apiAuth, expect, expectAccessible, signIn, test } from "./fixtures";

/*
 * Image upload end to end: the admin picks a PNG, the API validates and re-encodes it, the
 * object store keeps it, and the API serves it back as WebP with hardened headers. Needs an
 * API with MEDIA_STORAGE=s3 (CI runs MinIO); skipped otherwise.
 */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Admin image upload", () => {
  test.skip(!process.env.E2E_MEDIA, "set E2E_MEDIA=1 when the API has object storage");

  test("upload, preview and serve a sanitised image", async ({ page, request }) => {
    const headers = await apiAuth(request, "admin");
    const list = await request.get("/api/admin/products/?ordering=name&page_size=1", { headers });
    const product = (
      (await list.json()) as { results: { id: number; name: string; image_url: string }[] }
    ).results.at(0);
    if (!product) throw new Error("no products; run seed_demo");

    try {
      await signIn(page, "admin");
      await page.goto("/admin/products");
      await page.getByRole("button", { name: `Edit ${product.name}` }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("Product image")).toBeVisible();
      // axe reads colours mid-fade otherwise: let the dialog's entrance animation finish.
      await dialog.evaluate((el) =>
        Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
      );
      await expectAccessible(page, "product editor with image upload");

      const uploaded = page.waitForResponse(
        (r) => r.url().endsWith(`/api/admin/products/${product.id}/image/`) && r.status() === 200,
      );
      await dialog.locator('input[type="file"]').setInputFiles({
        name: "pixel.png",
        mimeType: "image/png",
        buffer: PNG_1X1,
      });
      const body = (await (await uploaded).json()) as { image_url: string };
      expect(body.image_url).toMatch(/^\/api\/media\/products\/\d+\/[0-9a-f]{32}\.webp$/);
      await expect(dialog.getByLabel("Image URL")).toHaveValue(body.image_url);

      const served = await request.get(body.image_url);
      expect(served.status()).toBe(200);
      expect(served.headers()["content-type"]).toBe("image/webp");
      expect(served.headers()["x-content-type-options"]).toBe("nosniff");
      expect((await served.body()).subarray(8, 12).toString()).toBe("WEBP");
    } finally {
      // Leave the seeded catalog as it was for the other specs.
      const restore = await request.patch(`/api/admin/products/${product.id}/`, {
        headers,
        data: { image_url: product.image_url },
      });
      expect(restore.ok()).toBe(true);
    }
  });

  test("customers cannot upload", async ({ request }) => {
    const headers = await apiAuth(request, "customer");
    const response = await request.post("/api/admin/products/1/image/", {
      headers,
      multipart: { image: { name: "x.png", mimeType: "image/png", buffer: PNG_1X1 } },
    });
    expect(response.status()).toBe(403);
  });
});
