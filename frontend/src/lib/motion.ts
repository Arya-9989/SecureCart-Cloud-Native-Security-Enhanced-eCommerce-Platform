/*
 * Motion tokens and guards shared by the scripted animations. CSS owns most motion (see the
 * "Motion" section of index.css); these are for the few cues that need script: the add-to-bag
 * bump, chart draw-in and the scroll-story fallback.
 */
export const EASE_STANDARD = "cubic-bezier(0.4, 0, 0.6, 1)";
export const EASE_ENTRANCE = "cubic-bezier(0.16, 1, 0.3, 1)";

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** True where CSS scroll-driven animations run natively (the scripted fallback then idles). */
export function supportsScrollTimeline(): boolean {
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("animation-timeline: view()")
  );
}
