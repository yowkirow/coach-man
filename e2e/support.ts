import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { type APIRequestContext, test as base, expect } from "@playwright/test";

export const BYPASS_HEADER = "x-e2e-bypass";

/** The Worker's E2E bypass secret: from the environment (CI) or .dev.vars (local). */
export function bypassSecret(): string {
  if (process.env.E2E_BYPASS_SECRET) return process.env.E2E_BYPASS_SECRET;
  try {
    const match = readFileSync(".dev.vars", "utf8").match(
      /^E2E_BYPASS_SECRET\s*=\s*"?([^"\r\n]+)"?/m,
    );
    if (match?.[1]) return match[1];
  } catch {
    // fall through
  }
  throw new Error("Set E2E_BYPASS_SECRET to the Worker's bypass secret.");
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Thin JSON client for /api/v1 that shares the page's session cookie. */
export class Api {
  constructor(private readonly request: APIRequestContext) {}

  async call<T>(
    method: Method,
    path: string,
    data?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const res = await this.request.fetch(`/api/v1${path}`, { method, data, headers });
    const text = await res.text();
    if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()}: ${text}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  get<T>(path: string) {
    return this.call<T>("GET", path);
  }

  post<T>(path: string, data: unknown = {}, headers?: Record<string, string>) {
    return this.call<T>("POST", path, data, headers);
  }

  patch<T>(path: string, data: unknown) {
    return this.call<T>("PATCH", path, data);
  }
}

export interface Coach {
  email: string;
  api: Api;
}

export const uuid = () => randomUUID();

export async function onboard(api: Api, withSampleData = false) {
  await api.post("/workspace/onboard", {
    name: "E2E Coaching",
    currency: "PHP",
    timezone: "Asia/Manila",
    locale: "en-PH",
    withSampleData,
  });
}

/**
 * `coach`: a brand-new coach signed in through the test bypass (fresh, empty workspace).
 * `seeded`: the same, onboarded with the sample clients, packages, and today's sessions.
 * Each test gets its own workspace, so tests can run in parallel.
 */
export const test = base.extend<{ coach: Coach; seeded: Coach }>({
  coach: async ({ page }, use, info) => {
    const email = `e2e-${info.project.name}-${info.workerIndex}-${randomUUID().slice(0, 8)}@coachman.test`;
    const res = await page.request.post("/api/test/sign-in", {
      headers: { [BYPASS_HEADER]: bypassSecret() },
      data: { email, name: "Robin Coach" },
    });
    expect(res.ok(), await res.text()).toBe(true);
    await use({ email, api: new Api(page.request) });
    await page.request
      .post("/api/test/reset", { headers: { [BYPASS_HEADER]: bypassSecret() } })
      .catch(() => undefined);
  },
  seeded: async ({ page, coach }, use) => {
    const res = await page.request.post("/api/test/seed?tz=Asia%2FManila&currency=PHP", {
      headers: { [BYPASS_HEADER]: bypassSecret() },
    });
    expect(res.ok(), await res.text()).toBe(true);
    await use(coach);
  },
});

export { expect };
