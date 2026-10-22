/*
 * Prerenders the public pages (home, shop, /protection and every product) into
 * dist/_prerender/, so they read completely with JavaScript off and the browser hydrates them
 * instead of starting from a blank page. nginx serves these files on their own URLs
 * (nginx/default.conf); every other URL still gets the SPA shell, dist/index.html.
 *
 * The catalog comes from prerender/catalog.json: real API responses recorded from the seeded
 * demo store, so the build needs no running backend (the Docker image and CI build it alone).
 * The hydrated page treats that data as stale and refetches live stock and prices at once.
 *
 *   node scripts/prerender.mjs                  render dist/_prerender from the snapshot
 *   node scripts/prerender.mjs --capture URL    re-record the snapshot from a running stack
 *
 * Both modes need the prerender bundle first: vite build --ssr src/entry-server.tsx --outDir .ssr
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ssrDir = join(root, ".ssr");
const snapshotFile = join(root, "prerender", "catalog.json");
const dist = join(root, "dist");

const server = await import(pathToFileURL(join(ssrDir, "entry-server.js")).href);

const escapeHtml = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function capture(base) {
  const api = `${base.replace(/\/$/, "")}/api`;
  const get = async (path) => {
    const response = await fetch(api + path);
    if (!response.ok) throw new Error(`GET ${api}${path} answered ${response.status}`);
    return response.json();
  };
  const responses = {};
  responses[server.CATALOG_PATH] = await get(server.CATALOG_PATH);
  for (const page of server.prerenderPages(responses[server.CATALOG_PATH].results)) {
    for (const { path } of page.queries) responses[path] ??= await get(path);
  }
  const sorted = Object.fromEntries(
    Object.entries(responses).sort(([a], [b]) => a.localeCompare(b)),
  );
  const snapshot = {
    note: "Public catalog responses recorded from the seeded demo store (seed_demo) by `npm run prerender:capture`. Used only to prerender the public pages; the browser refetches live data on load.",
    capturedAt: new Date().toISOString(),
    responses: sorted,
  };
  mkdirSync(dirname(snapshotFile), { recursive: true });
  writeFileSync(snapshotFile, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Recorded ${Object.keys(sorted).length} responses into prerender/catalog.json`);
}

async function render() {
  const snapshot = JSON.parse(readFileSync(snapshotFile, "utf8"));
  const catalog = snapshot.responses[server.CATALOG_PATH]?.results;
  if (!Array.isArray(catalog)) throw new Error(`The snapshot has no ${server.CATALOG_PATH}`);
  const capturedAt = Date.parse(snapshot.capturedAt);
  const template = readFileSync(join(dist, "index.html"), "utf8");
  if (!template.includes('<div id="root"></div>')) throw new Error("No empty #root in index.html");

  const pages = server.prerenderPages(catalog);
  for (const page of pages) {
    const rendered = await server.renderPage(page, snapshot.responses, capturedAt);
    // React emits resource hints (preloads for the eager hero images) ahead of the markup;
    // they belong in <head>, as they would be in a full-document render.
    const hints = /^(?:<link [^>]*\/>)*/.exec(rendered.html)?.[0] ?? "";
    const html = rendered.html.slice(hints.length);
    const { state } = rendered;
    const payload = server.serializePayload({
      url: page.url,
      exactSearch: page.exactSearch,
      state,
    });
    const doc = template
      .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(page.title)}</title>`)
      .replace("</head>", `${hints}</head>`)
      .replace(
        /(<meta\s+name="description"\s+content=")[^"]*(")/,
        (_, open, close) => `${open}${escapeHtml(page.description)}${close}`,
      )
      .replace(
        '<div id="root"></div>',
        `<div id="root">${html}</div>\n    <script type="application/json" id="${server.PAYLOAD_ID}">${payload}</script>`,
      );
    const file = join(dist, "_prerender", page.file);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, doc);
  }
  console.log(`Prerendered ${pages.length} pages into dist/_prerender/`);
}

try {
  const at = process.argv.indexOf("--capture");
  if (at !== -1) {
    const base = process.argv[at + 1];
    if (!base) throw new Error("Usage: node scripts/prerender.mjs --capture http://localhost:8080");
    await capture(base);
  } else {
    await render();
  }
} finally {
  rmSync(ssrDir, { recursive: true, force: true });
}
