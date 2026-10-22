/*
 * Dependency-free on purpose: vite.config.ts imports this for the preview server, and
 * nginx/default.conf mirrors the same rules for production.
 */

/** The prerendered file under dist/_prerender/ that answers a request, if any. */
export function prerenderedFile(pathname: string, search: string): string | null {
  if (pathname === "/") return "index.html";
  if (pathname === "/protection") return "protection.html";
  // The shop reads its query string, so only the bare URL has a prerendered page.
  if (pathname === "/shop") return search === "" || search === "?" ? "shop.html" : null;
  const product = /^\/products\/([a-z0-9-]+)$/.exec(pathname);
  return product?.[1] ? `products/${product[1]}.html` : null;
}
