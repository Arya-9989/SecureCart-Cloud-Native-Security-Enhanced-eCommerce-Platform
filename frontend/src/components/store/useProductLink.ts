import { useQueryClient } from "@tanstack/react-query";
import { useRef, type MouseEvent } from "react";

import { keys } from "@/hooks/queries";
import { prefersReducedMotion } from "@/lib/motion";
import type { Product } from "@/lib/types";

const SHARED = "product-art";

/** Moves the shared-element name onto `element`, so only one element carries it. */
function claimSharedName(element: HTMLElement | null): void {
  if (!element) return;
  document.querySelectorAll(`[data-vt="${SHARED}"]`).forEach((named) => {
    named.removeAttribute("data-vt");
  });
  element.setAttribute("data-vt", SHARED);
  // The card may outlive the navigation (e.g. it reappears in a list); drop the name once
  // the transition is over so the next page never has two.
  window.setTimeout(() => {
    if (element.isConnected && !element.hasAttribute("data-product-gallery")) {
      element.removeAttribute("data-vt");
    }
  }, 1000);
}

/**
 * P7, card to product page. Pressing a product link
 *  - seeds the product page from what the card already knows, so it renders at once (marked
 *    stale, so live stock and price are fetched straight away), and
 *  - gives the card's artwork the gallery's view-transition name, so React Router's view
 *    transition morphs the artwork into the product page's gallery.
 * Reduced motion, or a browser without view transitions, gets an ordinary instant navigation.
 */
export function useProductLink<T extends HTMLElement = HTMLDivElement>(product: Product) {
  const queryClient = useQueryClient();
  const art = useRef<T>(null);
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!queryClient.getQueryData(keys.product(product.slug))) {
      queryClient.setQueryData(keys.product(product.slug), product, { updatedAt: 0 });
    }
    if (canMorph()) claimSharedName(art.current);
  };
  return { art, linkProps: { onClick, viewTransition: canMorph() } };
}

function canMorph(): boolean {
  return (
    typeof document !== "undefined" && "startViewTransition" in document && !prefersReducedMotion()
  );
}
