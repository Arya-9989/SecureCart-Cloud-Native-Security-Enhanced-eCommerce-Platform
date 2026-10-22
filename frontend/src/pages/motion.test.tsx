import { act, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDrawIn } from "@/hooks/useDrawIn";
import { interpolate } from "@/hooks/useScrollScrub";
import { customer, makeCart, server } from "@/test/server";
import { renderApp } from "@/test/utils";

/** jsdom has no layout: give the four-moments section a position on the page. */
function placeStory(top: number) {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound with .call below
  const original = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.classList.contains("moments")) {
      return {
        top,
        bottom: top + 3600,
        height: 3600,
        left: 0,
        right: 1440,
        width: 1440,
      } as DOMRect;
    }
    return original.call(this);
  });
}

function preferReducedMotion() {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion: reduce"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}

const panels = () => [...document.querySelectorAll<HTMLElement>(".moments-panel")];

afterEach(() => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
});

describe("four moments story (/protection)", () => {
  it("is a static overview with every stage lit when it is already on screen", async () => {
    placeStory(200);
    renderApp("/protection");
    expect(
      await screen.findByRole("heading", { name: "One order. Four safeguards." }),
    ).toBeInTheDocument();
    const section = document.querySelector(".moments");
    expect(section).not.toHaveClass("is-scripted");
    expect(panels()).toHaveLength(4);
    for (const panel of panels()) expect(panel.style.opacity).toBe("");
    expect(screen.getByRole("list", { name: "The four moments" }).children).toHaveLength(4);
  });

  it("stays static, every panel at its final state, under reduced motion", async () => {
    preferReducedMotion();
    placeStory(2000);
    renderApp("/protection");
    await screen.findByRole("heading", { name: "One order. Four safeguards." });
    expect(document.querySelector(".moments")).not.toHaveClass("is-scripted");
    for (const panel of panels()) {
      expect(panel.style.opacity).toBe("");
      expect(panel.style.transform).toBe("");
    }
  });

  it("scrubs the stages in order where CSS scroll timelines are missing", async () => {
    placeStory(2000);
    renderApp("/protection");
    await screen.findByRole("heading", { name: "One order. Four safeguards." });
    const section = document.querySelector(".moments");
    expect(section).toHaveClass("is-scripted");
    expect(panels().map((p) => p.style.opacity)).toEqual(["1", "0", "0", "0"]);

    // Scrolled to the end of the pinned range: the last moment holds, every stage is lit.
    vi.restoreAllMocks();
    placeStory(-2700);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    await waitFor(() => {
      expect(panels().map((p) => p.style.opacity)).toEqual(["0", "0", "0", "1"]);
    });
    const lit = [...document.querySelectorAll<HTMLElement>(".moments-lit")];
    expect(lit.map((l) => l.style.opacity)).toEqual(["1", "1", "1", "1"]);
    expect(document.querySelector<HTMLElement>(".moments-rail-fill")?.style.transform).toBe(
      "scaleX(1)",
    );
  });

  it("interpolates between keyframe stops and clamps outside them", () => {
    const stops = [
      [0.2, 0],
      [0.3, 1],
    ] as const;
    expect(interpolate(0, stops)).toBe(0);
    expect(interpolate(0.25, stops)).toBeCloseTo(0.5);
    expect(interpolate(1, stops)).toBe(1);
  });
});

describe("add-to-bag cue", () => {
  function addFromProductPage() {
    server.use(
      http.post("*/api/cart/items/", () =>
        HttpResponse.json(makeCart({ item_count: 1 }), { status: 201 }),
      ),
    );
    return renderApp("/products/aurora-wireless-headphones", { user: customer });
  }

  it("acknowledges the add on the button and bumps the bag icon", async () => {
    const animate = vi.fn();
    HTMLElement.prototype.animate = animate;
    const { user } = addFromProductPage();
    await screen.findByRole("button", { name: /Account/ });
    await user.click(await screen.findByRole("button", { name: "Add to Bag" }));
    expect(await screen.findByRole("button", { name: "Added" })).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelector("[data-bag-cue]")).not.toBeNull();
    });
    expect(animate).toHaveBeenCalledTimes(1);
    const [keyframes] = animate.mock.calls[0] as [Keyframe[]];
    // Transform only, and it ends where it started.
    expect(
      keyframes.every((k) => Object.keys(k).every((key) => ["transform", "offset"].includes(key))),
    ).toBe(true);
    expect(keyframes.at(-1)?.transform).toBe("scale(1)");
  });

  it("keeps the state cue but drops the movement under reduced motion", async () => {
    preferReducedMotion();
    const animate = vi.fn();
    HTMLElement.prototype.animate = animate;
    const { user } = addFromProductPage();
    await screen.findByRole("button", { name: /Account/ });
    await user.click(await screen.findByRole("button", { name: "Add to Bag" }));
    expect(await screen.findByRole("button", { name: "Added" })).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelector("[data-bag-cue]")).not.toBeNull();
    });
    expect(animate).not.toHaveBeenCalled();
  });
});

describe("chart draw-in (P8)", () => {
  function Chart() {
    const ref = useRef<HTMLDivElement>(null);
    useDrawIn(ref, true);
    return (
      <div ref={ref}>
        <svg>
          <path className="recharts-area-curve" />
          <path className="recharts-area-area" />
          <g className="recharts-bar-rectangle">
            <path />
          </g>
        </svg>
      </div>
    );
  }

  function stubSvg() {
    const animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation);
    Element.prototype.animate = animate;
    (SVGElement.prototype as unknown as { getTotalLength: () => number }).getTotalLength = () =>
      420;
    return animate;
  }

  afterEach(() => {
    delete (Element.prototype as Partial<Element>).animate;
  });

  it("draws the line from its full length to zero and grows the bars", () => {
    const animate = stubSvg();
    render(<Chart />);
    const draw = animate.mock.calls.find(
      (call) => (call as unknown as [Keyframe[]])[0][0]?.strokeDashoffset === 420,
    ) as unknown as [Keyframe[]] | undefined;
    expect(draw?.[0].at(-1)?.strokeDashoffset).toBe(0);
    expect(
      animate.mock.calls.some(
        (call) => (call as unknown as [Keyframe[]])[0].at(-1)?.transform === "scaleX(1)",
      ),
    ).toBe(true);
  });

  it("shows the finished chart at once under reduced motion", () => {
    preferReducedMotion();
    const animate = stubSvg();
    const { container } = render(<Chart />);
    expect(animate).not.toHaveBeenCalled();
    expect(
      container.querySelector<SVGPathElement>(".recharts-area-curve")?.style.strokeDasharray,
    ).toBe("");
  });
});
