import { m } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/*
 * Scroll reveals are "armed" by the first real scroll. Until then everything renders fully
 * visible, so a page that is printed, captured full-length or never scrolled shows all of its
 * content. Once armed, only content still below the fold is hidden, and it fades and lifts
 * (16px, 320ms, Apple's ease) the first time it enters the viewport. Users who prefer reduced
 * motion never arm it.
 */
let armed = false;
const listeners = new Set<() => void>();

function arm() {
  if (armed) return;
  armed = true;
  window.removeEventListener("scroll", arm);
  listeners.forEach((listener) => {
    listener();
  });
  listeners.clear();
}

function onArm(listener: () => void): () => void {
  if (armed) {
    listener();
    return () => undefined;
  }
  if (listeners.size === 0) window.addEventListener("scroll", arm, { passive: true });
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type Phase = "static" | "hidden" | "shown";

export function Reveal({
  children,
  className,
  delay = 0,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "section" | "li";
}) {
  const ref = useRef<HTMLElement>(null);
  const [phase, setPhase] = useState<Phase>("static");

  useEffect(() => {
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") return;
    let observer: IntersectionObserver | undefined;
    const unsubscribe = onArm(() => {
      const el = ref.current;
      if (!el || el.getBoundingClientRect().top < window.innerHeight) return;
      setPhase("hidden");
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setPhase("shown");
            observer?.disconnect();
          }
        },
        { threshold: 0.12 },
      );
      observer.observe(el);
    });
    return () => {
      unsubscribe();
      observer?.disconnect();
    };
  }, []);

  const Component = m[as];
  return (
    <Component
      ref={ref as never}
      className={className}
      initial={false}
      animate={phase === "hidden" ? { opacity: 0, y: 16 } : { opacity: 1, y: 0 }}
      transition={
        phase === "hidden" ? { duration: 0 } : { duration: 0.32, ease: [0.4, 0, 0.6, 1], delay }
      }
    >
      {children}
    </Component>
  );
}
