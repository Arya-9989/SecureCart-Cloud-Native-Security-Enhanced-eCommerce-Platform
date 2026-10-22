import { useEffect, type RefObject } from "react";

import { prefersReducedMotion, supportsScrollTimeline } from "@/lib/motion";

/** Piecewise-linear interpolation over [progress, value] stops (progress ascending). */
export function interpolate(
  progress: number,
  stops: readonly (readonly [number, number])[],
): number {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) return 0;
  if (progress <= first[0]) return first[1];
  if (progress >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const [p1, v1] = stops[i] ?? last;
    const [p0, v0] = stops[i - 1] ?? first;
    if (progress <= p1) return p1 === p0 ? v1 : v0 + ((v1 - v0) * (progress - p0)) / (p1 - p0);
  }
  return last[1];
}

/**
 * Scripted fallback for scroll-scrubbed motion in browsers without CSS scroll timelines.
 * Where `animation-timeline` is supported, or the visitor prefers reduced motion, it does
 * nothing at all (CSS owns the motion, or there is none). Otherwise `enable` runs once after
 * mount and may decline (return false), for example when switching layout would move content
 * already on screen; if it accepts, `update` runs on each animation frame that follows a
 * scroll or resize, with the element. A passive listener: scrolling itself is never touched.
 */
export function useScrollScrub<T extends HTMLElement>(
  ref: RefObject<T | null>,
  update: (element: T) => void,
  enable: (element: T) => boolean = () => true,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || supportsScrollTimeline() || prefersReducedMotion()) return;
    if (!enable(element)) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update(element);
      });
    };
    update(element);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
    // Mount-only by design: the callbacks read the DOM, not React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
