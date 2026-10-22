import { expect, expectAccessible, test } from "./fixtures";

/*
 * The whole account-recovery loop through a real SMTP server: register, confirm the address
 * from the emailed link, ask for a reset, follow that link, and sign in with the new
 * password. Mailpit catches the mail; its HTTP API stands in for the inbox.
 */
const MAILPIT_URL = (process.env.MAILPIT_URL ?? "").replace(/\/$/, "");

interface MailSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

async function findLink(to: string, subject: string): Promise<string | null> {
  const list = (await (await fetch(`${MAILPIT_URL}/api/v1/messages`)).json()) as {
    messages: MailSummary[];
  };
  const hit = list.messages.find(
    (m) => m.Subject === subject && m.To.some((t) => t.Address === to),
  );
  if (!hit) return null;
  const message = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${hit.ID}`)).json()) as {
    Text: string;
  };
  return /https?:\/\/\S+#token=[\w-]+/.exec(message.Text)?.[0] ?? null;
}

async function linkFromInbox(to: string, subject: string): Promise<string> {
  await expect
    .poll(() => findLink(to, subject), { message: `email "${subject}" for ${to}`, timeout: 15_000 })
    .not.toBeNull();
  const url = new URL((await findLink(to, subject)) ?? "");
  // Same app, whatever origin the API was configured to put in its links.
  return `${url.pathname}${url.hash}`;
}

test.describe("Account recovery", () => {
  test.skip(!MAILPIT_URL, "set MAILPIT_URL (and point the API's SMTP at Mailpit)");

  test("confirm the address, reset the password, sign in with the new one", async ({
    page,
    consoleErrors,
  }) => {
    consoleErrors.allow(/status of 401/); // the deliberate sign-in with the old password
    const email = `e2e-${Date.now()}@example.com`;
    const original = "Original-Pass-4821!";
    const replacement = "Replacement-Pass-9310!";

    await page.goto("/register");
    await page.getByLabel("Full name").fill("Recovery Tester");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(original);
    await page.getByLabel("Confirm password").fill(original);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/register"));

    await page.goto(await linkFromInbox(email, "Confirm your email for SecureCart"));
    await expect(page.getByRole("heading", { name: "Email confirmed." })).toBeVisible();
    await expect(page).toHaveURL(/\/verify-email$/); // the secret left the address bar
    await expectAccessible(page, "email confirmed");

    await page.goto("/forgot-password");
    await expectAccessible(page, "forgot password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email." })).toBeVisible();
    await expectAccessible(page, "reset requested");

    await page.goto(await linkFromInbox(email, "Reset your SecureCart password"));
    await expect(page.getByRole("heading", { name: "Choose a new password." })).toBeVisible();
    await expectAccessible(page, "choose a new password");
    await page.getByLabel("New password", { exact: true }).fill(replacement);
    await page.getByLabel("Confirm new password").fill(replacement);
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page.getByRole("heading", { name: "Password changed." })).toBeVisible();

    // The old password is gone; the new one works.
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(original);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Invalid email or password.");
    await page.getByLabel("Password").fill(replacement);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  });

  test("a used reset link cannot be replayed", async ({ page, request, consoleErrors }) => {
    consoleErrors.allow(/status of 400/); // the API rejecting the replayed token
    const email = `e2e-replay-${Date.now()}@example.com`;
    const register = await request.post("/api/auth/register/", {
      data: { email, full_name: "Replay Tester", password: "Original-Pass-4821!" },
    });
    expect(register.status()).toBe(201);
    await request.post("/api/auth/password/forgot/", { data: { email } });
    const link = await linkFromInbox(email, "Reset your SecureCart password");
    const token = new URLSearchParams(link.split("#")[1]).get("token") ?? "";
    const first = await request.post("/api/auth/password/reset/", {
      data: { token, new_password: "Replacement-Pass-9310!" },
    });
    expect(first.status()).toBe(200);

    await page.goto(link);
    await page.getByLabel("New password", { exact: true }).fill("Another-Pass-5555!");
    await page.getByLabel("Confirm new password").fill("Another-Pass-5555!");
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page.getByRole("heading", { name: "This link has expired." })).toBeVisible();
    await expectAccessible(page, "expired reset link");
  });
});
