import { and, count, desc, eq, gt, gte, isNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import type {
  StaffInviteCreatedDto,
  StaffInviteDto,
  TeamDto,
  TeamMemberDto,
} from "../../shared/api-types";
import { uuidv7 } from "../../shared/ids";
import { can, isCoachingRole, normalizeRole } from "../../shared/roles";
import { memberRoleSchema, staffInviteSchema, transferOwnershipSchema } from "../../shared/schemas";
import {
  checkRemoval,
  checkRoleChange,
  checkTransfer,
  LAST_OWNER_MESSAGE,
} from "../../shared/team";
import { todayIn } from "../../shared/time";
import {
  client,
  clientCoach,
  event,
  invite,
  lesson,
  lessonSeries,
  member,
  trainingGroup,
  user,
} from "../db/schema";
import { auditEntry } from "../lib/audit";
import { ApiError, conflict, notFound } from "../lib/errors";
import { appOrigin } from "../lib/page-meta";
import { INVITE_TTL_MS, inviteStatus, newToken } from "../lib/tokens";
import { v } from "../lib/validate";
import { ctxOf, requireCap } from "../middleware";
import {
  coachName,
  coachRefs,
  type StaffRow,
  staffRows,
  toCoachSummary,
} from "../services/coaches";
import { runBatch } from "../services/credits";
import { emailStaffInvite } from "../services/email";
import type { AppBindings, Ctx } from "../types";

/** Expired invites stay listed (so they can be sent again) for this long. */
const EXPIRED_INVITES_SHOWN_MS = 30 * 24 * 60 * 60 * 1000;

/** True while the academy has more than one owner (guards demoting or removing an owner). */
const anotherOwner = (workspaceId: string) =>
  sql`(select count(*) from member m where m.organization_id = ${workspaceId} and instr(',' || m.role || ',', ',owner,') > 0) > 1`;

/**
 * The member still isn't an owner. Changes to someone read as a non-owner carry this guard, so a
 * promotion (or an ownership transfer) landing in between can't be undone by someone who may not
 * change owners, or leave the academy without one.
 */
const stillNotOwner = sql`instr(',' || ${member.role} || ',', ',owner,') = 0`;

const ROLE_CHANGED = "Their role changed a moment ago. Check the team and try again.";

function toMemberDto(r: StaffRow, students: number, showEmail: boolean): TeamMemberDto {
  return {
    ...toCoachSummary(r),
    accountName: r.accountName,
    email: showEmail ? r.email : null,
    joinedAt: r.joinedAt,
    isPublic: r.isPublic,
    students,
  };
}

function toInviteDto(
  row: typeof invite.$inferSelect,
  invitedBy: string | null,
  now = Date.now(),
): StaffInviteDto {
  return {
    id: row.id,
    email: row.email ?? "",
    role: normalizeRole(row.role),
    status: inviteStatus(row, now),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    invitedBy,
  };
}

async function loadTeam(ctx: Ctx): Promise<TeamDto> {
  const { db, workspaceId } = ctx;
  const now = Date.now();
  const [staff, students, invites] = await Promise.all([
    staffRows(db, workspaceId),
    db
      .select({ coachUserId: clientCoach.coachUserId, n: count() })
      .from(clientCoach)
      .innerJoin(client, eq(client.id, clientCoach.clientId))
      .where(
        and(
          eq(clientCoach.workspaceId, workspaceId),
          isNull(clientCoach.endedOn),
          ne(client.status, "archived"),
        ),
      )
      .groupBy(clientCoach.coachUserId),
    // Pending and recently expired staff invites: only for people who manage the team.
    can(ctx.role, "team")
      ? db
          .select({ i: invite, invitedBy: user.name })
          .from(invite)
          .leftJoin(user, eq(user.id, invite.createdBy))
          .where(
            and(
              eq(invite.workspaceId, workspaceId),
              eq(invite.kind, "staff"),
              isNull(invite.acceptedAt),
              isNull(invite.revokedAt),
              gt(invite.expiresAt, now - EXPIRED_INVITES_SHOWN_MS),
            ),
          )
          .orderBy(desc(invite.createdAt))
      : Promise.resolve([]),
  ]);
  const studentCount = new Map(students.map((s) => [s.coachUserId, Number(s.n)]));
  // Colleagues' email addresses are for the people who manage the team; everyone sees their own.
  const manages = can(ctx.role, "team");
  return {
    members: staff.map((s) =>
      toMemberDto(s, studentCount.get(s.userId) ?? 0, manages || s.userId === ctx.userId),
    ),
    invites: invites.map((r) => toInviteDto(r.i, r.invitedBy ?? null, now)),
  };
}

async function findMember(ctx: Ctx, userId: string) {
  const staff = await staffRows(ctx.db, ctx.workspaceId);
  const target = staff.find((s) => s.userId === userId);
  if (!target) throw notFound("Team member");
  return { staff, target, ownerCount: staff.filter((s) => s.role === "owner").length };
}

function refuse(result: { ok: false; status: 403 | 409; code: string; message: string }): never {
  throw new ApiError(result.status, result.code, result.message);
}

/**
 * Ends someone's coaching (on leaving the team, or moving to the front desk): their current
 * students lose them as coach, with the history kept, and upcoming sessions, series, programs, and
 * events lose them as lead or assistant.
 */
function releaseCoachStatements(ctx: Ctx, userId: string, today: string) {
  const { db, workspaceId } = ctx;
  const now = Date.now();
  const assistants = (table: string) => sql.raw(`"${table}"."assistant_coach_ids"`);
  const dropAssistant = (table: string) =>
    sql`(select coalesce(json_group_array(value), '[]') from json_each(${assistants(table)}) where value != ${userId})`;
  const isAssistant = (table: string) =>
    sql`exists (select 1 from json_each(${assistants(table)}) where value = ${userId})`;
  return [
    db
      .update(clientCoach)
      .set({ endedOn: today })
      .where(
        and(
          eq(clientCoach.workspaceId, workspaceId),
          eq(clientCoach.coachUserId, userId),
          isNull(clientCoach.endedOn),
        ),
      ),
    db
      .update(lesson)
      .set({ coachUserId: null })
      .where(
        and(
          eq(lesson.workspaceId, workspaceId),
          eq(lesson.coachUserId, userId),
          gte(lesson.startsAt, now),
        ),
      ),
    db
      .update(lesson)
      .set({ assistantCoachIds: dropAssistant("lesson") })
      .where(
        and(eq(lesson.workspaceId, workspaceId), gte(lesson.startsAt, now), isAssistant("lesson")),
      ),
    db
      .update(lessonSeries)
      .set({ coachUserId: null })
      .where(and(eq(lessonSeries.workspaceId, workspaceId), eq(lessonSeries.coachUserId, userId))),
    db
      .update(lessonSeries)
      .set({ assistantCoachIds: dropAssistant("lesson_series") })
      .where(and(eq(lessonSeries.workspaceId, workspaceId), isAssistant("lesson_series"))),
    db
      .update(trainingGroup)
      .set({ coachUserId: null })
      .where(
        and(eq(trainingGroup.workspaceId, workspaceId), eq(trainingGroup.coachUserId, userId)),
      ),
    db
      .update(trainingGroup)
      .set({ assistantCoachIds: dropAssistant("training_group") })
      .where(and(eq(trainingGroup.workspaceId, workspaceId), isAssistant("training_group"))),
    db
      .update(event)
      .set({ coachUserId: null })
      .where(
        and(
          eq(event.workspaceId, workspaceId),
          eq(event.coachUserId, userId),
          gte(event.endsOn, today),
        ),
      ),
    db
      .update(event)
      .set({ assistantCoachIds: dropAssistant("event") })
      .where(
        and(eq(event.workspaceId, workspaceId), gte(event.endsOn, today), isAssistant("event")),
      ),
  ];
}

/**
 * The team (staff API): members with their role, when they joined, and their coach profile; staff
 * invite links (emailed to the invited address too); role changes, removal, and ownership.
 * Everyone on the team can see who's on it; managing it takes `team`, and anything that touches
 * an owner takes `ownership`. An academy always keeps at least one owner.
 */
export const teamRoutes = new Hono<AppBindings>()
  .get("/team", async (c) => c.json(await loadTeam(ctxOf(c))))

  .post("/team/invites", requireCap("team"), v("json", staffInviteSchema), async (c) => {
    const ctx = ctxOf(c);
    const { email, role } = c.req.valid("json");
    const [already] = await ctx.db
      .select({ name: user.name })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, ctx.workspaceId), sql`lower(${user.email}) = ${email}`))
      .limit(1);
    if (already) {
      throw conflict(`${already.name} is already on your team.`, {
        fields: { email: "This person is already on your team." },
      });
    }
    const now = Date.now();
    const { token, hash } = await newToken();
    const id = uuidv7();
    await runBatch(ctx, [
      // One live link per person: inviting again replaces the last link.
      ctx.db
        .update(invite)
        .set({ revokedAt: now })
        .where(
          and(
            eq(invite.workspaceId, ctx.workspaceId),
            eq(invite.kind, "staff"),
            eq(invite.email, email),
            isNull(invite.acceptedAt),
            isNull(invite.revokedAt),
          ),
        ),
      ctx.db.insert(invite).values({
        id,
        workspaceId: ctx.workspaceId,
        kind: "staff",
        tokenHash: hash,
        email,
        role,
        createdBy: ctx.userId,
        createdAt: now,
        expiresAt: now + INVITE_TTL_MS,
      }),
      auditEntry(ctx, "invite", "staff_invite", id, { email, role }),
    ]);
    const row = await ctx.db.query.invite.findFirst({ where: eq(invite.id, id) });
    if (!row) throw notFound("Invite");
    const me = await ctx.db.query.user.findFirst({ where: eq(user.id, ctx.userId) });
    // The email names the inviter as the team knows them: their coach profile's name.
    const inviterName = (await coachRefs(ctx.db, ctx.workspaceId, [ctx.userId])).get(
      ctx.userId,
    )?.name;
    const link = `${appOrigin(ctx.env)}/join/${token}`;
    // Sent now, so the answer says whether it went; the link works either way.
    const emailed = await emailStaffInvite(ctx.db, ctx.env, {
      workspaceId: ctx.workspaceId,
      inviter: me ? { name: inviterName ?? me.name, email: me.email } : null,
      to: email,
      role,
      link,
      expiresAt: row.expiresAt,
    });
    const body: StaffInviteCreatedDto = {
      invite: toInviteDto(row, me?.name ?? null, now),
      link,
      ...emailed,
    };
    return c.json(body, 201);
  })

  .delete("/team/invites/:id", requireCap("team"), async (c) => {
    const ctx = ctxOf(c);
    const row = await ctx.db.query.invite.findFirst({
      where: and(
        eq(invite.id, c.req.param("id")),
        eq(invite.workspaceId, ctx.workspaceId),
        eq(invite.kind, "staff"),
      ),
    });
    if (!row) throw notFound("Invite");
    if (row.acceptedAt) throw conflict("This invite was already used, so it can't be withdrawn.");
    if (!row.revokedAt) {
      await runBatch(ctx, [
        ctx.db.update(invite).set({ revokedAt: Date.now() }).where(eq(invite.id, row.id)),
        auditEntry(ctx, "revoke", "staff_invite", row.id, { email: row.email }),
      ]);
    }
    return c.body(null, 204);
  })

  .patch("/team/members/:userId", requireCap("team"), v("json", memberRoleSchema), async (c) => {
    const ctx = ctxOf(c);
    const { role } = c.req.valid("json");
    const { target, ownerCount } = await findMember(ctx, c.req.param("userId"));
    const check = checkRoleChange({
      actorRole: ctx.role,
      targetRole: target.role,
      newRole: role,
      ownerCount,
    });
    if (!check.ok) refuse(check);
    if (target.role !== role) {
      const where = and(
        eq(member.organizationId, ctx.workspaceId),
        eq(member.userId, target.userId),
      );
      const owner = target.role === "owner";
      // Two owners demoting each other at once must still leave one: the guard is in the update.
      const changed = await ctx.db
        .update(member)
        .set({ role })
        .where(and(where, owner ? anotherOwner(ctx.workspaceId) : stillNotOwner))
        .returning({ id: member.id });
      if (!changed.length) {
        throw owner ? new ApiError(409, "last_owner", LAST_OWNER_MESSAGE) : conflict(ROLE_CHANGED);
      }
      // Someone who stops coaching (moved to the front desk) lets go of it as if they'd left the
      // team: their students and everything ahead lose them as coach; what they coached stays.
      const releasing = isCoachingRole(target.role) && !isCoachingRole(role);
      await runBatch(ctx, [
        ...(releasing
          ? releaseCoachStatements(ctx, target.userId, todayIn(ctx.settings.timezone))
          : []),
        auditEntry(ctx, "role", "member", target.userId, {
          from: target.role,
          to: role,
          ...(releasing ? { releasedCoaching: true } : {}),
        }),
      ]);
    }
    return c.json(await loadTeam(target.userId === ctx.userId ? { ...ctx, role } : ctx));
  })

  .delete("/team/members/:userId", requireCap("team"), async (c) => {
    const ctx = ctxOf(c);
    const { target, ownerCount } = await findMember(ctx, c.req.param("userId"));
    const check = checkRemoval({ actorRole: ctx.role, targetRole: target.role, ownerCount });
    if (!check.ok) refuse(check);
    const where = and(eq(member.organizationId, ctx.workspaceId), eq(member.userId, target.userId));
    const owner = target.role === "owner";
    const removed = await ctx.db
      .delete(member)
      .where(and(where, owner ? anotherOwner(ctx.workspaceId) : stillNotOwner))
      .returning({ id: member.id });
    if (!removed.length) {
      throw owner ? new ApiError(409, "last_owner", LAST_OWNER_MESSAGE) : conflict(ROLE_CHANGED);
    }
    // Their history (notes, past sessions, past assignments) stays; what's ahead goes back to the
    // academy: current students lose them as coach, upcoming sessions lose them as lead/assistant.
    await runBatch(ctx, [
      ...releaseCoachStatements(ctx, target.userId, todayIn(ctx.settings.timezone)),
      auditEntry(ctx, "remove", "member", target.userId, {
        name: coachName(target),
        role: target.role,
      }),
    ]);
    return c.body(null, 204);
  })

  .post(
    "/team/transfer-ownership",
    requireCap("ownership"),
    v("json", transferOwnershipSchema),
    async (c) => {
      const ctx = ctxOf(c);
      const { userId } = c.req.valid("json");
      const check = checkTransfer({ actorRole: ctx.role, actorId: ctx.userId, targetId: userId });
      if (!check.ok) refuse(check);
      const { target } = await findMember(ctx, userId);
      const targetIsOwner = sql`exists (select 1 from member m where m.organization_id = ${ctx.workspaceId} and m.user_id = ${target.userId} and instr(',' || m.role || ',', ',owner,') > 0)`;
      await runBatch(ctx, [
        ctx.db
          .update(member)
          .set({ role: "owner" })
          .where(and(eq(member.organizationId, ctx.workspaceId), eq(member.userId, target.userId))),
        // Step down only once they really are an owner (they may have left a moment ago).
        ctx.db
          .update(member)
          .set({ role: "admin" })
          .where(
            and(
              eq(member.organizationId, ctx.workspaceId),
              eq(member.userId, ctx.userId),
              targetIsOwner,
            ),
          ),
        auditEntry(ctx, "transfer", "ownership", target.userId, { from: ctx.userId }),
      ]);
      const team = await loadTeam({ ...ctx, role: "admin" });
      if (team.members.find((m) => m.userId === target.userId)?.role !== "owner") {
        throw conflict(`${coachName(target)} isn't on the team any more, so nothing changed.`);
      }
      return c.json(team);
    },
  );
