// Captures review screenshots of CoachMan at desktop (1440) and phone (390) sizes using the
// Playwright test-auth bypass. Needs the app running and E2E bypass vars in .dev.vars.
// Usage: node scripts/screenshots.mjs [outDir]
// Env: E2E_BASE_URL, E2E_BYPASS_SECRET, PW_CHANNEL (default msedge), SCREENSHOT_EMAIL,
//      SHOT_PATHS="/schedule,/clients" (default: the full app tour), SHOT_VIEWPORTS="desktop,mobile",
//      SHOT_SEED=1 (seed sample data into the account first if it has none)
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const base = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const outDir = process.argv[2] ?? ".impeccable/review";

async function bypassSecret() {
  if (process.env.E2E_BYPASS_SECRET) return process.env.E2E_BYPASS_SECRET;
  const vars = await readFile(".dev.vars", "utf8").catch(() => "");
  const match = vars.match(/^E2E_BYPASS_SECRET\s*=\s*"?([^"\r\n]+)"?/m);
  if (!match) throw new Error("Set E2E_BYPASS_SECRET (or add it to .dev.vars).");
  return match[1];
}

const TOUR = [
  "/sign-in",
  "/",
  "/session",
  "/schedule",
  "/clients",
  "/client",
  "/groups",
  "/events",
  "/money",
  "/packages",
  "/settings",
  "/more",
];

const secret = await bypassSecret();
const allViewports = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
};
const wanted = (process.env.SHOT_VIEWPORTS ?? "desktop,mobile").split(",");
const viewports = Object.entries(allViewports).filter(([name]) => wanted.includes(name));
const paths = process.env.SHOT_PATHS ? process.env.SHOT_PATHS.split(",") : TOUR;
const email = process.env.SCREENSHOT_EMAIL ?? "smoke3@coachman.test";

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "msedge" });

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

const label = (path) => (path === "/" ? "today" : path.replace(/^\//, "").replace(/[/?=&]+/g, "-"));

for (const [name, opts] of viewports) {
  const ctx = await browser.newContext({ ...opts, colorScheme: "light", serviceWorkers: "block" });
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(120_000);

  if (paths.includes("/sign-in")) {
    await page.goto(`${base}/sign-in`);
    await settle(page);
    await page.screenshot({ path: `${outDir}/sign-in-${name}.png` });
    console.log(`wrote ${outDir}/sign-in-${name}.png`);
  }

  const res = await ctx.request.post(`${base}/api/test/sign-in`, {
    headers: { "x-e2e-bypass": secret, "content-type": "application/json" },
    data: { email, name: "Casey Coach" },
  });
  if (!res.ok()) throw new Error(`Bypass sign-in failed: ${res.status()} ${await res.text()}`);

  // SHOT_SEED=1: give a fresh account the sample clients, packages, and today's sessions once.
  if (process.env.SHOT_SEED === "1") {
    const me = await (await ctx.request.get(`${base}/api/v1/me`)).json();
    if (!me.hasSampleData) {
      const seeded = await ctx.request.post(`${base}/api/test/seed?tz=Asia%2FManila&currency=PHP`, {
        headers: { "x-e2e-bypass": secret },
      });
      if (!seeded.ok())
        throw new Error(`Seeding failed: ${seeded.status()} ${await seeded.text()}`);
    }
  }

  // "/session" and "/client" stand for the first session today and the first client.
  const today = await (await ctx.request.get(`${base}/api/v1/today`)).json();
  const clients = await (await ctx.request.get(`${base}/api/v1/clients`)).json();
  const resolve = (path) =>
    path === "/session"
      ? today.lessons?.[0]
        ? `/sessions/${today.lessons[0].id}`
        : null
      : path === "/client"
        ? clients?.[0]
          ? `/clients/${clients[0].id}`
          : null
        : path;

  for (const path of paths.filter((p) => p !== "/sign-in")) {
    const target = resolve(path);
    if (!target) continue;
    await page.goto(`${base}${target}`);
    await settle(page);
    const file = `${outDir}/${label(path)}-${name}.png`;
    await page.screenshot({ path: file, fullPage: name === "mobile" });
    console.log(`wrote ${file}`);
  }
  await ctx.close();
}
await browser.close();
