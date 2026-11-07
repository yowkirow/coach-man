import { chromium, type FullConfig, request } from "@playwright/test";
import { BYPASS_HEADER, bypassSecret } from "./support";

/**
 * Warms a local server before the first test. A freshly started `vite preview` (workerd, the D1
 * Durable Object, and the static asset path) answers its first bursts slowly: on a cold run the
 * first parallel tests saw API calls take 10–15 s and timed out, while the same tests pass on a
 * warm server. One signed-in round of reads and writes, and one load of the app shell with its
 * service worker, takes that cost here instead of inside a test. Remote targets (E2E_BASE_URL)
 * aren't cold-started by the run, so they're left alone. A failed warm-up never fails the run.
 */
export default async function globalSetup(config: FullConfig) {
  if (process.env.E2E_BASE_URL) return;
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:5173";
  const started = Date.now();
  const headers = { [BYPASS_HEADER]: bypassSecret() };
  const api = await request.newContext({ baseURL });
  try {
    const email = `e2e-warmup-${Date.now()}@coachman.test`;
    const signIn = await api.post("/api/test/sign-in", {
      headers,
      data: { email, name: "Warm Up", persona: "coach" },
    });
    if (!signIn.ok()) throw new Error(`sign-in ${signIn.status()}`);
    await api.post("/api/test/seed?tz=Asia%2FManila&currency=PHP", { headers });
    const today = new Date().toISOString().slice(0, 10);
    const reads = [
      "/me",
      "/today",
      "/clients",
      "/groups",
      "/events?scope=upcoming",
      `/lessons?from=${today}&to=${today}`,
      "/rates",
      "/venues",
      "/skills",
      "/packages",
      "/coaches",
      "/team",
      "/academy",
      "/offline-pack",
    ];
    await Promise.all(reads.map((path) => api.get(`/api/v1${path}`)));
    const clients = (await (await api.get("/api/v1/clients")).json()) as { id: string }[];
    const first = clients[0];
    if (first) {
      await Promise.all([
        api.get(`/api/v1/clients/${first.id}`),
        api.get(`/api/v1/clients/${first.id}/progress`),
        api.post("/api/v1/notes", { data: { clientId: first.id, body: "Warm-up note." } }),
      ]);
    }
    await api.post("/api/test/reset", { headers });
  } catch (err) {
    console.warn(`E2E warm-up (API) skipped: ${(err as Error).message}`);
  } finally {
    await api.dispose();
  }

  // The app shell and the service worker's precache, served once.
  const browser = await chromium
    .launch({ channel: process.env.PW_CHANNEL || undefined })
    .catch(() => null);
  if (browser) {
    try {
      const page = await browser.newPage({ baseURL });
      await page.goto("/sign-in");
      await page.evaluate(async () => {
        if (!("serviceWorker" in navigator)) return;
        await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((resolve) => setTimeout(resolve, 30_000)),
        ]);
      });
    } catch (err) {
      console.warn(`E2E warm-up (app shell) skipped: ${(err as Error).message}`);
    } finally {
      await browser.close();
    }
  }
  console.log(`E2E warm-up done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
