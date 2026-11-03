import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  test as base,
  expect,
  type Page,
  type TestInfo,
} from "@playwright/test";

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

  /** The raw outcome, for asserting refusals (403s) and exact payloads. */
  async raw(
    method: Method,
    path: string,
    data?: unknown,
  ): Promise<{ status: number; text: string; json: unknown }> {
    const res = await this.request.fetch(`/api/v1${path}`, { method, data });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: res.status(), text, json };
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
  /** The signed-in request context (cookies shared with the test's page). */
  request: APIRequestContext;
}

export const uuid = () => randomUUID();

/** A unique test address, so parallel tests and repeated runs never share an account. */
export function testEmail(label: string, info: TestInfo): string {
  return `e2e-${label}-${info.project.name}-${info.workerIndex}-${randomUUID().slice(0, 8)}@coachman.test`;
}

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
 * Who a test signs in as (POST /api/test/sign-in):
 * - "coach": staff somewhere; a user with no membership gets their own new workspace.
 * - "none": a bare account (lands on /welcome), or an existing member or family user as they are.
 */
export type Persona = "coach" | "none";

export async function signIn(
  request: APIRequestContext,
  input: { email: string; name?: string; persona?: Persona },
): Promise<{ userId: string }> {
  const res = await request.post("/api/test/sign-in", {
    headers: { [BYPASS_HEADER]: bypassSecret() },
    data: { email: input.email, name: input.name ?? "Robin Coach", persona: input.persona },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { userId: string };
}

/** Adds a user (created if new) to the caller's workspace as staff with `role`. */
export async function addMember(
  request: APIRequestContext,
  input: { email: string; name: string; role: "owner" | "admin" | "coach" },
): Promise<{ userId: string; workspaceId: string }> {
  const res = await request.post("/api/test/member", {
    headers: { [BYPASS_HEADER]: bypassSecret() },
    data: input,
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { userId: string; workspaceId: string };
}

/**
 * Links a user (created if new) to one of the caller's students for the family portal. The
 * portal's age rules apply unless `force` is set.
 */
export async function linkFamily(
  request: APIRequestContext,
  input: {
    clientId: string;
    email: string;
    name: string;
    relation: "self" | "guardian";
    force?: boolean;
  },
): Promise<{ status: number; body: unknown }> {
  const res = await request.post("/api/test/family", {
    headers: { [BYPASS_HEADER]: bypassSecret() },
    data: input,
  });
  return { status: res.status(), body: await res.json().catch(() => undefined) };
}

export interface PersonaSession {
  email: string;
  context: BrowserContext;
  page: Page;
  api: Api;
}

/**
 * Opens a separate browser context (its own cookies, same device settings as the project) and
 * signs a person in there, so a test can drive two people at once. Service workers are blocked:
 * persona tests are about roles and routing, and every fresh context would otherwise precache
 * the whole app, a burst of ~100 requests that the local preview server can drop under load.
 */
export async function openAs(
  browser: Browser,
  input: { email: string; name?: string; persona?: Persona },
): Promise<PersonaSession> {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await signIn(context.request, input);
  return { email: input.email, context, page, api: new Api(context.request) };
}

/**
 * Collects what would tell someone a screen broke: uncaught page errors, console errors, and
 * failed requests (status, method, path). A 5xx without a JSON body never comes from the Worker,
 * whose errors are JSON: it's the local preview server dropping a request under load, which the
 * app retries, so it's left out.
 */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    // Failed requests are reported from their responses below, with their URL.
    if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource")) {
      errors.push(`console: ${msg.text()}`);
    }
  });
  page.on("response", (res) => {
    if (res.status() < 400) return;
    const json = (res.headers()["content-type"] ?? "").includes("application/json");
    if (res.status() >= 500 && !json) return;
    const url = new URL(res.url());
    errors.push(`${res.status()} ${res.request().method()} ${url.pathname}${url.search}`);
  });
  return errors;
}

/**
 * `page.goto` that rides out the local preview server dropping the page request itself under
 * load (it answers 500 with a "fetch failed" page instead of the app). The app is static, so a
 * 5xx here is never the app's answer.
 */
export async function visit(page: Page, url: string) {
  let res = await page.goto(url);
  for (let retry = 0; retry < 2 && res && res.status() >= 500; retry++) res = await page.goto(url);
  return res;
}

export interface Personas {
  /** Another person in their own browser context; closed (and their workspaces reset) after. */
  open: (input: { email: string; name?: string; persona?: Persona }) => Promise<PersonaSession>;
}

/**
 * `coach`: a brand-new coach signed in through the test bypass (fresh, empty workspace).
 * `seeded`: the same, onboarded with the sample clients, packages, and today's sessions.
 * `personas`: more people (staff members, families, bare accounts) in separate contexts.
 * Each test gets its own workspace, so tests can run in parallel.
 */
export const test = base.extend<{ coach: Coach; seeded: Coach; personas: Personas }>({
  coach: async ({ page }, use, info) => {
    const email = testEmail("coach", info);
    await signIn(page.request, { email, name: "Robin Coach" });
    await use({ email, api: new Api(page.request), request: page.request });
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
  personas: async ({ browser }, use) => {
    const opened: PersonaSession[] = [];
    await use({
      open: async (input) => {
        const session = await openAs(browser, input);
        opened.push(session);
        return session;
      },
    });
    for (const s of opened) {
      // Deletes only workspaces the persona owns (a member's academy belongs to its owner).
      await s.context.request
        .post("/api/test/reset", { headers: { [BYPASS_HEADER]: bypassSecret() } })
        .catch(() => undefined);
      await s.context.close().catch(() => undefined);
    }
  },
});

export { expect };
