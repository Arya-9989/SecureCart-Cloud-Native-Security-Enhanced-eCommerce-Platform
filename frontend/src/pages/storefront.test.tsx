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

  it("sends anonymous shoppers to sign in when adding to cart", async () => {
    const { user, router } = renderApp("/shop");
    await user.click(
      await screen.findByRole("button", { name: "Add Aurora Wireless Headphones to cart" }),
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

  it("adds the chosen quantity to the cart for signed-in users", async () => {
    let body: unknown = null;
    server.use(
      http.post("*/api/cart/items/", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeCart({ item_count: 2 }), { status: 201 });
      }),
    );
    const { user } = renderApp("/products/aurora-wireless-headphones", { user: customer });
    await user.click(await screen.findByRole("button", { name: "Increase quantity" }));
    await user.click(screen.getByRole("button", { name: "Add to cart" }));
    await waitFor(() => {
      expect(body).toEqual({ product_id: 1, quantity: 2 });
    });
    expect(await screen.findByText("Added to cart")).toBeInTheDocument();
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
    expect(await screen.findByRole("heading", { name: "Your cart" })).toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: /Checkout/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("shows the empty state", async () => {
    server.use(
      http.get("*/api/cart/", () => HttpResponse.json(makeCart({ items: [], item_count: 0 }))),
    );
    renderApp("/cart", { user: customer });
    expect(await screen.findByText("Your cart is empty")).toBeInTheDocument();
  });
});
