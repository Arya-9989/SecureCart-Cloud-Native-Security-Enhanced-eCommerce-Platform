import { expect, expectAccessible, test } from "./fixtures";

test.describe("Product page", () => {
  test("gallery, trust cues, comparison and sticky buy bar", async ({ page }) => {
    await page.goto("/products/aurora-wireless-headphones");
    await expect(
      page.getByRole("heading", { level: 1, name: "Aurora Wireless Headphones" }),
    ).toBeVisible();

    const closeUp = page.getByRole("radio", { name: "Close-up" });
    await closeUp.click();
    await expect(closeUp).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("img", { name: /close-up/ })).toBeVisible();

    await expect(page.getByText("Never oversold")).toBeVisible();
    await expect(page.getByRole("table", { name: /compared with other Audio/ })).toBeVisible();
    await expectAccessible(page, "product");

    // The buy bar appears only once the main Add to Bag button has scrolled away.
    const addButtons = page.getByRole("button", { name: "Add to Bag" });
    await expect(addButtons).toHaveCount(1);
    await page.getByRole("heading", { name: "Compare Audio." }).scrollIntoViewIfNeeded();
    await expect(addButtons).toHaveCount(2);
  });

  test("unknown products show a designed not-found state", async ({ page, consoleErrors }) => {
    // The API correctly answers 404 for this slug, and Chrome logs that response.
    consoleErrors.allow(/status of 404/);
    await page.goto("/products/does-not-exist");
    await expect(page.getByRole("heading", { name: "Product not found" })).toBeVisible();
    await expectAccessible(page, "product not found");
  });
});
