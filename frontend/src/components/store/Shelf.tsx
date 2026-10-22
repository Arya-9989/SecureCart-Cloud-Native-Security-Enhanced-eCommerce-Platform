import { clsx } from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Apple Store-style horizontal shelf: native scrolling with snap points (no scroll-jacking),
 * plus paddle buttons for pointer users. Paddles disable at either end.
 */
export function Shelf({ label, children }: { label: string; children: ReactNode }) {
  const track = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft <= 4,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
    });
  }, []);

  useEffect(() => {
    measure();
    const el = track.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [measure, children]);

  const page = (direction: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: reduce ? "auto" : "smooth" });
  };

  const paddle =
    "hit flex size-9 items-center justify-center rounded-full bg-surface-3 text-fg transition-opacity hover:opacity-80 disabled:opacity-35";
  return (
    <div>
      <ul
        ref={track}
        onScroll={measure}
        aria-label={label}
        className="no-scrollbar flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pt-2 pb-8 sm:scroll-px-[max(1.5rem,calc((100vw-1072px)/2))] sm:px-[max(1.5rem,calc((100vw-1072px)/2))]"
      >
        {children}
      </ul>
      <div className="container-page flex justify-end gap-3">
        <button
          type="button"
          className={paddle}
          onClick={() => {
            page(-1);
          }}
          disabled={edges.start}
          aria-label={`Previous: ${label}`}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <button
          type="button"
          className={paddle}
          onClick={() => {
            page(1);
          }}
          disabled={edges.end}
          aria-label={`Next: ${label}`}
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function ShelfItem({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={clsx("shrink-0 snap-start", className)}>{children}</li>;
}
