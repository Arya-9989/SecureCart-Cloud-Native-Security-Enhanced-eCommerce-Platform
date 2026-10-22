import "./index.css";

import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

import { App } from "./App";
import { canHydrate, readPayload } from "./prerender/payload";

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");

// Public pages arrive prerendered (scripts/prerender.mjs): hydrate them with the data they
// were rendered from. Everything else, or HTML paired with another URL, renders from scratch.
const payload = readPayload(document);
if (payload && canHydrate(payload, window.location)) {
  hydrateRoot(
    container,
    <StrictMode>
      <App initialState={payload.state} />
    </StrictMode>,
  );
} else {
  container.replaceChildren();
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
