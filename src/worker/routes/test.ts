import { and, asc, desc, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { FAMILY_RELATIONS, isPlaceholderEmail } from "../../shared/domain";
import { checkFamilyAccess } from "../../shared/family";
import { uuidv7 } from "../../shared/ids";
import { normalizeRole, STAFF_ROLES } from "../../shared/roles";
import { todayIn } from "../../shared/time";
import { getDb } from "../db/client";
import {
  announcement,
  auditLog,
  client,
  clientAccess,
  emailSink,
  familyNotificationQueue,
  invite,
  organization,
  pushSink,
  user,
  workspaceSettings,
} from "../db/schema";
import { E2E_HEADER, isBypassRequestAllowed } from "../lib/bypass";
import { ApiError, notFound, noWorkspace, unauthorized } from "../lib/errors";
import { deleteAbandonedPasskeyAccounts } from "../lib/passkey-accounts";
import { v } from "../lib/validate";
import {
  activeMembership,
  addStaffMember,
  firstWorkspaceForUser,
  membershipsForUser,
  provisionWorkspace,
} from "../lib/workspace";
import { runAnnouncements } from "../services/announcements";
import {
  runFamilyQueue,
  runFamilySweeps,
  runPaymentReminders,
  runSessionReminders,
} from "../services/family-push";
import { runReminders } from "../services/push";
import { seedSampleData } from "../services/sample-data";
import type { AppBindings } from "../types";

async function callerSession(c: Context<AppBindings>) {
  const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) throw unauthorized();
  return session;
}

/** The caller's active workspace (like requireWorkspace, without provisioning). */
async function callerWorkspace(c: Context<AppBindings>) {
  const { user, session } = await callerSession(c);
  const membership = await activeMembership(
    getDb(c.env.DB),
    user.id,
    (session as { activeOrganizationId?: string | null }).activeOrganizationId,
  );
  if (!membership) throw noWorkspace();
  return { user, workspaceId: membership.workspaceId };
}

/**
 * Finds the user by email or creates them (verified, like a Google sign-in would). Created
 * directly: Better Auth's createUser now runs `validateUserInfo`, which only works inside one of
 * its own endpoints.
 */
async function ensureUser(c: Context<AppBindings>, email: string, name: string) {
  const db = getDb(c.env.DB);
  const found = await db.query.user.findFirst({ where: eq(user.email, email) });
  if (found) return found;
  const id = uuidv7();
  await db.insert(user).values({ id, email, name, emailVerified: true }).onConflictDoNothing();
  const created = await db.query.user.findFirst({ where: eq(user.email, email) });
  if (!created) throw new ApiError(500, "internal", "Couldn't create the test user.");
  return created;
}

const memberSchema = z.object({
  email: z.email(),
  name: z.string().min(1).max(80).default("Sam Coach"),
  role: z.enum(STAFF_ROLES).default("coach"),
});

const familySchema = z.object({
  clientId: z.string().min(1),
  email: z.email(),
  name: z.string().min(1).max(80).default("Pat Family"),
  relation: z.enum(FAMILY_RELATIONS).default("guardian"),
  /** Skip the portal's age rules (e.g. to test what the API does with a bad link). */
  force: z.boolean().default(false),
});

/**
 * Playwright-only helpers. Every route answers 404 unless the bypass is enabled for this
 * environment (never in production) and the request carries the shared secret header.
 *
 * - POST /sign-in { email, name, persona?: "coach" | "none" } signs in (see auth.ts e2eSignIn).
 * - POST /member { email, name, role } adds a user to the caller's workspace as staff.
 * - POST /family { clientId, email, name, relation, force? } links a user to a student.
 * - POST /expire-invite { inviteId } makes one of the caller's academy's invites expire now.
 * - POST /audit lists the caller's academy's audit log, newest first.
 * - POST /run-announcements { id? } runs the cron's announcements step (moving a scheduled one's
 *   time to a moment ago first).
 * - POST /user-exists { userId } says whether an account still exists.
 * - POST /cleanup-accounts { userId, hours } ages a passkey-only account, then runs the daily
 *   cleanup of abandoned ones.
 * - GET /push-sink?userId= lists the pushes the test sink recorded for a person (and what waits
 *   for their quiet hours to end); DELETE /push-sink?userId= clears them.
 * - GET /email-sink?to= lists the emails the test sink recorded for an address; DELETE
 *   /email-sink?to= clears them.
 * - POST /run-reminders { at?, steps? } runs the 5-minute cron's reminder steps as of `at`.
 * - POST /run-family-sweeps { at? } runs the daily family sweeps as of `at`.
 * - POST /seed fills the caller's workspace with the sample data; POST /reset deletes the
 *   workspaces the caller owns.
 */
export const testRoutes = new Hono<AppBindings>()
  .use("*", async (c, next) => {
    if (!isBypassRequestAllowed(c.env, c.req.header(E2E_HEADER))) {
      // Drain the body first: Miniflare's local proxy can fail a request answered unread.
      await c.req.raw.arrayBuffer().catch(() => undefined);
      return c.json({ error: { code: "not_found", message: "No such endpoint." } }, 404);
    }
    await next();
  })

  .post("/sign-in", async (c) => {
    const url = new URL("/api/auth/e2e/sign-in", c.req.url);
    const body = await c.req.text();
    const headers = new Headers(c.req.raw.headers);
    headers.set("content-type", "application/json");
    return c.var.auth.handler(new Request(url, { method: "POST", headers, body: body || "{}" }));
  })

  .post("/member", v("json", memberSchema), async (c) => {
    const { workspaceId } = await callerWorkspace(c);
    const { email, name, role } = c.req.valid("json");
    const user = await ensureUser(c, email.toLowerCase(), name);
    await addStaffMember(getDb(c.env.DB), { workspaceId, userId: user.id, role });
    return c.json({ userId: user.id, workspaceId, role }, 201);
  })

  .post("/family", v("json", familySchema), async (c) => {
    const db = getDb(c.env.DB);
    const { user: caller, workspaceId } = await callerWorkspace(c);
    const input = c.req.valid("json");
    const student = await db.query.client.findFirst({
      where: and(eq(client.id, input.clientId), eq(client.workspaceId, workspaceId)),
    });
    if (!student) throw notFound("Client");
    if (!input.force) {
      const settings = await db.query.workspaceSettings.findFirst({
        where: eq(workspaceSettings.workspaceId, workspaceId),
      });
      const guardians = await db
        .select({ id: clientAccess.id })
        .from(clientAccess)
        .where(
          and(
            eq(clientAccess.clientId, student.id),
            eq(clientAccess.relation, "guardian"),
            isNull(clientAccess.revokedAt),
          ),
        )
        .limit(1);
      const check = checkFamilyAccess({
        relation: input.relation,
        birthDate: student.birthDate,
        isJunior: student.isJunior,
        today: todayIn(settings?.timezone ?? "UTC"),
        hasGuardian: guardians.length > 0,
      });
      if (!check.ok) throw new ApiError(409, check.code, check.message);
    }
    const user = await ensureUser(c, input.email.toLowerCase(), input.name);
    await db
      .insert(clientAccess)
      .values({
        id: uuidv7(),
        workspaceId,
        clientId: student.id,
        userId: user.id,
        relation: input.relation,
        grantedBy: caller.id,
      })
      .onConflictDoUpdate({
        target: [clientAccess.clientId, clientAccess.userId],
        set: { relation: input.relation, revokedAt: null, grantedBy: caller.id },
      });
    return c.json(
      { userId: user.id, clientId: student.id, workspaceId, relation: input.relation },
      201,
    );
  })

  .post("/reset", async (c) => {
    const { user } = await callerSession(c);
    const db = getDb(c.env.DB);
    // Only what the caller owns: a coach-role member must never delete someone else's academy.
    for (const m of await membershipsForUser(db, user.id)) {
      if (normalizeRole(m.role) !== "owner") continue;
      await db.delete(organization).where(eq(organization.id, m.workspaceId));
    }
    return c.body(null, 204);
  })

  /** Makes one of the caller's academy's invites expire now (invites otherwise last 7 days). */
  .post("/expire-invite", v("json", z.object({ inviteId: z.string().min(1) })), async (c) => {
    const { workspaceId } = await callerWorkspace(c);
    const { inviteId } = c.req.valid("json");
    const res = await getDb(c.env.DB)
      .update(invite)
      .set({ expiresAt: Date.now() - 1000 })
      .where(and(eq(invite.id, inviteId), eq(invite.workspaceId, workspaceId)))
      .returning({ id: invite.id });
    if (!res.length) throw notFound("Invite");
    return c.body(null, 204);
  })

  /** The caller's academy's audit log, newest first (the app has no screen for it yet). */
  .post("/audit", async (c) => {
    const { workspaceId } = await callerWorkspace(c);
    const rows = await getDb(c.env.DB)
      .select({
        action: auditLog.action,
        entity: auditLog.entity,
        entityId: auditLog.entityId,
        userId: auditLog.userId,
        data: auditLog.data,
      })
      .from(auditLog)
      .where(eq(auditLog.workspaceId, workspaceId))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(200);
    return c.json({ entries: rows });
  })

  /**
   * The 5-minute cron's announcements step, on demand. With `id` (one of the caller's academy's
   * scheduled announcements), its time is moved to a moment ago first, as if it had come. Answers
   * which of the caller's announcements this run announced, and the target's `notifiedAt` (another
   * test's run may have announced it first: it's announced once either way).
   */
  .post(
    "/run-announcements",
    v("json", z.object({ id: z.string().min(1).optional() })),
    async (c) => {
      const db = getDb(c.env.DB);
      const { workspaceId } = await callerWorkspace(c);
      const { id } = c.req.valid("json");
      const now = Date.now();
      if (id) {
        const moved = await db
          .update(announcement)
          .set({ publishedAt: now - 1000 })
          .where(
            and(
              eq(announcement.id, id),
              eq(announcement.workspaceId, workspaceId),
              isNotNull(announcement.publishedAt),
              gt(announcement.publishedAt, now),
            ),
          )
          .returning({ id: announcement.id });
        if (!moved.length) throw notFound("Scheduled announcement");
      }
      const fired = await runAnnouncements(db, c.env, Date.now());
      const mine = fired.length
        ? await db
            .select({ id: announcement.id })
            .from(announcement)
            .where(and(eq(announcement.workspaceId, workspaceId), inArray(announcement.id, fired)))
        : [];
      const target = id
        ? await db.query.announcement.findFirst({
            where: eq(announcement.id, id),
            columns: { notifiedAt: true, publishedAt: true },
          })
        : undefined;
      return c.json({
        fired: mine.map((r) => r.id),
        ...(target ? { notifiedAt: target.notifiedAt, publishedAt: target.publishedAt } : {}),
      });
    },
  )

  /** Whether an account still exists (passkey-only accounts are removed when abandoned). */
  .post("/user-exists", v("json", z.object({ userId: z.string().min(1) })), async (c) => {
    const row = await getDb(c.env.DB).query.user.findFirst({
      where: eq(user.id, c.req.valid("json").userId),
      columns: { id: true },
    });
    return c.json({ exists: Boolean(row) });
  })

  /**
   * What the push sink recorded for a person (`https://push-sink.invalid/…` endpoints are never
   * sent over the network outside production; see lib/push-sink.ts), oldest first, with what still
   * waits in the quiet-hours queue.
   */
  .get("/push-sink", async (c) => {
    const userId = c.req.query("userId") ?? "";
    if (!userId) throw notFound("Person");
    const db = getDb(c.env.DB);
    const [items, queued] = await Promise.all([
      db
        .select()
        .from(pushSink)
        .where(eq(pushSink.userId, userId))
        .orderBy(asc(pushSink.createdAt), asc(pushSink.id)),
      db
        .select({
          kind: familyNotificationQueue.kind,
          refKey: familyNotificationQueue.refKey,
          sendAfter: familyNotificationQueue.sendAfter,
        })
        .from(familyNotificationQueue)
        .where(eq(familyNotificationQueue.userId, userId)),
    ]);
    return c.json({ items, queued });
  })

  /** Clears a person's recorded pushes. */
  .delete("/push-sink", async (c) => {
    const userId = c.req.query("userId") ?? "";
    if (!userId) throw notFound("Person");
    await getDb(c.env.DB).delete(pushSink).where(eq(pushSink.userId, userId));
    return c.body(null, 204);
  })

  /**
   * What the email sink recorded for an address (outside production with the bypass on, every
   * email is recorded instead of sent; see lib/email-sink.ts), oldest first.
   */
  .get("/email-sink", async (c) => {
    const to = (c.req.query("to") ?? "").trim().toLowerCase();
    if (!to) throw notFound("Address");
    const items = await getDb(c.env.DB)
      .select()
      .from(emailSink)
      .where(eq(emailSink.toEmail, to))
      .orderBy(asc(emailSink.createdAt), asc(emailSink.id));
    return c.json({ items });
  })

  /** Clears an address's recorded emails. */
  .delete("/email-sink", async (c) => {
    const to = (c.req.query("to") ?? "").trim().toLowerCase();
    if (!to) throw notFound("Address");
    await getDb(c.env.DB).delete(emailSink).where(eq(emailSink.toEmail, to));
    return c.body(null, 204);
  })

  /**
   * The 5-minute cron's reminder steps, on demand, as of `at` (default now): staff reminders and
   * digests, the family queue (quiet hours over), session reminders, and payment reminders. `steps`
   * picks some of them.
   */
  .post(
    "/run-reminders",
    v(
      "json",
      z.object({
        at: z.number().int().positive().optional(),
        steps: z.array(z.enum(["staff", "queue", "sessions", "payments"])).optional(),
      }),
    ),
    async (c) => {
      const db = getDb(c.env.DB);
      const { at, steps } = c.req.valid("json");
      const now = at ?? Date.now();
      const run = (s: "staff" | "queue" | "sessions" | "payments") => !steps || steps.includes(s);
      const out = { staff: false, queue: 0, sessions: 0, payments: 0 };
      if (run("staff")) {
        await runReminders(db, c.env, new Date(now));
        out.staff = true;
      }
      if (run("queue")) out.queue = await runFamilyQueue(db, c.env, now);
      if (run("sessions")) out.sessions = await runSessionReminders(db, c.env, now);
      if (run("payments")) out.payments = await runPaymentReminders(db, c.env, now);
      return c.json(out);
    },
  )

  /** The daily family sweeps (renewals, one session left, packages ending), as of `at`. */
  .post(
    "/run-family-sweeps",
    v("json", z.object({ at: z.number().int().positive().optional() })),
    async (c) => {
      const sent = await runFamilySweeps(
        getDb(c.env.DB),
        c.env,
        c.req.valid("json").at ?? Date.now(),
      );
      return c.json({ sent });
    },
  )

  /**
   * Ages a passkey-only account by `hours` (so the daily cleanup's 24-hour rule can be tested
   * without waiting), then runs that cleanup. Placeholder-email accounts only.
   */
  .post(
    "/cleanup-accounts",
    v("json", z.object({ userId: z.string().min(1), hours: z.number().min(0).max(1000) })),
    async (c) => {
      const db = getDb(c.env.DB);
      const { userId, hours } = c.req.valid("json");
      const row = await db.query.user.findFirst({ where: eq(user.id, userId) });
      if (!row || !isPlaceholderEmail(row.email)) throw notFound("Passkey-only account");
      await db
        .update(user)
        .set({ createdAt: new Date(row.createdAt.getTime() - hours * 3_600_000) })
        .where(eq(user.id, userId));
      const removed = await deleteAbandonedPasskeyAccounts(db, Date.now());
      return c.json({ removed });
    },
  )

  .post("/seed", async (c) => {
    const { user } = await callerSession(c);
    const db = getDb(c.env.DB);
    const wsId =
      (await firstWorkspaceForUser(db, user.id)) ??
      (await provisionWorkspace(db, { id: user.id, name: user.name }));
    const settings = await db.query.workspaceSettings.findFirst({
      where: eq(workspaceSettings.workspaceId, wsId),
    });
    if (!settings) throw unauthorized();
    const tz = c.req.query("tz");
    const currency = c.req.query("currency");
    const effective = {
      ...settings,
      ...(tz ? { timezone: tz } : {}),
      ...(currency ? { currency } : {}),
    };
    await db
      .update(workspaceSettings)
      .set({
        timezone: effective.timezone,
        currency: effective.currency,
        onboardedAt: settings.onboardedAt ?? Date.now(),
      })
      .where(eq(workspaceSettings.workspaceId, wsId));
    const ids = await seedSampleData({
      db,
      env: c.env,
      workspaceId: wsId,
      userId: user.id,
      settings: effective,
      role: "owner",
    });
    return c.json(ids);
  });
