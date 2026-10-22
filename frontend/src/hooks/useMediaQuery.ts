import { useSyncExternalStore } from "react";

/**
 * Subscribes to a CSS media query. Returns false where matchMedia is unavailable.
 * `serverValue` is what prerendered HTML was rendered with; hydration starts from it and then
 * switches to the real answer, so pick the value whose markup matches the common case.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => {
        media.removeEventListener("change", onChange);
      };
    },
    () => (typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false),
    () => serverValue,
  );
}
