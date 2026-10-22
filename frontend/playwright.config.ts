import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the production build (`vite preview`, which also sends nginx's
 * real CSP and security headers) and a live, seeded Django API.
 *
 * Start the API first (see .github/workflows/ci.yml for the exact commands), then run
 * `npm run e2e`. Override ports with E2E_PORT and VITE_DEV_API_PROXY.
 */
const port = Number(process.env.E2E_PORT ?? "4173");
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Specs share one seeded database (bag, stock, orders), so they run in order.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run preview -- --host localhost`,
    url: baseURL,
    env: { VITE_PREVIEW_PORT: String(port) },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
