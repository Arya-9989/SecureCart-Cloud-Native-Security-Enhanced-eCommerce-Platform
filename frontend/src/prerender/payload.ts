import type { DehydratedState } from "@tanstack/react-query";

/*
 * A prerendered page carries the catalog data it was rendered from in a JSON data block
 * (<script type="application/json">). Data blocks are never executed, so the strict CSP
 * (script-src 'self', no inline scripts) still holds.
 */
export const PAYLOAD_ID = "sc-prerender";

export interface PrerenderPayload {
  /** The path the HTML was rendered for. */
  url: string;
  /** True when the page also depends on the query string (it must then be empty). */
  exactSearch: boolean;
  state: DehydratedState;
}

/** JSON that is safe inside a <script> element: "\\u003c" is escaped, so "</script>" can't occur. */
export function serializePayload(payload: PrerenderPayload): string {
  return JSON.stringify(payload).replace(/</g, "\\u003c");
}

export function readPayload(doc: Document): PrerenderPayload | null {
  const text = doc.getElementById(PAYLOAD_ID)?.textContent;
  if (!text) return null;
  try {
    return JSON.parse(text) as PrerenderPayload;
  } catch {
    return null;
  }
}

/**
 * The browser may only hydrate HTML that was rendered for the URL it is on. nginx serves a
 * prerendered page only for its own path, but a page saved to disk, a proxy or a trailing
 * slash could still pair the HTML with another URL; then the app renders from scratch.
 */
export function canHydrate(
  payload: PrerenderPayload,
  location: { pathname: string; search: string },
): boolean {
  if (location.pathname !== payload.url) return false;
  return !payload.exactSearch || location.search === "" || location.search === "?";
}
