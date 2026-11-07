import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for pure domain logic (credits, money allocation, recurrence, time, bypass gate).
// Kept separate from vite.config.ts so the Cloudflare/PWA plugins don't load under Vitest.
// End-to-end coverage of the Worker + D1 runs through Playwright (see e2e/).
export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
    },
  },
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
  },
});
