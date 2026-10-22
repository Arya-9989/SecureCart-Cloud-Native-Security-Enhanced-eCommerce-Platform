import { expect, expectAccessible, signIn, test } from "./fixtures";

test.describe("Admin", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "admin");
  });

  test("dashboard charts, data table and accessibility in both themes", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("img", { name: /Area chart of daily revenue/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /Bar chart of orders by status/ })).toBeVisible();
    // Recharts renders real SVG marks.
    await expect(page.locator(".recharts-area-curve")).toHaveCount(1);
    await expect(page.locator(".recharts-bar-rectangle").first()).toBeVisible();

    await page.getByText("Show data table").click();
    const table = page.getByRole("table", { name: /Daily revenue/ });
    await expect(table.getByRole("row")).toHaveCount(31); // header + 30 days
    await expectAccessible(page, "admin dashboard (light)");

    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await expect(page.locator(".recharts-area-curve")).toHaveCount(1);
    await expectAccessible(page, "admin dashboard (dark)");
  });

  test("command palette jumps to orders to ship", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox").fill("ship");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/admin\/orders\?status=paid$/);
    await expect(page.getByRole("button", { name: "To ship" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("tables keep their header in view", async ({ page }) => {
    await page.goto("/admin/orders");
    const table = page.getByRole("table", { name: "Orders" });
    await expect(table.getByRole("row").nth(1)).toBeVisible();
    const position = await table
      .getByRole("columnheader", { name: "Order" })
      .evaluate((th) => getComputedStyle(th).position);
    expect(position).toBe("sticky");
    await expectAccessible(page, "admin orders");
  });
});
