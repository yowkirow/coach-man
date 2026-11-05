// Push delivery: the two device registries (staff devices in `push_subscription`, family devices
// in `family_push_subscription`), sending one payload to a person's devices (or recording it in
// the test sink), cleaning up endpoints the push service says are gone, and the notification log
// that keeps every push to once. The staff reminders and digests (push.ts) and family reminders
// (family-push.ts) both send through here.

import { buildPushHTTPRequest } from "@pushforge/builder";
import { and, eq, ne } from "drizzle-orm";
import type { PushDeviceStateDto } from "../../shared/api-types";
import { uuidv7 } from "../../shared/ids";
import type { PushPayload } from "../../shared/notifications";
import { chunkRows, type Db } from "../db/client";
import { familyPushSubscription, notificationLog, pushSink, pushSubscription } from "../db/schema";
import { isPushSinkEnabled, pushRoute } from "../lib/push-sink";
import { inList, unique } from "../lib/sql";

export type { PushPayload };

/** Which settings page registered a device: the staff app's, or the family portal's. */
export type PushSurface = "staff" | "family";

/** A browser that gets push notifications for one person, from one of the two registries. */
export interface PushDevice {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failureCount: number;
  surface: PushSurface;
}

export function pushConfigured(env: Env): boolean {
  return Boolean(env.VAPID_PRIVATE_KEY && env.VAPID_PUBLIC_KEY);
}

/** Anything can be delivered: real push is set up, or the test sink is on (never in production). */
export function canPush(env: Env): boolean {
  return pushConfigured(env) || isPushSinkEnabled(env);
}

const tableOf = (surface: PushSurface) =>
  surface === "staff" ? pushSubscription : familyPushSubscription;

async function sendOne(
  env: Env,
  device: PushDevice,
  payload: PushPayload,
): Promise<"ok" | "sink" | "gone" | "error"> {
  const route = pushRoute(env, device.endpoint);
  // A sink endpoint while the sink is off (production): never sent anywhere, and dropped.
  if (route === "refuse") return "gone";
  if (route === "sink") return "sink";
  if (!pushConfigured(env)) return "error";
  try {
    const privateJWK = JSON.parse(env.VAPID_PRIVATE_KEY);
    const req = await buildPushHTTPRequest({
      privateJWK,
      subscription: {
        endpoint: device.endpoint,
        keys: { p256dh: device.p256dh, auth: device.auth },
      },
      message: {
        payload: { ...payload },
        adminContact: env.VAPID_SUBJECT || "mailto:coach@example.com",
        options: {
          ttl: 60 * 60,
          urgency: "normal",
          ...(payload.tag ? { topic: topicOf(payload.tag) } : {}),
        },
      },
    });
    const res = await fetch(req.endpoint, { method: "POST", headers: req.headers, body: req.body });
    if (res.status === 404 || res.status === 410) return "gone";
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

/** A Web Push topic is at most 32 URL-safe characters. */
function topicOf(tag: string): string {
  return tag.replace(/[^A-Za-z0-9_-]/g, "-").slice(-32);
}

/** An endpoint the push service says is gone (404/410) is removed from both registries. */
export async function forgetEndpoint(db: Db, endpoint: string): Promise<void> {
  await db.batch([
    db.delete(pushSubscription).where(eq(pushSubscription.endpoint, endpoint)),
    db.delete(familyPushSubscription).where(eq(familyPushSubscription.endpoint, endpoint)),
  ]);
}

/**
 * Sends one payload to a person's devices: once per endpoint (a browser registered from both
 * settings pages gets it once); the test sink records instead of sending; a gone endpoint (or one
 * failing five times running) is removed everywhere. Returns how many devices it reached.
 */
export async function deliver(
  db: Db,
  env: Env,
  devices: readonly PushDevice[],
  payload: PushPayload,
): Promise<number> {
  const seen = new Set<string>();
  let delivered = 0;
  for (const device of devices) {
    if (seen.has(device.endpoint)) continue;
    seen.add(device.endpoint);
    const result = await sendOne(env, device, payload);
    const table = tableOf(device.surface);
    if (result === "ok" || result === "sink") {
      delivered++;
      if (result === "sink") {
        await db.insert(pushSink).values({
          id: uuidv7(),
          userId: device.userId,
          endpoint: device.endpoint,
          surface: device.surface,
          payload: { ...payload },
        });
      }
      await db
        .update(table)
        .set({ lastSuccessAt: Date.now(), failureCount: 0 })
        .where(eq(table.id, device.id));
    } else if (result === "gone" || device.failureCount >= 4) {
      await forgetEndpoint(db, device.endpoint);
    } else {
      await db
        .update(table)
        .set({ failureCount: device.failureCount + 1 })
        .where(eq(table.id, device.id));
    }
  }
  return delivered;
}

async function devicesIn(
  db: Db,
  surface: PushSurface,
  userIds: readonly string[],
): Promise<PushDevice[]> {
  const ids = unique(userIds);
  if (!ids.length) return [];
  const table = tableOf(surface);
  const rows = await db
    .select({
      id: table.id,
      userId: table.userId,
      endpoint: table.endpoint,
      p256dh: table.p256dh,
      auth: table.auth,
      failureCount: table.failureCount,
    })
    .from(table)
    .where(inList(table.userId, ids));
  return rows.map((r) => ({ ...r, surface }));
}

/** Devices registered from the staff app (Settings → Notifications). */
export const staffDevices = (db: Db, userIds: readonly string[]) => devicesIn(db, "staff", userIds);

/** Devices registered from the family portal (My family → Notifications). */
export const familyDevices = (db: Db, userIds: readonly string[]) =>
  devicesIn(db, "family", userIds);

export interface DeviceInput {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

/**
 * Registers this browser for one surface's notifications. A device belongs to one person at a
 * time: the same endpoint registered by someone else (a shared phone) is removed from both
 * registries first.
 */
export async function registerDevice(
  db: Db,
  surface: PushSurface,
  input: DeviceInput & { workspaceId?: string },
): Promise<void> {
  const { userId, endpoint, p256dh, auth, userAgent } = input;
  const others = [
    db
      .delete(pushSubscription)
      .where(and(eq(pushSubscription.endpoint, endpoint), ne(pushSubscription.userId, userId))),
    db
      .delete(familyPushSubscription)
      .where(
        and(
          eq(familyPushSubscription.endpoint, endpoint),
          ne(familyPushSubscription.userId, userId),
        ),
      ),
  ] as const;
  if (surface === "staff") {
    const workspaceId = input.workspaceId as string;
    await db.batch([
      ...others,
      db
        .insert(pushSubscription)
        .values({ id: uuidv7(), userId, workspaceId, endpoint, p256dh, auth, userAgent })
        .onConflictDoUpdate({
          target: pushSubscription.endpoint,
          set: { userId, workspaceId, p256dh, auth, userAgent, failureCount: 0 },
        }),
    ]);
    return;
  }
  await db.batch([
    ...others,
    db
      .insert(familyPushSubscription)
      .values({ id: uuidv7(), userId, endpoint, p256dh, auth, userAgent })
      .onConflictDoUpdate({
        target: familyPushSubscription.endpoint,
        set: { userId, p256dh, auth, userAgent, failureCount: 0 },
      }),
  ]);
}

/** Which surfaces this person gets notifications for on this browser. */
export async function deviceState(
  db: Db,
  userId: string,
  endpoint: string,
): Promise<PushDeviceStateDto> {
  const [staff, family] = await Promise.all([
    db
      .select({ id: pushSubscription.id })
      .from(pushSubscription)
      .where(and(eq(pushSubscription.endpoint, endpoint), eq(pushSubscription.userId, userId)))
      .limit(1),
    db
      .select({ id: familyPushSubscription.id })
      .from(familyPushSubscription)
      .where(
        and(
          eq(familyPushSubscription.endpoint, endpoint),
          eq(familyPushSubscription.userId, userId),
        ),
      )
      .limit(1),
  ]);
  return { staff: staff.length > 0, family: family.length > 0 };
}

/**
 * Stops one surface's notifications on this browser and says what's left: the app keeps the
 * browser's subscription (and tells the person) while the other surface still uses it.
 */
export async function unregisterDevice(
  db: Db,
  surface: PushSurface,
  userId: string,
  endpoint: string,
): Promise<PushDeviceStateDto> {
  const table = tableOf(surface);
  await db.delete(table).where(and(eq(table.endpoint, endpoint), eq(table.userId, userId)));
  return deviceState(db, userId, endpoint);
}

/** Signing out: this browser stops getting the person's notifications from either surface. */
export async function forgetDevice(db: Db, userId: string, endpoint: string): Promise<void> {
  await db.batch([
    db
      .delete(pushSubscription)
      .where(and(eq(pushSubscription.endpoint, endpoint), eq(pushSubscription.userId, userId))),
    db
      .delete(familyPushSubscription)
      .where(
        and(
          eq(familyPushSubscription.endpoint, endpoint),
          eq(familyPushSubscription.userId, userId),
        ),
      ),
  ]);
}

export interface LogEntry {
  userId: string;
  workspaceId: string;
  kind: string;
  refKey: string;
}

export const logKey = (e: Pick<LogEntry, "userId" | "kind" | "refKey">) =>
  `${e.userId}|${e.kind}|${e.refKey}`;

/**
 * Claims notification-log rows (one per person, kind, and thing, ever): returns the keys this call
 * inserted. Whatever someone else already claimed (another surface, a replay, an earlier run) is
 * left out, which is what keeps every notification to once.
 */
export async function claimLog(
  db: Db,
  entries: readonly LogEntry[],
  now: number,
): Promise<Set<string>> {
  const claimed = new Set<string>();
  const rows = entries.map((e) => ({ id: uuidv7(), ...e, sentAt: now }));
  for (const chunk of chunkRows(rows, 6)) {
    const inserted = await db
      .insert(notificationLog)
      .values(chunk)
      .onConflictDoNothing()
      .returning({
        userId: notificationLog.userId,
        kind: notificationLog.kind,
        refKey: notificationLog.refKey,
      });
    for (const r of inserted) claimed.add(logKey(r));
  }
  return claimed;
}

/** Which of these (person, thing) pairs of one kind were already notified. */
export async function loggedKeys(
  db: Db,
  kind: string,
  userIds: readonly string[],
  refKeys: readonly string[],
): Promise<Set<string>> {
  if (!userIds.length || !refKeys.length) return new Set();
  const rows = await db
    .select({
      userId: notificationLog.userId,
      kind: notificationLog.kind,
      refKey: notificationLog.refKey,
    })
    .from(notificationLog)
    .where(
      and(
        inList(notificationLog.userId, unique(userIds)),
        eq(notificationLog.kind, kind),
        inList(notificationLog.refKey, unique(refKeys)),
      ),
    );
  return new Set(rows.map(logKey));
}

/**
 * Sends to every staff device of a person. Dedupes on (user, kind, refKey) when a log key is
 * given, and only once there's a device to send to (so a person who is also family still gets
 * the notification on their family devices if the family side gets there first).
 */
export async function notifyUser(
  db: Db,
  env: Env,
  target: { userId: string; workspaceId: string },
  payload: PushPayload,
  log?: { kind: string; refKey: string },
): Promise<number> {
  if (!canPush(env)) return 0;
  const devices = await staffDevices(db, [target.userId]);
  if (!devices.length) return 0;
  if (log) {
    const entry = {
      userId: target.userId,
      workspaceId: target.workspaceId,
      kind: log.kind,
      refKey: log.refKey,
    };
    const claimed = await claimLog(db, [entry], Date.now());
    if (!claimed.has(logKey(entry))) return 0;
  }
  return deliver(db, env, devices, payload);
}
