import { expect, expectAccessible, test } from "./fixtures";

/*
 * Prerendering and motion. Kept to a few fast checks: the no-JS pass loads no scripts at all,
 * and the motion checks read computed styles at chosen scroll positions instead of waiting
 * on animations.
 */

test.describe("Prerendered public pages", () => {
  test("read completely with JavaScript off", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const pages: [string, RegExp, string][] = [
      ["/", /bought safely/, "Shop by category."],
      ["/protection", /read in the code/, "Charged once. Never oversold."],
      ["/shop", /All products/, "Aurora Wireless Headphones"],
      ["/products/aurora-wireless-headphones", /Aurora Wireless Headphones/, "Never oversold"],
    ];
    for (const [path, heading, text] of pages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByText(text).first()).toBeVisible();
      await expect(page.getByRole("contentinfo")).toContainText("Arya Mahindrakar");
    }
    await page.goto("/shop?category=audio");
    await expect(page.getByRole("heading", { level: 1, name: "Audio" })).toBeVisible();
    // Searches and private pages still get the plain app shell.
    await page.goto("/shop?search=lamp");
    await expect(page.locator("#root")).toBeEmpty();
    await context.close();
  });

  test("hydrate in place, keeping the server's DOM", async ({ page }) => {
    await page.goto("/products/aurora-wireless-headphones");
    const heading = page.getByRole("heading", { level: 1 });
    await heading.evaluate((el) => {
      (el as HTMLElement).dataset.fromServer = "1";
    });
    // Hydrated: the page is interactive, and the server's heading element is still there.
    await page.getByRole("radio", { name: "Close-up" }).click();
    await expect(page.getByRole("radio", { name: "Close-up" })).toBeChecked();
    await expect(heading).toHaveAttribute("data-from-server", "1");
    await expect(page).toHaveTitle("Aurora Wireless Headphones · SecureCart");
  });
});

test.describe("Motion", () => {
  const opacities = () =>
    [...document.querySelectorAll(".moments-panel")].map((el) =>
      Number(getComputedStyle(el).opacity).toFixed(2),
    );

  test("the four-moments story pins and lights stage by stage", async ({ page }) => {
    await page.goto("/protection");
    const story = page.locator(".moments");
    const top = await story.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    const height = await story.evaluate((el) => el.getBoundingClientRect().height);
    const viewport = page.viewportSize()?.height ?? 720;
    expect(height).toBeGreaterThan(viewport * 3);

    const at = async (progress: number) => {
      await page.evaluate(
        (y) => {
          window.scrollTo(0, y);
        },
        Math.round(top + (height - viewport) * progress),
      );
      await page.evaluate(() => new Promise(requestAnimationFrame));
      return page.evaluate(opacities);
    };
    expect(await at(0.05)).toEqual(["1.00", "0.00", "0.00", "0.00"]);
    expect(await at(0.62)).toEqual(["0.00", "0.00", "1.00", "0.00"]);
    expect(await at(0.98)).toEqual(["0.00", "0.00", "0.00", "1.00"]);
    // Past the story the last stage holds, and the stage is pinned while it plays.
    expect(await at(1.05)).toEqual(["0.00", "0.00", "0.00", "1.00"]);
    await expectAccessible(page, "protection story (end)");
  });

  test("reduced motion: final states, no morph, nothing to wait for", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      const calls: string[] = [];
      (window as unknown as { vtCalls: string[] }).vtCalls = calls;
      const original = document.startViewTransition.bind(document);
      document.startViewTransition = ((arg?: ViewTransitionUpdateCallback) => {
        calls.push("start");
        return original(arg);
      }) as typeof document.startViewTransition;
    });
    await page.goto("/protection");
    expect(await page.evaluate(opacities)).toEqual(["1.00", "1.00", "1.00", "1.00"]);
    const lit = await page
      .locator(".moments-lit, .checkout-step-lit")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).opacity));
    expect(new Set(lit)).toEqual(new Set(["1"]));

    await page.goto("/shop");
    await page.locator("article h3 a").first().click();
    await expect(page).toHaveURL(/\/products\//);
    expect(await page.evaluate(() => (window as unknown as { vtCalls: string[] }).vtCalls)).toEqual(
      [],
    );
  });

  test("a product card morphs into the product page", async ({ page }) => {
    await page.addInitScript(() => {
      const names: string[] = [];
      (window as unknown as { vtNames: string[] }).vtNames = names;
      const original = document.startViewTransition.bind(document);
      document.startViewTransition = ((arg?: ViewTransitionUpdateCallback) => {
        // Which elements carry the shared name when the old state is captured.
        names.push(
          ...[...document.querySelectorAll('[data-vt="product-art"]')].map((el) =>
            el.closest("article") ? "card" : "other",
          ),
        );
        return original(arg);
      }) as typeof document.startViewTransition;
    });
    await page.goto("/shop");
    const card = page.locator("article").nth(1);
    const name = (await card.locator("h3").textContent()) ?? "";
    await card.locator("h3 a").click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    // Exactly the pressed card was named, and on arrival only the gallery carries the name.
    expect(await page.evaluate(() => (window as unknown as { vtNames: string[] }).vtNames)).toEqual(
      ["card"],
    );
    await expect(page.locator('[data-vt="product-art"]')).toHaveCount(1);
    await expect(page.locator("[data-product-gallery]")).toHaveAttribute("data-vt", "product-art");
  });
});
