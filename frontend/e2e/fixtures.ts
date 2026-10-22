import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";

export const ACCOUNTS = {
  customer: { email: "maya@example.com", password: "SecureCart!Demo1" },
  admin: { email: "admin@securecart.dev", password: "SecureCart!Admin1" },
} as const;

type Who = keyof typeof ACCOUNTS;

/**
 * Every test fails on any console error, uncaught exception or CSP violation (Chrome reports
 * those as console errors), so a passing run also proves the pages work under the real CSP.
 */
export const test = base.extend<{ consoleErrors: { allow: (pattern: RegExp) => void } }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      const allowed: RegExp[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await use({
        allow: (pattern) => {
          allowed.push(pattern);
        },
      });
      const unexpected = errors.filter((text) => !allowed.some((p) => p.test(text)));
      expect(unexpected, "console errors, page errors or CSP violations").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** axe-core against WCAG 2.2 A/AA: zero serious or critical violations allowed. */
export async function expectAccessible(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  const summary = blocking.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes
        .map((n) => `${n.html.slice(0, 160)} :: ${n.failureSummary ?? ""}`)
        .join(" | ")}`,
  );
  expect(summary, `axe serious/critical violations on ${label}`).toEqual([]);
}

export async function signIn(page: Page, who: Who): Promise<void> {
  const { email, password } = ACCOUNTS[who];
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Signs in through the API and returns an Authorization header for direct API set-up. */
export async function apiAuth(
  request: APIRequestContext,
  who: Who,
): Promise<Record<string, string>> {
  const response = await request.post("/api/auth/login/", { data: ACCOUNTS[who] });
  expect(response.ok()).toBe(true);
  const { access } = (await response.json()) as { access: string };
  return { Authorization: `Bearer ${access}` };
}

/** Empties the customer's server-side bag so each test starts from a known state. */
export async function emptyBag(request: APIRequestContext): Promise<void> {
  const headers = await apiAuth(request, "customer");
  const response = await request.delete("/api/cart/", { headers });
  expect([200, 204]).toContain(response.status());
}

/** The in-stock product with the most units, so repeated runs never exhaust it. */
export async function wellStockedProduct(
  request: APIRequestContext,
): Promise<{ slug: string; name: string }> {
  const response = await request.get("/api/products/?ordering=-stock&page_size=1");
  const body = (await response.json()) as { results: { slug: string; name: string }[] };
  const product = body.results.at(0);
  if (!product) throw new Error("The catalog is empty; run seed_demo first.");
  return product;
}

export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}
