import { useEffect, type RefObject } from "react";

import { EASE_ENTRANCE, prefersReducedMotion } from "@/lib/motion";

/**
 * P8, charts drawing in once. When the dashboard's data first renders, the revenue line is
 * drawn left to right (SVG stroke), its wash fades in under it, the status bars and the
 * top-product meters grow from their baselines in order (transform), and the value labels
 * fade in last. The final frame is exactly the static chart, so reduced motion simply shows
 * it. Recharts measures before it draws, so this waits for the marks to exist.
 */
export function useDrawIn(ref: RefObject<HTMLElement | null>, ready: boolean): void {
  useEffect(() => {
    const root = ref.current;
    if (
      !ready ||
      !root ||
      prefersReducedMotion() ||
      typeof Element.prototype.animate !== "function"
    ) {
      return;
    }
    const running: Animation[] = [];
    let observer: MutationObserver | undefined;
    let timeout = 0;

    const play = (): boolean => {
      const curve = root.querySelector<SVGPathElement>(".recharts-area-curve");
      const bars = [...root.querySelectorAll<SVGPathElement>(".recharts-bar-rectangle path")];
      if (!curve || bars.length === 0) return false;

      const length = typeof curve.getTotalLength === "function" ? curve.getTotalLength() : 0;
      if (length > 0) {
        curve.style.strokeDasharray = String(length);
        const draw = curve.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
          duration: 1100,
          easing: EASE_ENTRANCE,
        });
        draw.onfinish = draw.oncancel = () => {
          curve.style.strokeDasharray = "";
        };
        running.push(draw);
      }
      const wash = root.querySelector(".recharts-area-area");
      if (wash) {
        running.push(
          wash.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 700,
            delay: 350,
            easing: EASE_ENTRANCE,
            fill: "backwards",
          }),
        );
      }
      const grow = (el: Element, index: number, axis: "X" | "Y" = "X") => {
        if (el instanceof SVGElement || el instanceof HTMLElement) {
          el.style.transformOrigin = axis === "X" ? "left center" : "center bottom";
          if (el instanceof SVGElement) el.style.transformBox = "fill-box";
        }
        running.push(
          el.animate([{ transform: `scale${axis}(0)` }, { transform: `scale${axis}(1)` }], {
            duration: 700,
            delay: 120 + index * 60,
            easing: EASE_ENTRANCE,
            fill: "backwards",
          }),
        );
      };
      bars.forEach((bar, i) => {
        grow(bar, i);
      });
      root.querySelectorAll("[data-meter]").forEach((meter, i) => {
        grow(meter, i);
      });
      root.querySelectorAll(".recharts-label-list").forEach((labels) => {
        running.push(
          labels.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 400,
            delay: 120 + bars.length * 60 + 300,
            easing: EASE_ENTRANCE,
            fill: "backwards",
          }),
        );
      });
      return true;
    };

    if (!play()) {
      observer = new MutationObserver(() => {
        if (play()) observer?.disconnect();
      });
      observer.observe(root, { childList: true, subtree: true });
      // If the charts never render (an error state), stop waiting.
      timeout = window.setTimeout(() => observer?.disconnect(), 3000);
    }
    return () => {
      observer?.disconnect();
      window.clearTimeout(timeout);
      running.forEach((animation) => {
        animation.cancel();
      });
    };
  }, [ref, ready]);
}
