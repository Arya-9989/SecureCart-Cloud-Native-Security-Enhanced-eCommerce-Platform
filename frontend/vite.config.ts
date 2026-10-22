/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.VITE_DEV_API_PROXY ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      // Same-origin in dev too, so the httpOnly refresh cookie behaves exactly as in prod.
      "/api": { target: apiTarget, changeOrigin: false },
      "/static": { target: apiTarget, changeOrigin: false },
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Charting code is only reachable from the lazily-loaded admin dashboard.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/recharts|d3-|victory-vendor|redux|reselect|immer|decimal\.js|es-toolkit/.test(id)) {
            return "charts";
          }
          return "vendor";
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
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
