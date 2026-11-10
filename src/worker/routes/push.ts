import { count, eq } from "drizzle-orm";
import { Hono } from "hono";
import type {
  NotificationPrefDto,
  PushDeviceStateDto,
  PushTestResultDto,
} from "../../shared/api-types";
import { TEST_PAYLOAD } from "../../shared/notifications";
import {
  notificationPrefSchema,
  pushEndpointSchema,
  pushSubscriptionSchema,
} from "../../shared/schemas";
import { notificationPref, pushSubscription } from "../db/schema";
import { ApiError, badRequest } from "../lib/errors";
import { pushRoute } from "../lib/push-sink";
import { v } from "../lib/validate";
import {
  canPush,
  deviceState,
  notifyUser,
  pushConfigured,
  registerDevice,
  unregisterDevice,
} from "../services/push-delivery";
import type { AppBindings } from "../types";

/** A push endpoint this server won't send to (a test-sink address outside tests). */
export function assertSendableEndpoint(env: Env, endpoint: string) {
  if (pushRoute(env, endpoint) === "refuse") {
    throw badRequest("That push address isn't valid.", { fields: { endpoint: "Not valid" } });
  }
}

/**
 * Staff notifications (/api/v1): settings (session reminders, the morning digest, package expiry,
 * and for roles with `enrollment` "Enrollments & payments"), this device's registration, and a
 * test. Families' own settings and devices are under /api/portal/notifications.
 */
export const pushRoutes = new Hono<AppBindings>()
  .get("/notification-prefs", async (c) => {
    const { db, user, workspaceId } = c.var;
    let pref = await db.query.notificationPref.findFirst({
      where: eq(notificationPref.userId, user.id),
    });
    if (!pref) {
      await db
        .insert(notificationPref)
        .values({ userId: user.id, workspaceId })
        .onConflictDoNothing();
      pref = await db.query.notificationPref.findFirst({
        where: eq(notificationPref.userId, user.id),
      });
    }
    const [subs] = await db
      .select({ n: count() })
      .from(pushSubscription)
      .where(eq(pushSubscription.userId, user.id));
    const body: NotificationPrefDto = {
      sessionReminderMinutes: pref?.sessionReminderMinutes ?? null,
      dailyDigestTime: pref?.dailyDigestTime ?? null,
      packageExpiryDays: pref?.packageExpiryDays ?? 7,
      enrollmentAlerts: pref?.enrollmentAlerts ?? true,
      subscriptions: subs?.n ?? 0,
      vapidPublicKey: pushConfigured(c.env) ? c.env.VAPID_PUBLIC_KEY : null,
    };
    return c.json(body);
  })

  .put("/notification-prefs", v("json", notificationPrefSchema), async (c) => {
    const { db, user, workspaceId } = c.var;
    const input = c.req.valid("json");
    await db
      .insert(notificationPref)
      .values({ userId: user.id, workspaceId, ...input })
      .onConflictDoUpdate({
        target: notificationPref.userId,
        set: { ...input, updatedAt: Date.now() },
      });
    return c.body(null, 204);
  })

  .post("/push/subscriptions", v("json", pushSubscriptionSchema), async (c) => {
    const { db, user, workspaceId } = c.var;
    const sub = c.req.valid("json");
    assertSendableEndpoint(c.env, sub.endpoint);
    await registerDevice(db, "staff", {
      userId: user.id,
      workspaceId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: c.req.header("User-Agent")?.slice(0, 200) ?? null,
    });
    return c.body(null, 204);
  })

  /**
   * This browser stops getting staff notifications. Answers what's left on it: when family
   * notifications still use it, the app keeps the browser's subscription and says so.
   */
  .delete("/push/subscriptions", v("json", pushEndpointSchema), async (c) =>
    c.json<PushDeviceStateDto>(
      await unregisterDevice(c.var.db, "staff", c.var.user.id, c.req.valid("json").endpoint),
    ),
  )

  /** Which surfaces this browser (`?endpoint=`) gets the caller's notifications for. */
  .get("/push/device", async (c) => {
    const endpoint = c.req.query("endpoint") ?? "";
    if (!endpoint) throw badRequest("Which device?");
    return c.json<PushDeviceStateDto>(await deviceState(c.var.db, c.var.user.id, endpoint));
  })

  .post("/push/test", async (c) => {
    if (!canPush(c.env)) {
      throw new ApiError(
        503,
        "push_unavailable",
        "Push notifications aren't set up on this server yet.",
      );
    }
    const delivered = await notifyUser(
      c.var.db,
      c.env,
      { userId: c.var.user.id, workspaceId: c.var.workspaceId },
      TEST_PAYLOAD.staff,
    );
    return c.json<PushTestResultDto>({ delivered });
  });
