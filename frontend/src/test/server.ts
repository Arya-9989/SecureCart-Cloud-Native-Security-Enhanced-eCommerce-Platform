import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import type { Cart, Category, Order, Paginated, Product, User } from "@/lib/types";

export const customer: User = {
  id: 2,
  email: "maya@example.com",
  full_name: "Maya Patel",
  role: "customer",
  date_joined: "2026-01-01T00:00:00Z",
};

export const admin: User = {
  ...customer,
  id: 1,
  email: "admin@securecart.dev",
  role: "admin",
  full_name: "Store Admin",
};

export const categories: Category[] = [
  { id: 1, name: "Audio", slug: "audio", description: "", product_count: 2 },
  { id: 2, name: "Workspace", slug: "workspace", description: "", product_count: 1 },
];

export function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: "Aurora Wireless Headphones",
    slug: "aurora-wireless-headphones",
    sku: "AUD-AURORA",
    description: "Over-ear headphones.",
    category: { id: 1, name: "Audio", slug: "audio" },
    price: "189.00",
    stock: 24,
    in_stock: true,
    image_url: "/products/aurora-wireless-headphones.svg",
    is_featured: true,
    created_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

export const products: Product[] = [
  makeProduct(),
  makeProduct({
    id: 2,
    name: "Pulse Mini Speaker",
    slug: "pulse-mini-speaker",
    price: "59.00",
    stock: 3,
    is_featured: false,
  }),
  makeProduct({
    id: 3,
    name: "Arc Laptop Stand",
    slug: "arc-laptop-stand",
    price: "64.00",
    stock: 0,
    in_stock: false,
    category: { id: 2, name: "Workspace", slug: "workspace" },
    is_featured: false,
  }),
];

export function page<T>(results: T[]): Paginated<T> {
  return { count: results.length, next: null, previous: null, results };
}

export function makeCart(overrides: Partial<Cart> = {}): Cart {
  return {
    items: [
      {
        id: 10,
        product: {
          id: 1,
          name: "Aurora Wireless Headphones",
          slug: "aurora-wireless-headphones",
          sku: "AUD-AURORA",
          price: "189.00",
          stock: 24,
          image_url: "/products/aurora-wireless-headphones.svg",
          is_active: true,
        },
        quantity: 1,
        line_total: "189.00",
        is_available: true,
      },
    ],
    item_count: 1,
    subtotal: "189.00",
    shipping: "0.00",
    tax: "15.12",
    total: "204.12",
    currency: "USD",
    updated_at: "2026-10-22T00:00:00Z",
    ...overrides,
  };
}

export function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "6f1c1d3e-0000-4000-8000-000000000001",
    number: "SC-7K2M9QXA",
    status: "paid",
    currency: "USD",
    subtotal: "189.00",
    shipping: "0.00",
    tax: "15.12",
    total: "204.12",
    shipping_address: {
      name: "Maya Patel",
      line1: "1 Market Street",
      city: "Austin",
      postal_code: "78701",
      country: "US",
    },
    payment_provider: "mock",
    failure_reason: "",
    items: [],
    events: [
      {
        from_status: "",
        to_status: "pending_payment",
        note: "",
        created_at: "2026-10-22T00:00:00Z",
      },
    ],
    can_cancel: true,
    created_at: "2026-10-22T00:00:00Z",
    paid_at: "2026-10-22T00:01:00Z",
    shipped_at: null,
    delivered_at: null,
    cancelled_at: null,
    ...overrides,
  };
}

/** Mutable session state for the fake auth endpoints. */
export const session: { user: User | null } = { user: null };

export const handlers = [
  http.post("*/api/auth/refresh/", ({ request }) => {
    if (request.headers.get("X-CSRF-Protection") !== "1") {
      return HttpResponse.json({ error: { code: "forbidden", message: "CSRF" } }, { status: 403 });
    }
    return session.user
      ? HttpResponse.json({ access: "fresh-token", user: session.user })
      : HttpResponse.json(
          { error: { code: "session_expired", message: "Session expired." } },
          { status: 401 },
        );
  }),
  http.post("*/api/auth/logout/", () => new HttpResponse(null, { status: 204 })),
  http.get("*/api/categories/", () => HttpResponse.json(categories)),
  http.get("*/api/products/", ({ request }) => {
    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.toLowerCase();
    const category = url.searchParams.get("category");
    const results = products.filter(
      (p) =>
        (!search || p.name.toLowerCase().includes(search)) &&
        (!category || p.category.slug === category),
    );
    return HttpResponse.json(page(results));
  }),
  http.get("*/api/products/:slug/", ({ params }) => {
    const product = products.find((p) => p.slug === params.slug);
    return product
      ? HttpResponse.json(product)
      : HttpResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  }),
  http.get("*/api/cart/", () => HttpResponse.json(makeCart())),
];

export const server = setupServer(...handlers);
