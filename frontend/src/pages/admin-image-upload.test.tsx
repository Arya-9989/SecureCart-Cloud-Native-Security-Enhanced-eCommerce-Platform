import { fireEvent, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeAll, describe, expect, it } from "vitest";

import { checkImageFile } from "@/lib/imageUpload";
import type { AdminProduct } from "@/lib/types";
import { responseTo } from "@/test/network";
import { admin, categories, makeProduct, page, server } from "@/test/server";
import { renderApp } from "@/test/utils";

/* Waits are tied to MSW responses and loaded modules, never to wall-clock deadlines. */

beforeAll(async () => {
  await Promise.all([
    import("@/components/layout/AdminLayout"),
    import("@/pages/admin/ProductsPage"),
  ]);
}, 60_000);

const product: AdminProduct = {
  ...makeProduct(),
  is_active: true,
  updated_at: "2026-10-01T00:00:00Z",
};
const uploadedUrl = "/api/media/products/1/0123456789abcdef0123456789abcdef.webp";

async function openEditor() {
  server.use(
    http.get("*/api/admin/products/", () => HttpResponse.json(page([product]))),
    http.get("*/api/admin/categories/", () => HttpResponse.json(categories)),
  );
  const listed = responseTo("GET", "/api/admin/products/");
  const view = renderApp("/admin/products", { user: admin });
  await listed;
  const categoriesLoaded = responseTo("GET", "/api/admin/categories/");
  await view.user.click(await screen.findByRole("button", { name: `Edit ${product.name}` }));
  await categoriesLoaded;
  const dialog = await screen.findByRole("dialog");
  const input = dialog.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input");
  return { ...view, dialog, input };
}

describe("checkImageFile", () => {
  it("accepts the three raster formats and refuses everything else locally", () => {
    const ok = new File(["x"], "a.png", { type: "image/png" });
    expect(checkImageFile(ok)).toBeNull();
    expect(checkImageFile(new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }))).toMatch(
      /JPEG, PNG or WebP/,
    );
    expect(checkImageFile(new File([], "a.png", { type: "image/png" }))).toMatch(/empty/);
    const huge = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "a.png", { type: "image/png" });
    expect(checkImageFile(huge)).toMatch(/5 MB/);
  });
});

describe("Product image upload (admin)", () => {
  it("uploads as multipart and shows the stored image", async () => {
    let contentType: string | null = null;
    let body = "";
    server.use(
      http.post("*/api/admin/products/:id/image/", async ({ request }) => {
        contentType = request.headers.get("Content-Type");
        body = await request.text();
        return HttpResponse.json({ ...product, image_url: uploadedUrl });
      }),
    );
    const { user, dialog, input } = await openEditor();
    const uploaded = responseTo("POST", `/api/admin/products/${product.id}/image/`);
    await user.upload(input, new File(["png-bytes"], "photo.png", { type: "image/png" }));
    await uploaded;
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
    // jsdom's File crosses into Node's fetch as an empty Blob, so only the part's name and
    // type are meaningful here (the server ignores client filenames anyway). The bytes are
    // covered end to end by the Playwright upload spec and the backend tests.
    expect(body).toContain('name="image"');
    expect(body).toContain("Content-Type: image/png");
    expect(await within(dialog).findByDisplayValue(uploadedUrl)).toBeInTheDocument();
  });

  it("shows the server's reason when an image is refused", async () => {
    server.use(
      http.post("*/api/admin/products/:id/image/", () =>
        HttpResponse.json(
          {
            error: {
              code: "invalid",
              message: "This file contains more than an image and was refused.",
              fields: { image: ["This file contains more than an image and was refused."] },
            },
          },
          { status: 400 },
        ),
      ),
    );
    const { user, dialog, input } = await openEditor();
    const refused = responseTo("POST", `/api/admin/products/${product.id}/image/`);
    await user.upload(input, new File(["jpg"], "polyglot.jpg", { type: "image/jpeg" }));
    await refused;
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This file contains more than an image and was refused.",
    );
  });

  it("refuses an SVG before sending anything", async () => {
    let posted = false;
    server.use(
      http.post("*/api/admin/products/:id/image/", () => {
        posted = true;
        return HttpResponse.json(product);
      }),
    );
    const { dialog, input } = await openEditor();
    // The picker's accept list hides an SVG, but a scripted change (or a browser that ignores
    // accept) can still deliver one, so the component checks the file itself.
    fireEvent.change(input, {
      target: { files: [new File(["<svg onload=alert(1)>"], "x.svg", { type: "image/svg+xml" })] },
    });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Choose a JPEG, PNG or WebP image.",
    );
    expect(posted).toBe(false);
  });
});
