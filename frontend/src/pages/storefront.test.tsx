import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { customer, makeCart, server } from "@/test/server";
import { renderApp } from "@/test/utils";

describe("Shop page", () => {
  it("lists products with stock states", async () => {
    renderApp("/shop");
    expect(await screen.findByRole("heading", { name: "All products" })).toBeInTheDocument();
    expect(await screen.findByText("Aurora Wireless Headphones")).toBeInTheDocument();
    expect(screen.getByText("Only 3 left")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Arc Laptop Stand is sold out" })).toBeDisabled();
    expect(screen.getByText("3 products")).toBeInTheDocument();
  });

  it("applies the category filter from the sidebar", async () => {
    const { user, router } = renderApp("/shop");
    const filters = await screen.findByRole("complementary", { name: "Product filters" });
    await user.click(await within(filters).findByRole("button", { name: /Workspace/ }));
    expect(router.state.location.search).toBe("?category=workspace");
    expect(await screen.findByText("1 product")).toBeInTheDocument();
    expect(screen.queryByText("Aurora Wireless Headphones")).not.toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", async () => {
    renderApp("/shop?search=zzz");
    expect(await screen.findByText("No products match")).toBeInTheDocument();
  });

  it("shows an error state with retry when the API fails", async () => {
    server.use(http.get("*/api/products/", () => new HttpResponse(null, { status: 500 })));
    renderApp("/shop");
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't load this");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("sends anonymous shoppers to sign in when adding to the bag", async () => {
    const { user, router } = renderApp("/shop");
    await user.click(
      await screen.findByRole("button", { name: "Add Aurora Wireless Headphones to bag" }),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
    expect(router.state.location.search).toBe("?next=%2Fshop");
  });
});

describe("Product page", () => {
  it("renders details and a 404 state", async () => {
    renderApp("/products/aurora-wireless-headphones");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Aurora Wireless Headphones" }),
    ).toBeInTheDocument();
    expect(screen.getByText("AUD-AURORA")).toBeInTheDocument();
  });

  it("shows not found for unknown products", async () => {
    renderApp("/products/nope");
    expect(await screen.findByText("Product not found")).toBeInTheDocument();
  });

  it("adds the chosen quantity to the bag for signed-in users", async () => {
    let body: unknown = null;
    server.use(
      http.post("*/api/cart/items/", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeCart({ item_count: 2 }), { status: 201 });
      }),
    );
    const { user } = renderApp("/products/aurora-wireless-headphones", { user: customer });
    await user.click(await screen.findByRole("button", { name: "Increase quantity" }));
    await user.click(screen.getByRole("button", { name: "Add to Bag" }));
    await waitFor(() => {
      expect(body).toEqual({ product_id: 1, quantity: 2 });
    });
    expect(await screen.findByText("Added to bag")).toBeInTheDocument();
  });

  it("switches gallery views and shows its protection cues", async () => {
    const { user } = renderApp("/products/aurora-wireless-headphones");
    const closeUp = await screen.findByRole("radio", { name: "Close-up" });
    expect(screen.getByRole("radio", { name: "Studio view" })).toBeChecked();
    await user.click(closeUp);
    expect(closeUp).toBeChecked();
    expect(screen.getByText("Never oversold")).toBeInTheDocument();
    const storyLinks = screen.getAllByRole("link", { name: "How your order is protected" });
    expect(storyLinks.map((link) => link.getAttribute("href"))).toContain("/protection#checkout");
  });

  it("compares the product with others in its category", async () => {
    renderApp("/products/aurora-wireless-headphones");
    const table = await screen.findByRole("table", { name: /compared with other Audio/ });
    expect(within(table).getByText("Pulse Mini Speaker")).toBeInTheDocument();
    expect(within(table).getByText("Only 3 left")).toBeInTheDocument();
  });
});

describe("Cart page", () => {
  it("requires authentication", async () => {
    const { router } = renderApp("/cart");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
    expect(router.state.location.search).toBe("?next=%2Fcart");
  });

  it("updates quantities through the API", async () => {
    let patched: unknown = null;
    server.use(
      http.patch("*/api/cart/items/10/", async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json(makeCart());
      }),
    );
    const { user } = renderApp("/cart", { user: customer });
    expect(
      await screen.findByRole("heading", { name: "Your bag total is $204.12." }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Increase quantity" }));
    await waitFor(() => {
      expect(patched).toEqual({ quantity: 2 });
    });
  });

  it("blocks checkout when an item is no longer available", async () => {
    const cart = makeCart();
    const [item] = cart.items;
    server.use(
      http.get("*/api/cart/", () =>
        HttpResponse.json({
          ...cart,
          items: [{ ...item!, is_available: false, product: { ...item!.product, stock: 0 } }],
        }),
      ),
    );
    renderApp("/cart", { user: customer });
    expect(
      await screen.findByText("No longer available. Remove it to continue."),
    ).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: "Check out" })) {
      expect(link).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("shows the empty state", async () => {
    server.use(
      http.get("*/api/cart/", () => HttpResponse.json(makeCart({ items: [], item_count: 0 }))),
    );
    renderApp("/cart", { user: customer });
    expect(await screen.findByText("Your bag is empty.")).toBeInTheDocument();
  });
});

describe("Bag drawer", () => {
  it("previews the bag from the global nav", async () => {
    const { user } = renderApp("/", { user: customer });
    const bag = await screen.findByRole("button", { name: "Bag, 1 item" });
    await user.click(bag);
    const drawer = await screen.findByRole("dialog", { name: "Bag" });
    expect(within(drawer).getByText("Aurora Wireless Headphones")).toBeInTheDocument();
    expect(within(drawer).getByRole("link", { name: "Check out" })).toHaveAttribute(
      "href",
      "/checkout",
    );
  });
});

describe("Protection page", () => {
  it("tells the four-stage story and links each claim to its code", () => {
    renderApp("/protection");
    expect(
      screen.getByRole("heading", { level: 1, name: /Trust you can read in the code/ }),
    ).toBeInTheDocument();
    for (const heading of [
      "A session scripts can't read.",
      "Live stock, honest limits.",
      "Charged once. Never oversold.",
      "Every change, on the record.",
    ]) {
      expect(screen.getByRole("heading", { level: 2, name: heading })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "backend/apps/orders/checkout.py" })).toHaveAttribute(
      "href",
      expect.stringContaining("/tree/main/backend/apps/orders/checkout.py"),
    );
  });
});

describe("Session restore", () => {
  it("does not probe the refresh endpoint for a browser that never signed in", async () => {
    let refreshCalls = 0;
    server.events.on("request:start", ({ request }) => {
      if (new URL(request.url).pathname === "/api/auth/refresh/") refreshCalls += 1;
    });
    renderApp("/shop");
    expect(await screen.findByText("Aurora Wireless Headphones")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Sign in" }).length).toBeGreaterThan(0);
    expect(refreshCalls).toBe(0);
    server.events.removeAllListeners("request:start");
  });
});
