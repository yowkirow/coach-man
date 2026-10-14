import { and, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { NotificationPrefDto } from "../../shared/api-types";
import { uuidv7 } from "../../shared/ids";
import { notificationPrefSchema, pushSubscriptionSchema } from "../../shared/schemas";
import { notificationPref, pushSubscription } from "../db/schema";
import { ApiError } from "../lib/errors";
import { v } from "../lib/validate";
import { notifyUser, pushConfigured } from "../services/push";
import type { AppBindings } from "../types";

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
    await db
      .insert(pushSubscription)
      .values({
        id: uuidv7(),
        userId: user.id,
        workspaceId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent: c.req.header("User-Agent")?.slice(0, 200) ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscription.endpoint,
        set: {
          userId: user.id,
          workspaceId,
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth,
          failureCount: 0,
        },
      });
    return c.body(null, 204);
  })

  .delete("/push/subscriptions", v("json", z.object({ endpoint: z.string().url() })), async (c) => {
    const { db, user } = c.var;
    await db
      .delete(pushSubscription)
      .where(
        and(
          eq(pushSubscription.userId, user.id),
          eq(pushSubscription.endpoint, c.req.valid("json").endpoint),
        ),
      );
    return c.body(null, 204);
  })

  .post("/push/test", async (c) => {
    if (!pushConfigured(c.env)) {
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
      {
        title: "CoachMan reminders are on",
        body: "This is how session reminders will look.",
        url: "/settings",
        tag: "test",
      },
    );
    return c.json({ delivered });
  });
