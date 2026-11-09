import { readFileSync } from "node:fs";

import { expect, expectAccessible, hasHorizontalOverflow, test } from "./fixtures";

// Use the build's catalog snapshot so these interaction checks need no running API.
const { responses } = JSON.parse(
  readFileSync(new URL("../prerender/catalog.json", import.meta.url), "utf8"),
) as { responses: Record<string, unknown> };

test("mobile filters preserve labels and keyboard focus in both themes", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "") + url.search;
    const data = responses[path];
    if (!data) throw new Error(`Missing catalog snapshot: ${path}`);
    await route.fulfill({ json: data });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const viewport of [
      { width: 375, height: 667 },
      { width: 667, height: 375 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/shop");
      const toggle = page.getByRole("button", { name: "Filters", exact: true });
      await toggle.click();
      const filters = page.locator("#mobile-filters");
      const min = filters.getByLabel("Minimum price", { exact: true });
      await expect(min).toBeVisible();
      const ids = await page
        .locator('input[id$="-min-price"]')
        .evaluateAll((inputs) => inputs.map((input) => input.id));
      expect(new Set(ids).size).toBe(2);
      expect(await hasHorizontalOverflow(page)).toBe(false);
      await expectAccessible(page, `filters ${colorScheme} ${viewport.width}`);
      await filters.getByRole("button", { name: "Apply price" }).focus();
      await page.keyboard.press("Enter");
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
    }
  }
});
