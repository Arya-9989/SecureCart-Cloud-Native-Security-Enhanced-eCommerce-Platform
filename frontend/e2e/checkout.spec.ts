import {
  apiAuth,
  emptyBag,
  expect,
  expectAccessible,
  signIn,
  test,
  wellStockedProduct,
} from "./fixtures";

test.describe("Checkout", () => {
  test.beforeEach(async ({ request }) => {
    await emptyBag(request);
    // Put one well-stocked item in the bag through the real API.
    const product = await wellStockedProduct(request);
    const headers = await apiAuth(request, "customer");
    const list = await request.get(`/api/products/${product.slug}/`);
    const { id } = (await list.json()) as { id: number };
    const added = await request.post("/api/cart/items/", {
      headers,
      data: { product_id: id, quantity: 1 },
    });
    expect(added.ok()).toBe(true);
  });

  test("validates inline, places the order and shows what protected it", async ({ page }) => {
    await signIn(page, "customer");
    await page.goto("/checkout");
    await expect(page.getByRole("heading", { level: 1, name: "Checkout." })).toBeVisible();

    // Inline validation: leaving an invalid field explains the problem immediately.
    await page.getByLabel("Postal code").fill("!");
    await page.getByLabel("Postal code").blur();
    await expect(page.getByText("Enter a valid postal code")).toBeVisible();
    await expectAccessible(page, "checkout (with an inline error)");

    await page.getByLabel("Street address").fill("500 Congress Avenue");
    await page.getByLabel("City").fill("Austin");
    await page.getByLabel("Postal code").fill("78701");
    await page.getByRole("button", { name: /Place order/ }).click();

    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?placed=1$/);
    await expect(
      page.getByRole("heading", { name: "Thank you. Your order is confirmed." }),
    ).toBeVisible();
    await expect(page.getByText("Charged exactly once")).toBeVisible();
    await expect(page.getByText("Order placed; stock reserved")).toBeVisible();
    await expectAccessible(page, "order confirmation");
  });

  test("can be completed with the keyboard alone", async ({ page }) => {
    await signIn(page, "customer");
    await page.goto("/checkout");
    await expect(page.getByRole("heading", { level: 1, name: "Checkout." })).toBeVisible();

    // Tab in from the top of the page, as a keyboard user would.
    const street = page.getByLabel("Street address");
    for (
      let i = 0;
      i < 40 && !(await street.evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press("Tab");
    }
    await expect(street).toBeFocused();
    await page.keyboard.type("500 Congress Avenue");
    await page.keyboard.press("Tab"); // apartment (optional)
    await page.keyboard.press("Tab");
    await page.keyboard.type("Austin");
    await page.keyboard.press("Tab");
    await page.keyboard.type("78701");
    await page.keyboard.press("Tab"); // country
    await page.keyboard.press("Tab"); // the payment choice is one tab stop

    const approve = page.getByRole("radio", { name: /approve/ });
    await expect(approve).toBeFocused();
    // The focus ring is drawn on the whole card, since the native radio is visually hidden.
    const card = page.locator("label").filter({ has: approve });
    await expect(card).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: /decline/ })).toBeChecked();
    await page.keyboard.press("ArrowLeft");
    await expect(approve).toBeChecked();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: /Place order/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?placed=1$/);
  });

  test("a declined payment explains itself and leaves the bag intact", async ({
    page,
    consoleErrors,
  }) => {
    // The API answers 402 Payment Required for the decline token, which Chrome logs.
    consoleErrors.allow(/status of 402/);
    await signIn(page, "customer");
    await page.goto("/checkout");
    await page.getByLabel("Street address").fill("500 Congress Avenue");
    await page.getByLabel("City").fill("Austin");
    await page.getByLabel("Postal code").fill("78701");
    await page.getByText("Test card: decline").click();
    await page.getByRole("button", { name: /Place order/ }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Card declined (mock).");
    await expect(alert).toContainText("Nothing was charged and your bag is unchanged.");
    await expectAccessible(page, "checkout (declined)");
  });
});
