/*
 * Dependency-free on purpose: vite.config.ts imports this for the preview server, and
 * nginx/default.conf mirrors the same rules for production.
 */

/** The prerendered file under dist/_prerender/ that answers a request, if any. */
export function prerenderedFile(pathname: string, search: string): string | null {
  if (pathname === "/") return "index.html";
  if (pathname === "/protection") return "protection.html";
  // The shop reads its query string: only the bare URL and a lone category filter (the
  // links in the nav and footer) have prerendered pages.
  if (pathname === "/shop") {
    if (search === "" || search === "?") return "shop.html";
    const category = /^\?category=([a-z0-9-]+)$/.exec(search);
    return category?.[1] ? `shop/${category[1]}.html` : null;
  }
  const product = /^\/products\/([a-z0-9-]+)$/.exec(pathname);
  return product?.[1] ? `products/${product[1]}.html` : null;
}
