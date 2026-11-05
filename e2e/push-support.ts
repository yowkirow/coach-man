import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import type { FamilyNotificationsDto } from "../src/shared/api-types";
import type { FamilyPrefs } from "../src/shared/notifications";
import { type Api, BYPASS_HEADER, bypassSecret, expect, portalCall } from "./support";

// Helpers for the family reminder specs (WS5b). Pushes never leave the machine: devices are
// registered with `https://push-sink.invalid/…` endpoints, which the Worker records in its test
// sink (outside production, with the E2E bypass on) instead of sending; the specs read the sink.

export const SINK_PREFIX = "https://push-sink.invalid/";

export interface SinkPush {
  id: string;
  userId: string;
  endpoint: string;
  surface: "staff" | "family";
  payload: { title: string; body: string; url: string; tag: string };
  createdAt: number;
}

export interface Sink {
  items: SinkPush[];
  queued: { kind: string; refKey: string; sendAfter: number }[];
}

const bypass = () => ({ [BYPASS_HEADER]: bypassSecret() });

/** The signed-in person's user id. */
export async function userIdOf(request: APIRequestContext): Promise<string> {
  const res = await request.get("/api/account");
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { user: { id: string } }).user.id;
}

/** What the sink recorded for a person, and what waits for their quiet hours to end. */
export async function sinkOf(request: APIRequestContext, userId: string): Promise<Sink> {
  const res = await request.get(`/api/test/push-sink?userId=${encodeURIComponent(userId)}`, {
    headers: bypass(),
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as Sink;
}

/** Waits until the person's pushes matching `match` reach `count`, then returns them. */
export async function pushes(
  request: APIRequestContext,
  userId: string,
  match: (p: SinkPush) => boolean = () => true,
  count = 1,
): Promise<SinkPush[]> {
  let found: SinkPush[] = [];
  await expect
    .poll(
      async () => {
        found = (await sinkOf(request, userId)).items.filter(match);
        return found.length;
      },
      { timeout: 20_000, intervals: [250, 500, 1000] },
    )
    .toBeGreaterThanOrEqual(count);
  return found;
}

/** A sink endpoint for one "device". */
export const sinkEndpoint = () => `${SINK_PREFIX}${randomUUID()}`;

const KEYS = { p256dh: "BTestP256dhKeyForTheSinkOnly", auth: "testAuthSecret" };

export const QUIET_OFF: Partial<FamilyPrefs> = { quietStart: null, quietEnd: null };

/** Every category on, a reminder an hour ahead, and quiet hours off (so tests don't depend on the clock). */
export const ALL_ON: FamilyPrefs = {
  sessions: true,
  sessionLead: "1h",
  packages: true,
  enrollment: true,
  progress: true,
  announcements: true,
  quietStart: null,
  quietEnd: null,
};

/** Saves the person's family notification settings through the portal. */
export async function setFamilyPrefs(
  request: APIRequestContext,
  prefs: Partial<FamilyPrefs> = {},
): Promise<FamilyNotificationsDto> {
  const res = await portalCall(request, "PUT", "/notifications", { ...ALL_ON, ...prefs });
  expect(res.status, res.text).toBe(200);
  return res.json as FamilyNotificationsDto;
}

/** "Turn on for this device" in the portal, with a sink endpoint; also saves the settings. */
export async function subscribeFamily(
  request: APIRequestContext,
  prefs: Partial<FamilyPrefs> = {},
  endpoint = sinkEndpoint(),
): Promise<string> {
  const res = await portalCall(request, "POST", "/notifications/devices", {
    endpoint,
    keys: KEYS,
  });
  expect(res.status, res.text).toBe(204);
  await setFamilyPrefs(request, prefs);
  return endpoint;
}

/** "Turn on" in the staff app's settings, with a sink endpoint. */
export async function subscribeStaff(api: Api, endpoint = sinkEndpoint()): Promise<string> {
  await api.post("/push/subscriptions", { endpoint, keys: KEYS });
  return endpoint;
}

/** The 5-minute cron's reminder steps, on demand (as of `at`, default now). */
export async function runReminders(
  request: APIRequestContext,
  input: { at?: number; steps?: ("staff" | "queue" | "sessions" | "payments")[] } = {},
) {
  const res = await request.post("/api/test/run-reminders", { headers: bypass(), data: input });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as {
    staff: boolean;
    queue: number;
    sessions: number;
    payments: number;
  };
}

/** Local date and HH:MM of an instant in a time zone (what the lesson API takes). */
export function localParts(ms: number, timeZone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(ms)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/** Lets work that runs after a response (pushes are sent in `waitUntil`) finish. */
export const settle = (ms = 1500) => new Promise((resolve) => setTimeout(resolve, ms));
