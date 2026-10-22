import type { QueryKey } from "@tanstack/react-query";

import { keys } from "@/hooks/queries";
import { HOME_CATALOG_QUERY, relatedQuery, shopQuery } from "@/lib/catalogQueries";
import { catalogPaths, type ProductQuery } from "@/lib/endpoints";
import type { Product } from "@/lib/types";
import { HOME_TITLE, pageTitle } from "@/lib/useDocumentTitle";

/*
 * The public pages that are prerendered at build time, and the catalog reads each one makes.
 * Every query is listed with the key the page's hook uses and the API path it fetches, so
 * the snapshot (prerender/catalog.json) is keyed by real API paths and the hydrating page
 * finds its data under exactly the key it asks for.
 */

export interface PrerenderQuery {
  key: QueryKey;
  path: string;
}

export interface PrerenderPage {
  /** Path the page answers on. */
  url: string;
  /** Output file under dist/_prerender/. */
  file: string;
  /** The page reads its query string (the shop), so only the bare URL may hydrate. */
  exactSearch: boolean;
  title: string;
  description: string;
  queries: PrerenderQuery[];
}

const STORE_DESCRIPTION =
  "SecureCart: everyday tech and home essentials, sold through a storefront built security-first, with protected sessions, oversell-proof checkout and an audited admin.";

const categories: PrerenderQuery = { key: keys.categories, path: catalogPaths.categories };

function products(params: ProductQuery): PrerenderQuery {
  return { key: keys.products(params), path: catalogPaths.products(params) };
}

/** The read every page plan starts from: the whole (small) public catalog. */
export const CATALOG_PATH = catalogPaths.products(HOME_CATALOG_QUERY);

export function prerenderPages(catalog: Product[]): PrerenderPage[] {
  return [
    {
      url: "/",
      file: "index.html",
      exactSearch: false,
      title: HOME_TITLE,
      description: STORE_DESCRIPTION,
      queries: [products(HOME_CATALOG_QUERY), categories],
    },
    {
      url: "/shop",
      file: "shop.html",
      exactSearch: true,
      title: pageTitle("All products"),
      description: "Every product in the SecureCart store, with live stock on every item.",
      queries: [products(shopQuery(new URLSearchParams())), categories],
    },
    {
      url: "/protection",
      file: "protection.html",
      exactSearch: false,
      title: pageTitle("How your order is protected"),
      description:
        "Signing in, filling your bag, paying and everything after: what protects each moment of a SecureCart order, and where it lives in the code.",
      queries: [categories],
    },
    ...catalog.map((product) => ({
      url: `/products/${product.slug}`,
      file: `products/${product.slug}.html`,
      exactSearch: false,
      title: pageTitle(product.name),
      description: product.description,
      queries: [
        { key: keys.product(product.slug), path: catalogPaths.product(product.slug) },
        products(relatedQuery(product.category.slug)),
        categories,
      ],
    })),
  ];
}
