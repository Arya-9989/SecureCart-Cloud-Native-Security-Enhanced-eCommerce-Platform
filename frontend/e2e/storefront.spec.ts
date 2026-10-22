import { expect, expectAccessible, hasHorizontalOverflow, test } from "./fixtures";

test.describe("Storefront", () => {
  test("home tells the trust story and passes axe in both themes", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /bought safely/ })).toBeVisible();
    const band = page.getByRole("region", { name: "Every order, protected." });
    await expect(band.getByRole("link")).toHaveCount(4);
    await expect(page.getByRole("heading", { name: "Shop by category." })).toBeVisible();
    await expectAccessible(page, "home (light)");

    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expectAccessible(page, "home (dark)");
  });

  test("shop filters by category from the sidebar", async ({ page }) => {
    await page.goto("/shop");
    await expect(page.getByRole("heading", { level: 1, name: "All products" })).toBeVisible();
    const filters = page.getByRole("complementary", { name: "Product filters" });
    await filters.getByRole("button", { name: /Audio/ }).click();
    await expect(page).toHaveURL(/category=audio/);
    await expect(page.getByRole("heading", { level: 1, name: "Audio" })).toBeVisible();
    await expect(page.getByText(/^\d+ products?$/)).toBeVisible();
    await expectAccessible(page, "shop");
  });

  test("search from the global nav", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Search" }).click();
    const search = page.getByRole("searchbox", { name: "Search products" });
    await expect(search).toBeFocused();
    await search.fill("lamp");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/shop\?search=lamp/);
    await expect(page.getByRole("heading", { name: 'Results for "lamp"' })).toBeVisible();
  });

  test("protection story page has a working local nav", async ({ page }) => {
    await page.goto("/protection");
    const local = page.getByRole("navigation", { name: "Protection sections" });
    await local.getByRole("link", { name: "Checkout" }).click();
    await expect(page).toHaveURL(/#checkout$/);
    await expect(
      page.getByRole("heading", { level: 2, name: "Charged once. Never oversold." }),
    ).toBeInViewport();
    await expectAccessible(page, "protection");
  });

  test("mobile layout has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ["/", "/shop", "/protection", "/products/aurora-wireless-headphones"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await hasHorizontalOverflow(page), `overflow at 390px on ${path}`).toBe(false);
    }
  });

  test("reduced motion leaves no infinite animations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const infinite = await page.evaluate(
      () =>
        [...document.querySelectorAll("*")].filter((el) => {
          const style = getComputedStyle(el);
          return (
            style.animationName !== "none" &&
            style.animationIterationCount === "infinite" &&
            Number.parseFloat(style.animationDuration) > 0.01
          );
        }).length,
    );
    expect(infinite).toBe(0);
  });
});
