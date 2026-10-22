/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.VITE_DEV_API_PROXY ?? "http://localhost:8000";
const devPort = Number(process.env.VITE_PORT ?? "5173");
const previewPort = Number(process.env.VITE_PREVIEW_PORT ?? "4173");

// Same-origin in dev and preview too, so the httpOnly refresh cookie behaves exactly as in prod.
const proxy = {
  "/api": { target: apiTarget, changeOrigin: false },
  "/static": { target: apiTarget, changeOrigin: false },
};

/**
 * `vite preview` serves the production build with the exact security headers nginx sends,
 * parsed from the nginx snippet itself, so e2e tests and Lighthouse run under the real CSP.
 */
function nginxSecurityHeaders(): Record<string, string> {
  const conf = readFileSync(
    fileURLToPath(new URL("./nginx/security-headers.conf", import.meta.url)),
    "utf8",
  );
  const headers: Record<string, string> = {};
  for (const match of conf.matchAll(/^add_header\s+(\S+)\s+"([^"]*)"/gm)) {
    const [, name, value] = match;
    if (name && value) headers[name] = value;
  }
  return headers;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { port: devPort, strictPort: true, proxy },
  preview: { port: previewPort, strictPort: true, proxy, headers: nginxSecurityHeaders() },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // React core is shared by every route; charting code is only reachable from the
        // lazily-loaded admin dashboard. Everything else follows the route-level splits.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // Small libraries shared by the storefront and Recharts (clsx) must be pinned to an
          // always-loaded chunk; otherwise Rollup pulls them into "charts" and every storefront
          // page ends up preloading the whole charting library.
          if (/[\\/]node_modules[\\/]clsx[\\/]/.test(id)) return "react";
          if (/recharts|d3-|victory-vendor|redux|reselect|immer|decimal\.js|es-toolkit/.test(id)) {
            return "charts";
          }
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/.test(id)) {
            return "react";
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    restoreMocks: true,
    // Node's fetch needs absolute URLs; MSW handlers match any origin.
    env: { VITE_API_BASE_URL: "http://localhost:3000" },
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/test/**", "src/main.tsx", "src/**/*.d.ts"],
    },
  },
});
