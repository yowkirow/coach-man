// Captures review screenshots of CoachMan at desktop (1440) and phone (390) sizes using the
// Playwright test-auth bypass. Needs the dev server running and E2E bypass vars in .dev.vars.
// Usage: node scripts/screenshots.mjs [outDir]   (env: E2E_BASE_URL, E2E_BYPASS_SECRET, PW_CHANNEL)
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

const secret = await bypassSecret();
const viewports = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
};
const email = process.env.SCREENSHOT_EMAIL ?? "smoke3@coachman.test";

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "msedge" });

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

for (const [name, opts] of Object.entries(viewports)) {
  // Signed out first.
  const anon = await browser.newContext({ ...opts, colorScheme: "light", serviceWorkers: "block" });
  const anonPage = await anon.newPage();
  await anonPage.goto(`${base}/sign-in`);
  await settle(anonPage);
  await anonPage.screenshot({ path: `${outDir}/sign-in-${name}.png` });
  await anon.close();

  const ctx = await browser.newContext({ ...opts, colorScheme: "light", serviceWorkers: "block" });
  const res = await ctx.request.post(`${base}/api/test/sign-in`, {
    headers: { "x-e2e-bypass": secret, "content-type": "application/json" },
    data: { email, name: "Casey Coach" },
  });
  if (!res.ok()) throw new Error(`Bypass sign-in failed: ${res.status()} ${await res.text()}`);
  const page = await ctx.newPage();

  const today = await (await ctx.request.get(`${base}/api/v1/today`)).json();
  const first = today.lessons?.[0]?.id;
  const shots = [
    ["today", "/"],
    ...(first ? [["session", `/sessions/${first}`]] : []),
    ["more", "/more"],
    ["onboarding-passkey", "/onboarding?step=passkey"],
  ];
  for (const [label, path] of shots) {
    await page.goto(`${base}${path}`);
    await settle(page);
    await page.screenshot({ path: `${outDir}/${label}-${name}.png`, fullPage: name === "mobile" });
    console.log(`wrote ${outDir}/${label}-${name}.png`);
  }
  await ctx.close();
}
await browser.close();
