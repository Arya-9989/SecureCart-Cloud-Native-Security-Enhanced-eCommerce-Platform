import { emptyBag, expect, expectAccessible, signIn, test, wellStockedProduct } from "./fixtures";

test.describe("Bag", () => {
  test.beforeEach(async ({ request }) => {
    await emptyBag(request);
  });

  test("add from the product page, preview it from the nav, review it", async ({
    page,
    request,
  }) => {
    const product = await wellStockedProduct(request);
    await signIn(page, "customer");
    await page.goto(`/products/${product.slug}`);
    await page.getByRole("button", { name: "Increase quantity" }).click();
    await page.getByRole("button", { name: "Add to Bag" }).click();
    await expect(page.getByText("Added to bag")).toBeVisible();

    // Desktop: the bag opens as a popover from the global nav.
    await page.getByRole("button", { name: "Bag, 2 items" }).click();
    const preview = page.getByRole("dialog", { name: "Bag" });
    await expect(preview.getByText(product.name)).toBeVisible();
    await expect(preview.getByText("Stock is checked live")).toBeVisible();
    await preview.getByRole("link", { name: "Review bag" }).click();

    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByRole("heading", { level: 1, name: /Your bag total is/ })).toBeVisible();
    await expect(page.getByRole("list", { name: "Bag items" }).getByRole("listitem")).toHaveCount(
      1,
    );
    await expectAccessible(page, "bag");

    await page.getByRole("button", { name: `Remove ${product.name} from bag` }).click();
    await expect(page.getByRole("heading", { name: "Your bag is empty." })).toBeVisible();
  });

  test("mobile opens the bag as a drawer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, "customer");
    await page.goto("/");
    await page.getByRole("button", { name: "Bag" }).click();
    const drawer = page.getByRole("dialog", { name: "Bag" });
    await expect(drawer.getByText("Your bag is empty.")).toBeVisible();
    await expectAccessible(page, "bag drawer (mobile)");
  });
});
