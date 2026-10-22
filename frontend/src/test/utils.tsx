import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";

import { Providers } from "@/App";
import { SESSION_HINT_KEY } from "@/lib/api";
import { createQueryClient } from "@/lib/queryClient";
import type { User } from "@/lib/types";
import { routes } from "@/routes";

import { session } from "./server";

/** Render the real route table at ``path`` with all app providers. */
export function renderApp(path: string, { user = null }: { user?: User | null } = {}) {
  session.user = user;
  // A signed-in browser carries the session hint, so the app attempts its silent refresh.
  if (user) localStorage.setItem(SESSION_HINT_KEY, "1");
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const result = render(
    <Providers client={client}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...result, router, client, user: userEvent.setup() };
}
