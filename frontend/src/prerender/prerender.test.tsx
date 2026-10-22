import { act, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { StrictMode } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "@/App";
import { renderPage } from "@/entry-server";
import { setSession } from "@/lib/api";
import type { Paginated, Product } from "@/lib/types";
import { customer, makeCart, server, session } from "@/test/server";

import snapshotJson from "../../prerender/catalog.json";
import { CATALOG_PATH, prerenderPages } from "./pages";
import { canHydrate, readPayload, serializePayload, type PrerenderPayload } from "./payload";
import { prerenderedFile } from "./routing";

const snapshot = snapshotJson as unknown as {
  capturedAt: string;
  responses: Record<string, unknown>;
};
const catalog = (snapshot.responses[CATALOG_PATH] as Paginated<Product>).results;
const pages = prerenderPages(catalog);
const capturedAt = Date.parse(snapshot.capturedAt);

function pageFor(url: string) {
  const page = pages.find((p) => p.url === url);
  if (!page) throw new Error(`no prerendered page for ${url}`);
  return page;
}

/** Visible words of the rendered markup (tags and attributes stripped). */
function textOf(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent;
}

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("prerender routing", () => {
  it("maps only the public pages to prerendered files", () => {
    expect(prerenderedFile("/", "")).toBe("index.html");
    expect(prerenderedFile("/protection", "")).toBe("protection.html");
    expect(prerenderedFile("/shop", "")).toBe("shop.html");
    expect(prerenderedFile("/shop", "?category=audio")).toBeNull();
    expect(prerenderedFile("/products/halo-table-lamp", "")).toBe("products/halo-table-lamp.html");
    for (const path of ["/cart", "/checkout", "/admin", "/products/a/b", "/products/../x"]) {
      expect(prerenderedFile(path, "")).toBeNull();
    }
  });

  it("prerenders home, shop, protection and every product in the snapshot", () => {
    expect(pages.map((p) => p.url)).toEqual(
      expect.arrayContaining(["/", "/shop", "/protection", "/products/halo-table-lamp"]),
    );
    expect(pages).toHaveLength(3 + catalog.length);
    for (const page of pages) {
      for (const query of page.queries) expect(snapshot.responses).toHaveProperty([query.path]);
    }
  });
});

describe("prerender payload", () => {
  const payload: PrerenderPayload = {
    url: "/shop",
    exactSearch: true,
    state: { mutations: [], queries: [] },
  };

  it("hydrates only the URL it was rendered for", () => {
    expect(canHydrate(payload, { pathname: "/shop", search: "" })).toBe(true);
    expect(canHydrate(payload, { pathname: "/shop", search: "?category=audio" })).toBe(false);
    expect(canHydrate(payload, { pathname: "/shop/", search: "" })).toBe(false);
    const home = { ...payload, url: "/", exactSearch: false };
    expect(canHydrate(home, { pathname: "/", search: "?utm_source=x" })).toBe(true);
  });

  it("can never close its own script element", () => {
    const evil = { ...payload, url: "</script><script>alert(1)</script>" };
    const text = serializePayload(evil);
    expect(text).not.toContain("<");
    const script = document.createElement("script");
    script.type = "application/json";
    script.id = "sc-prerender";
    script.textContent = text;
    document.body.append(script);
    expect(readPayload(document)?.url).toBe(evil.url);
  });
});

describe("prerendered pages", () => {
  it.each(["/", "/protection", "/shop", "/products/halo-table-lamp"])(
    "%s carries its whole content in the HTML",
    async (url) => {
      const { html } = await renderPage(pageFor(url), snapshot.responses, capturedAt);
      // No executable inline script can appear (the CSP would block it anyway).
      expect(html).not.toMatch(/<script/i);
      const text = textOf(html);
      expect(text).toContain("A portfolio project by Arya Mahindrakar.");
      if (url === "/") {
        expect(text).toContain("bought safely.");
        expect(text).toContain("Shop by category.");
        for (const p of catalog.filter((c) => c.is_featured).slice(0, 3)) {
          expect(text).toContain(p.name);
        }
      }
      if (url === "/protection") {
        expect(text).toContain("One order. Four safeguards.");
        expect(text).toContain("Charged once. Never oversold.");
      }
      if (url === "/shop") expect(text).toContain(`${String(catalog.length)} products`);
      if (url === "/products/halo-table-lamp") {
        expect(text).toContain("Halo Table Lamp");
        expect(text).toContain("Compare Home & Living.");
      }
    },
  );

  it("hydrates without a single mismatch", async () => {
    const page = pageFor("/products/halo-table-lamp");
    const { html, state } = await renderPage(page, snapshot.responses, capturedAt);
    document.body.innerHTML = `<div id="root">${html}</div>`;
    window.history.replaceState(null, "", page.url);
    const container = document.getElementById("root");
    if (!container) throw new Error("no root");
    const heading = container.querySelector("h1");
    const recoverable = vi.fn();
    const consoleError = vi.spyOn(console, "error");

    await act(async () => {
      root = hydrateRoot(
        container,
        <StrictMode>
          <App initialState={state} />
        </StrictMode>,
        { onRecoverableError: recoverable },
      );
      await Promise.resolve();
    });

    expect(recoverable).not.toHaveBeenCalled();
    // (The server and client renderers share this test process, which React notes as
    // "multiple renderers"; in the browser only the client renderer exists.)
    const mismatches = consoleError.mock.calls
      .map((args) => args.map(String).join(" "))
      .filter((text) => /hydrat|did(n't| not) match|mismatch/i.test(text));
    expect(mismatches).toEqual([]);
    // React adopted the server's DOM instead of replacing it.
    expect(container.querySelector("h1")).toBe(heading);
    expect(heading).toHaveTextContent("Halo Table Lamp");
  });

  it("confirms a product against the live API before adding build-time data to the bag", async () => {
    session.user = customer;
    localStorage.setItem("securecart-has-session", "1");
    const page = pageFor("/shop");
    const { html, state } = await renderPage(page, snapshot.responses, capturedAt);
    const first = (snapshot.responses[page.queries[0]?.path ?? ""] as Paginated<Product>)
      .results[0];
    if (!first) throw new Error("empty snapshot");
    // The live catalog knows the product under another id than the snapshot did.
    const liveId = first.id + 1000;
    let added: unknown = null;
    server.use(
      // Keep the list fetch pending, so the card still shows the build-time data.
      http.get("*/api/products/", () => new Promise<never>(() => undefined)),
      http.get("*/api/products/:slug/", () => HttpResponse.json({ ...first, id: liveId })),
      http.post("*/api/cart/items/", async ({ request }) => {
        added = await request.json();
        return HttpResponse.json(makeCart({ item_count: 1 }), { status: 201 });
      }),
    );
    document.body.innerHTML = `<div id="root">${html}</div>`;
    window.history.replaceState(null, "", page.url);
    const container = document.getElementById("root");
    if (!container) throw new Error("no root");
    await act(async () => {
      root = hydrateRoot(container, <App initialState={state} />);
      await Promise.resolve();
    });

    const button = await screen.findByRole("button", { name: `Add ${first.name} to bag` });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Account: Maya Patel" })).toBeInTheDocument();
    });
    act(() => {
      button.click();
    });
    await waitFor(() => {
      expect(added).toEqual({ product_id: liveId, quantity: 1 });
    });
    // The pressed button acknowledges the add.
    expect(
      await screen.findByRole("button", { name: `Added ${first.name} to bag` }),
    ).toHaveTextContent("Added");
    setSession(null);
  });
});
