import type { ProductQuery } from "./endpoints";

/*
 * The catalog queries the public pages make, in one place. The pages use them at runtime and
 * the build-time prerender (src/prerender/pages.ts) uses the very same objects, so the data
 * baked into the HTML always lands under the query keys the hydrating page asks for.
 */

/** Home: one request feeds the whole page (the catalog is small; the API caps a page at 100). */
export const HOME_CATALOG_QUERY: ProductQuery = { page_size: 100 };

export const SHOP_PAGE_SIZE = 12;

/** The shop grid's query, read from the URL. */
export function shopQuery(params: URLSearchParams): ProductQuery {
  return {
    search: params.get("search") ?? undefined,
    category: params.get("category") ?? undefined,
    min_price: params.get("min_price") ?? undefined,
    max_price: params.get("max_price") ?? undefined,
    in_stock: params.get("in_stock") === "true" ? true : undefined,
    featured: params.get("featured") === "true" ? true : undefined,
    ordering: params.get("ordering") ?? undefined,
    page: Number(params.get("page") ?? "1") || 1,
    page_size: SHOP_PAGE_SIZE,
  };
}

/** "More in <category>" on a product page. */
export function relatedQuery(category: string): ProductQuery {
  return { category, page_size: 12 };
}
