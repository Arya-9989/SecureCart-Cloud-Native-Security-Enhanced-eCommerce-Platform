/*
 * Build-time prerender entry (scripts/prerender.mjs). Renders a public page to HTML with the
 * real route table and providers, from catalog responses recorded from the API, so the page
 * reads completely with JavaScript off and the browser hydrates it instead of starting blank.
 * Never shipped to the browser.
 */
import { dehydrate, type DehydratedState } from "@tanstack/react-query";
import { StrictMode } from "react";
import { prerender } from "react-dom/static";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";

import { Providers } from "@/App";
import { createQueryClient } from "@/lib/queryClient";
import type { PrerenderPage } from "@/prerender/pages";
import { routes } from "@/routes";

export { CATALOG_PATH, prerenderPages } from "@/prerender/pages";
export { PAYLOAD_ID, serializePayload } from "@/prerender/payload";

export interface RenderedPage {
  html: string;
  state: DehydratedState;
}

export async function renderPage(
  page: PrerenderPage,
  responses: Record<string, unknown>,
  capturedAt: number,
): Promise<RenderedPage> {
  const client = createQueryClient();
  for (const query of page.queries) {
    if (!(query.path in responses)) {
      throw new Error(`The catalog snapshot has no response for ${query.path} (${page.url})`);
    }
    // Dated when it was recorded, so the hydrated page treats it as stale and refetches
    // live stock and prices straight away.
    client.setQueryData(query.key, responses[query.path], { updatedAt: capturedAt });
  }

  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request(`http://prerender.invalid${page.url}`));
  if (context instanceof Response) throw new Error(`${page.url} answered ${context.status}`);
  const router = createStaticRouter(handler.dataRoutes, context);

  // hydrate={false}: the routes have no loaders, so there is no router state to hand over,
  // and React Router's inline hydration script would be blocked by the CSP anyway.
  const { prelude } = await prerender(
    <StrictMode>
      <Providers client={client}>
        <StaticRouterProvider router={router} context={context} hydrate={false} />
      </Providers>
    </StrictMode>,
  );
  const html = await new Response(prelude).text();
  return { html, state: dehydrate(client) };
}
