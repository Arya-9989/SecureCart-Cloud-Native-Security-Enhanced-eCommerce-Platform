import type { QueryClient } from "@tanstack/react-query";

import type { Product } from "@/lib/types";

/*
 * Products that reached the page from the build-time snapshot and have not yet been confirmed
 * by a live fetch. The hydrated page refetches straight away, but a shopper could press "Add"
 * first; for those few hundred milliseconds the product is looked up live before it goes into
 * the bag, so a catalog edited since the build can never put the wrong item in it.
 */
const unconfirmed = new WeakSet<object>();

function eachProduct(data: unknown, visit: (product: object) => void): void {
  if (!data || typeof data !== "object") return;
  if (Array.isArray(data)) return;
  if ("results" in data && Array.isArray(data.results)) {
    for (const item of data.results as unknown[]) eachProduct(item, visit);
    return;
  }
  if ("slug" in data && "stock" in data) visit(data);
}

export function trackSnapshot(client: QueryClient): void {
  const cache = client.getQueryCache();
  for (const query of cache.getAll()) {
    eachProduct(query.state.data, (product) => unconfirmed.add(product));
  }
  cache.subscribe((event) => {
    if (event.type === "updated" && event.action.type === "success" && !event.action.manual) {
      eachProduct(event.query.state.data, (product) => unconfirmed.delete(product));
    }
  });
}

export function isUnconfirmed(product: Pick<Product, "slug">): boolean {
  return unconfirmed.has(product);
}
