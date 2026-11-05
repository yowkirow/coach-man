import { defineConfig, devices } from "@playwright/test";

// E2E against the real Worker + D1 (local `vite dev`, or a deployed preview via E2E_BASE_URL).
// Sign-in uses the env-gated test bypass (Google OAuth can't be automated):
//   E2E_BYPASS_SECRET   must equal the Worker's secret (falls back to .dev.vars locally)
//   E2E_BASE_URL        target URL; when unset, Playwright starts/reuses `npm run dev`
//   CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET  service token when the target sits behind Cloudflare Access
//   PW_CHANNEL          e.g. "msedge" or "chrome" to use an installed browser instead of downloading Chromium
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const channel = process.env.PW_CHANNEL || undefined;
const accessHeaders =
  process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET
    ? {
        "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID,
        "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET,
      }
    : undefined;

export default defineConfig({
  testDir: "e2e",
  // Warms a local server first (cold workerd answers its first bursts slowly); see the file.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  timeout: 60_000,
  // A deployed target is reached over the internet: an asset or API answer can take seconds there
  // (one smoke run saw an 11 s script download), so it gets more time than the local server.
  expect: { timeout: process.env.E2E_BASE_URL ? 30_000 : 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    extraHTTPHeaders: accessHeaders,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-US",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, channel },
    },
    { name: "mobile", use: { ...devices["Pixel 7"], channel } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // CI tests the production build (built in a prior step) running in workerd; locally a
        // running dev or preview server is reused.
        command: process.env.CI ? "npx vite preview --port 5173 --strictPort" : "npm run dev",
        url: "http://localhost:5173/api/health",
        reuseExistingServer: !process.env.CI,
        // Miniflare's local trace store (observability is on in wrangler.jsonc) grows without
        // limit and stalls the local runtime under test load; tests don't need it.
        env: { X_LOCAL_OBSERVABILITY: "false" },
        timeout: 600_000,
      },
});
