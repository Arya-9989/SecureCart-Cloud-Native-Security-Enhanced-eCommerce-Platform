import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

import { setSession } from "@/lib/api";

import { server, session } from "./server";

// jsdom gaps used by Recharts and the theme provider.
class ResizeObserverStub {
  observe() {
    /* noop */
  }
  unobserve() {
    /* noop */
  }
  disconnect() {
    /* noop */
  }
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});
window.scrollTo = vi.fn();
// cmdk keeps the active item in view.
Element.prototype.scrollIntoView = vi.fn();

// React Router's data router builds `new Request(url, { signal })` with jsdom's AbortSignal,
// which Node's undici-based Request rejects. Tests never abort navigations, so drop it.
const NodeRequest = globalThis.Request;
class TestRequest extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init?.signal ? { ...init, signal: undefined } : init);
  }
}
vi.stubGlobal("Request", TestRequest);

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  session.user = null;
  setSession(null);
  localStorage.clear();
});
afterAll(() => {
  server.close();
});
