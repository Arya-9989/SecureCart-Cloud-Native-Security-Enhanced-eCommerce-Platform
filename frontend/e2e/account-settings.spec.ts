import { readFile } from "node:fs/promises";

import { expect, expectAccessible, test } from "./fixtures";

test.describe("Account settings", () => {
  test("export my data, then delete the account", async ({ page, request, consoleErrors }) => {
    consoleErrors.allow(/status of 401/); // the final, deliberate sign-in with deleted credentials
    const email = `e2e-account-${Date.now()}@example.com`;
    const password = "Settings-Pass-8402!";
    const registered = await request.post("/api/auth/register/", {
      data: { email, full_name: "Settings Tester", password },
    });
    expect(registered.status()).toBe(201);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));

    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Account." })).toBeVisible();
    await expect(page.getByText("Not confirmed")).toBeVisible();
    await expectAccessible(page, "account settings");

    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download your data" }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^securecart-data-\d{8}\.json$/);
    const data = JSON.parse(await readFile(await download.path(), "utf8")) as {
      profile: { email: string };
    };
    expect(data.profile.email).toBe(email);

    await page.getByRole("button", { name: "Delete account" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Confirm with your password").fill(password);
    await dialog.getByRole("button", { name: "Delete account" }).click();
    await page.waitForURL((url) => url.pathname === "/");

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Invalid email or password.");
  });
});
