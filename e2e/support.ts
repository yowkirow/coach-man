import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
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

  /** The error code of a refused request (`{ error: { code } }`), for asserting why. */
  static code(res: { json: unknown }): string | undefined {
    return (res.json as { error?: { code?: string } } | undefined)?.error?.code;
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

  put<T>(path: string, data: unknown) {
    return this.call<T>("PUT", path, data);
  }

  del<T>(path: string) {
    return this.call<T>("DELETE", path);
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

// --- Family access and the family portal ---------------------------------------------------------

/** The token at the end of an invite link (`…/join/<token>`). */
export function inviteToken(link: string): string {
  const match = link.match(/\/join\/([A-Za-z0-9_-]+)$/);
  if (!match?.[1]) throw new Error(`Not an invite link: ${link}`);
  return match[1];
}

/**
 * A birth date that makes a student `age` today, wherever "today" is: their birthday was a month
 * ago, so the academy's timezone (a day either way) can't change the age.
 */
export function bornYearsAgo(age: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - age);
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
}

export interface RawResponse {
  status: number;
  text: string;
  json: unknown;
}

async function rawOf(res: import("@playwright/test").APIResponse): Promise<RawResponse> {
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status(), text, json };
}

/** POST /api/invites/<token>/accept as whoever `request` is signed in as. */
export async function acceptInvite(request: APIRequestContext, token: string) {
  const res = await rawOf(await request.post(`/api/invites/${token}/accept`));
  return { ...res, code: Api.code(res) };
}

/** A family-portal call (/api/portal/…) as whoever `request` is signed in as. */
export async function portalCall(
  request: APIRequestContext,
  method: Method,
  path: string,
  data?: unknown,
): Promise<RawResponse> {
  return rawOf(await request.fetch(`/api/portal${path}`, { method, data }));
}

/** GET /api/portal/<path>, failing the test unless it answers 200. */
export async function portalGet<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await portalCall(request, "GET", path);
  expect(res.status, `GET /api/portal${path}: ${res.text}`).toBe(200);
  return res.json as T;
}

/** The caller's academy's audit log, newest first (test bypass). */
export async function auditLog(
  request: APIRequestContext,
): Promise<{ action: string; entity: string; entityId: string | null; data: unknown }[]> {
  const res = await request.post("/api/test/audit", {
    headers: { [BYPASS_HEADER]: bypassSecret() },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { entries: Awaited<ReturnType<typeof auditLog>> }).entries;
}

/** A small solid-color PNG (a logo, a photo, a QR stand-in), made without any image library. */
export function pngImage(size = 32, rgb: [number, number, number] = [214, 236, 91]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = (crcTable[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // truecolor RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from(rgb))]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: size }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", pixels),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** PUTs a PNG to a staff upload route (/api/v1/…/photo, /academy/logo, /academy/payment-qr). */
export async function uploadPng(request: APIRequestContext, path: string, image = pngImage()) {
  const res = await request.fetch(`/api/v1${path}`, {
    method: "PUT",
    data: image,
    headers: { "Content-Type": "image/png" },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { key?: string; photoKey?: string };
}
