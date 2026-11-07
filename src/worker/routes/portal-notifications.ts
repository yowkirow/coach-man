import { count, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import type {
  FamilyNotificationsDto,
  PushDeviceStateDto,
  PushTestResultDto,
} from "../../shared/api-types";
import { familyPrefsOf, TEST_PAYLOAD } from "../../shared/notifications";
import {
  familyNotificationPrefsSchema,
  pushEndpointSchema,
  pushSubscriptionSchema,
} from "../../shared/schemas";
import { familyNotificationPref, familyPushSubscription } from "../db/schema";
import { ApiError, badRequest } from "../lib/errors";
import { workspacesOf } from "../lib/portal-scope";
import { enforce } from "../lib/rate-limit";
import { v } from "../lib/validate";
import { membershipsForUser } from "../lib/workspace";
import { academyTimezone } from "../services/portal";
import {
  canPush,
  deliver,
  deviceState,
  familyDevices,
  pushConfigured,
  registerDevice,
  unregisterDevice,
} from "../services/push-delivery";
import type { AppBindings } from "../types";
import { assertSendableEndpoint } from "./push";

/** Test notifications: enough to try a few times, not enough to buzz a phone all day. */
const TEST_RULE = { windowMs: 10 * 60_000, max: 10 };

async function settingsOf(c: Context<AppBindings>): Promise<FamilyNotificationsDto> {
  const { db, user } = c.var;
  const [row, devices, memberships] = await Promise.all([
    db.query.familyNotificationPref.findFirst({
      where: eq(familyNotificationPref.userId, user.id),
    }),
    db
      .select({ n: count() })
      .from(familyPushSubscription)
      .where(eq(familyPushSubscription.userId, user.id)),
    membershipsForUser(db, user.id),
  ]);
  // Quiet hours and "the evening before" follow the academy's clock (the first one linked).
  const first = workspacesOf(c.var.portal)[0];
  return {
    prefs: familyPrefsOf(row ?? null),
    vapidPublicKey: pushConfigured(c.env) ? c.env.VAPID_PUBLIC_KEY : null,
    devices: devices[0]?.n ?? 0,
    timezone: first ? await academyTimezone(db, first) : "UTC",
    promptDismissed: Boolean(row?.promptDismissedAt),
    staff: memberships.length > 0,
  };
}

/**
 * The family's notification settings (mounted on /api/portal, behind `requirePortal`): which
 * categories, how long before a session, quiet hours, this device's registration, a test, and the
 * one-time "Get reminders on this phone" offer on Home. Any signed-in person; nothing here reads
 * another person's data. Staff devices and settings stay under /api/v1.
 */
export const portalNotificationRoutes = new Hono<AppBindings>()
  .get("/notifications", async (c) => c.json<FamilyNotificationsDto>(await settingsOf(c)))

  .put("/notifications", v("json", familyNotificationPrefsSchema), async (c) => {
    const input = c.req.valid("json");
    await c.var.db
      .insert(familyNotificationPref)
      .values({ userId: c.var.user.id, ...input })
      .onConflictDoUpdate({
        target: familyNotificationPref.userId,
        set: { ...input, updatedAt: Date.now() },
      });
    return c.json<FamilyNotificationsDto>(await settingsOf(c));
  })

  /** "Turn on for this device": this browser gets the caller's family notifications. */
  .post("/notifications/devices", v("json", pushSubscriptionSchema), async (c) => {
    const sub = c.req.valid("json");
    assertSendableEndpoint(c.env, sub.endpoint);
    await registerDevice(c.var.db, "family", {
      userId: c.var.user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: c.req.header("User-Agent")?.slice(0, 200) ?? null,
    });
    return c.body(null, 204);
  })

  /**
   * "Turn off": this browser stops getting family notifications. Answers what's left on it: when
   * coach notifications still use it, the app keeps the browser's subscription and says so.
   */
  .delete("/notifications/devices", v("json", pushEndpointSchema), async (c) =>
    c.json<PushDeviceStateDto>(
      await unregisterDevice(c.var.db, "family", c.var.user.id, c.req.valid("json").endpoint),
    ),
  )

  /** Which surfaces this browser (`?endpoint=`) gets the caller's notifications for. */
  .get("/notifications/device", async (c) => {
    const endpoint = c.req.query("endpoint") ?? "";
    if (!endpoint) throw badRequest("Which device?");
    return c.json<PushDeviceStateDto>(await deviceState(c.var.db, c.var.user.id, endpoint));
  })

  /** A test notification to every device that gets the caller's family notifications. */
  .post("/notifications/test", async (c) => {
    await c.req.raw.arrayBuffer().catch(() => undefined);
    if (!canPush(c.env)) {
      throw new ApiError(
        503,
        "push_unavailable",
        "Push notifications aren't set up on this server yet.",
      );
    }
    await enforce(c, `push-test:user:${c.var.user.id}`, TEST_RULE);
    const devices = await familyDevices(c.var.db, [c.var.user.id]);
    const delivered = await deliver(c.var.db, c.env, devices, TEST_PAYLOAD.family);
    return c.json<PushTestResultDto>({ delivered });
  })

  /** The one-time offer on Home was dismissed (or the settings opened): it isn't shown again. */
  .post("/notifications/prompt-dismissed", async (c) => {
    await c.req.raw.arrayBuffer().catch(() => undefined);
    const now = Date.now();
    await c.var.db
      .insert(familyNotificationPref)
      .values({ userId: c.var.user.id, promptDismissedAt: now })
      .onConflictDoUpdate({
        target: familyNotificationPref.userId,
        set: { promptDismissedAt: now },
      });
    return c.body(null, 204);
  });
