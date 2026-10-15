import { and, asc, desc, eq, gte, inArray, isNull, like, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import type {
  ClientDetailDto,
  ClientDto,
  ClientListItemDto,
  LedgerLineDto,
} from "../../shared/api-types";
import { CLIENT_STATUSES } from "../../shared/domain";
import { uuidv7 } from "../../shared/ids";
import { clientSchema, clientUpdateSchema } from "../../shared/schemas";
import { localDate, todayIn } from "../../shared/time";
import {
  attendance,
  charge,
  client,
  clientPackage,
  creditLedger,
  event,
  eventRegistration,
  groupMember,
  lesson,
  payment,
  trainingGroup,
} from "../db/schema";
import { auditEntry } from "../lib/audit";
import { badRequest, conflict, notFound } from "../lib/errors";
import { unique } from "../lib/sql";
import { v } from "../lib/validate";
import { ctxOf } from "../middleware";
import { packagesForClients, runBatch } from "../services/credits";
import {
  lessonSummaries,
  syncMemberIntoGroupLessons,
  unbookMemberFromGroupLessons,
} from "../services/lessons";
import { balancesFor } from "../services/money";
import type { AppBindings, Ctx } from "../types";

type ClientRow = typeof client.$inferSelect;

function listColumns(today: string) {
  return {
    c: client,
    groupIds: sql<
      string | null
    >`(select group_concat(gm.group_id) from group_member gm where gm.client_id = "client"."id" and gm.left_on is null)`,
    credits: sql<number>`(select coalesce(sum(cp.credits_total + coalesce((select sum(cl.delta) from credit_ledger cl where cl.client_package_id = cp.id), 0)), 0) from client_package cp where cp.client_id = "client"."id" and cp.status = 'active' and (cp.expires_on is null or cp.expires_on >= ${today}))`,
    activePackages: sql<number>`(select count(*) from client_package cp where cp.client_id = "client"."id" and cp.status = 'active' and (cp.expires_on is null or cp.expires_on >= ${today}))`,
    lastSeenAt: sql<
      number | null
    >`(select max(l.starts_at) from attendance a join lesson l on l.id = a.lesson_id where a.client_id = "client"."id" and a.status in ('present', 'late'))`,
    creditsActiveTotal: sql<number>`(select coalesce(sum(cp.credits_total), 0) from client_package cp where cp.workspace_id = "client"."workspace_id" and cp.client_id = "client"."id" and cp.status = 'active' and (cp.expires_on is null or cp.expires_on >= ${today}))`,
    creditsUsedUpTotal: sql<number>`(select coalesce(sum(cp.credits_total), 0) from client_package cp where cp.workspace_id = "client"."workspace_id" and cp.client_id = "client"."id" and cp.status = 'exhausted' and (cp.expires_on is null or cp.expires_on >= ${today}))`,
    nextExpiryOn: sql<
      string | null
    >`(select min(cp.expires_on) from client_package cp where cp.workspace_id = "client"."workspace_id" and cp.client_id = "client"."id" and cp.status = 'active' and cp.expires_on >= ${today})`,
    nextSessionAt: sql<
      number | null
    >`(select min(l.starts_at) from attendance a join lesson l on l.id = a.lesson_id where a.workspace_id = "client"."workspace_id" and a.client_id = "client"."id" and l.ends_at > ${Date.now()} and l.status != 'cancelled' and a.status not in ('excused', 'late_cancel'))`,
  };
}

function toListItem(
  r: {
    c: ClientRow;
    groupIds: string | null;
    credits: number;
    activePackages: number;
    lastSeenAt: number | null;
    creditsActiveTotal: number;
    creditsUsedUpTotal: number;
    nextExpiryOn: string | null;
    nextSessionAt: number | null;
  },
  balance: number,
  tz: string,
): ClientListItemDto {
  return {
    id: r.c.id,
    firstName: r.c.firstName,
    lastName: r.c.lastName,
    email: r.c.email,
    phone: r.c.phone,
    status: r.c.status,
    level: r.c.level,
    isJunior: r.c.isJunior,
    photoKey: r.c.photoKey,
    tags: r.c.tags,
    groupIds: r.groupIds ? r.groupIds.split(",") : [],
    creditsRemaining: Number(r.credits),
    activePackages: Number(r.activePackages),
    balanceMinor: balance,
    lastSeenOn: r.lastSeenAt ? localDate(Number(r.lastSeenAt), tz) : null,
    creditsTotal: Number(
      Number(r.activePackages) > 0 ? r.creditsActiveTotal : r.creditsUsedUpTotal,
    ),
    nextExpiryOn: r.nextExpiryOn,
    nextSessionAt: r.nextSessionAt === null ? null : Number(r.nextSessionAt),
    joinedOn: r.c.joinedOn,
  };
}

function toClientDto(base: ClientListItemDto, c: ClientRow): ClientDto {
  return {
    ...base,
    birthDate: c.birthDate,
    guardianName: c.guardianName,
    guardianPhone: c.guardianPhone,
    guardianEmail: c.guardianEmail,
    emergencyName: c.emergencyName,
    emergencyPhone: c.emergencyPhone,
    duprId: c.duprId,
    duprRating: c.duprRating,
    dominantHand: c.dominantHand,
    paddle: c.paddle,
    goals: c.goals,
    medicalNotes: c.medicalNotes,
    notes: c.notes,
    source: c.source,
    joinedOn: c.joinedOn,
    createdAt: c.createdAt,
  };
}

async function loadClient(ctx: Ctx, id: string): Promise<ClientDto> {
  const today = todayIn(ctx.settings.timezone);
  const [row] = await ctx.db
    .select(listColumns(today))
    .from(client)
    .where(and(eq(client.id, id), eq(client.workspaceId, ctx.workspaceId)));
  if (!row) throw notFound("Client");
  const balances = await balancesFor(ctx, [id]);
  return toClientDto(toListItem(row, balances.get(id) ?? 0, ctx.settings.timezone), row.c);
}

async function setGroups(ctx: Ctx, clientId: string, groupIds: string[]) {
  const { db, workspaceId } = ctx;
  const wanted = unique(groupIds);
  if (wanted.length) {
    const found = await db
      .select({ id: trainingGroup.id })
      .from(trainingGroup)
      .where(and(eq(trainingGroup.workspaceId, workspaceId), inArray(trainingGroup.id, wanted)));
    if (found.length !== wanted.length) throw badRequest("Some groups were not found.");
  }
  const current = await db
    .select()
    .from(groupMember)
    .where(and(eq(groupMember.workspaceId, workspaceId), eq(groupMember.clientId, clientId)));
  const today = todayIn(ctx.settings.timezone);
  const activeIds = new Set(current.filter((m) => !m.leftOn).map((m) => m.groupId));
  const toAdd = wanted.filter((g) => !activeIds.has(g));
  const toRemove = [...activeIds].filter((g) => !wanted.includes(g));
  const statements: unknown[] = [];
  for (const groupId of toAdd) {
    const existing = current.find((m) => m.groupId === groupId);
    statements.push(
      existing
        ? db
            .update(groupMember)
            .set({ leftOn: null, joinedOn: today })
            .where(eq(groupMember.id, existing.id))
        : db
            .insert(groupMember)
            .values({ id: uuidv7(), workspaceId, groupId, clientId, joinedOn: today }),
    );
  }
  for (const groupId of toRemove) {
    statements.push(
      db
        .update(groupMember)
        .set({ leftOn: today })
        .where(and(eq(groupMember.clientId, clientId), eq(groupMember.groupId, groupId))),
    );
  }
  await runBatch(ctx, statements);
  for (const groupId of toAdd) await syncMemberIntoGroupLessons(ctx, groupId, [clientId]);
  for (const groupId of toRemove) await unbookMemberFromGroupLessons(ctx, groupId, clientId);
}

export const clientRoutes = new Hono<AppBindings>()
  .get("/clients", async (c) => {
    const ctx = ctxOf(c);
    const q = c.req.query("q")?.trim();
    const status = c.req.query("status");
    const groupId = c.req.query("groupId");
    const today = todayIn(ctx.settings.timezone);
    const term = q ? `%${q.replace(/[%_]/g, "")}%` : null;
    const rows = await ctx.db
      .select(listColumns(today))
      .from(client)
      .where(
        and(
          eq(client.workspaceId, ctx.workspaceId),
          status && (CLIENT_STATUSES as readonly string[]).includes(status)
            ? eq(client.status, status as ClientRow["status"])
            : status === "all"
              ? undefined
              : sql`${client.status} != 'archived'`,
          term
            ? or(
                like(client.firstName, term),
                like(client.lastName, term),
                like(sql`${client.firstName} || ' ' || ${client.lastName}`, term),
                like(client.email, term),
                like(client.phone, term),
              )
            : undefined,
          groupId
            ? sql`exists (select 1 from group_member gm where gm.client_id = "client"."id" and gm.group_id = ${groupId} and gm.left_on is null)`
            : undefined,
        ),
      )
      .orderBy(asc(client.firstName), asc(client.lastName));
    const balances = await balancesFor(ctx);
    return c.json(rows.map((r) => toListItem(r, balances.get(r.c.id) ?? 0, ctx.settings.timezone)));
  })

  .post("/clients", v("json", clientSchema), async (c) => {
    const ctx = ctxOf(c);
    const { groupIds, id: requestedId, ...input } = c.req.valid("json");
    const id = requestedId ?? uuidv7();
    await runBatch(ctx, [
      ctx.db.insert(client).values({
        ...input,
        id,
        workspaceId: ctx.workspaceId,
        joinedOn: input.joinedOn ?? todayIn(ctx.settings.timezone),
        tags: input.tags ?? [],
      }),
      auditEntry(ctx, "create", "client", id),
    ]);
    if (groupIds?.length) await setGroups(ctx, id, groupIds);
    return c.json(await loadClient(ctx, id), 201);
  })

  .get("/clients/:id", async (c) => {
    const ctx = ctxOf(c);
    const id = c.req.param("id");
    const dto = await loadClient(ctx, id);
    const { db, workspaceId, settings } = ctx;
    const [groups, packages, upcomingRows, recent, registrations] = await Promise.all([
      db
        .select({ id: trainingGroup.id, name: trainingGroup.name, color: trainingGroup.color })
        .from(groupMember)
        .innerJoin(trainingGroup, eq(trainingGroup.id, groupMember.groupId))
        .where(
          and(
            eq(groupMember.clientId, id),
            isNull(groupMember.leftOn),
            eq(groupMember.workspaceId, workspaceId),
          ),
        ),
      packagesForClients(ctx, [id], { includeInactive: true }),
      lessonSummaries(
        ctx,
        and(
          gte(lesson.startsAt, Date.now() - 2 * 3_600_000),
          sql`${lesson.status} != 'cancelled'`,
          sql`exists (select 1 from attendance a where a.lesson_id = "lesson"."id" and a.client_id = ${id} and a.status not in ('excused', 'late_cancel'))`,
        ),
      ),
      db
        .select({
          lessonId: lesson.id,
          startsAt: lesson.startsAt,
          title: lesson.title,
          kind: lesson.kind,
          status: attendance.status,
          packageName: clientPackage.name,
          groupName: trainingGroup.name,
          eventName: event.name,
        })
        .from(attendance)
        .innerJoin(lesson, eq(lesson.id, attendance.lessonId))
        .leftJoin(clientPackage, eq(clientPackage.id, attendance.consumedPackageId))
        .leftJoin(trainingGroup, eq(trainingGroup.id, lesson.groupId))
        .leftJoin(event, eq(event.id, lesson.eventId))
        .where(
          and(
            eq(attendance.workspaceId, workspaceId),
            eq(attendance.clientId, id),
            sql`${lesson.startsAt} < ${Date.now()}`,
          ),
        )
        .orderBy(desc(lesson.startsAt))
        .limit(20),
      db
        .select({
          id: eventRegistration.id,
          eventId: event.id,
          eventName: event.name,
          status: eventRegistration.status,
          startsOn: event.startsOn,
        })
        .from(eventRegistration)
        .innerJoin(event, eq(event.id, eventRegistration.eventId))
        .where(
          and(eq(eventRegistration.workspaceId, workspaceId), eq(eventRegistration.clientId, id)),
        )
        .orderBy(desc(event.startsOn)),
    ]);
    const today = todayIn(settings.timezone);
    const body: ClientDetailDto = {
      client: dto,
      groups,
      packages: packages
        .map((p) => ({
          id: p.id,
          name: p.name,
          creditsTotal: p.creditsTotal,
          remaining: p.remaining,
          expiresOn: p.expiresOn,
          status: (p.status === "active" && p.expiresOn && p.expiresOn < today
            ? "expired"
            : p.status) as ClientDetailDto["packages"][number]["status"],
          lessonKinds: p.lessonKinds,
        }))
        .reverse(),
      upcoming: upcomingRows.slice(0, 8).map((u) => u.summary),
      recentAttendance: recent.map((r) => ({
        lessonId: r.lessonId,
        startsAt: r.startsAt,
        title: r.title || r.groupName || r.eventName || "Session",
        kind: r.kind,
        status: r.status,
        packageName: r.packageName,
      })),
      registrations,
    };
    return c.json(body);
  })

  .patch("/clients/:id", v("json", clientUpdateSchema), async (c) => {
    const ctx = ctxOf(c);
    const id = c.req.param("id");
    const { groupIds, ...input } = c.req.valid("json");
    const res = await ctx.db
      .update(client)
      .set(input)
      .where(and(eq(client.id, id), eq(client.workspaceId, ctx.workspaceId)))
      .returning({ id: client.id });
    if (!res[0]) throw notFound("Client");
    if (groupIds) await setGroups(ctx, id, groupIds);
    return c.json(await loadClient(ctx, id));
  })

  .delete("/clients/:id", async (c) => {
    const ctx = ctxOf(c);
    const id = c.req.param("id");
    const existing = await ctx.db.query.client.findFirst({
      where: and(eq(client.id, id), eq(client.workspaceId, ctx.workspaceId)),
    });
    if (!existing) throw notFound("Client");
    // Deleting cascades to money and attendance; refuse so every credit and payment stays explainable.
    const ws = ctx.workspaceId;
    const [paid, charged, sold, attended] = await Promise.all([
      ctx.db
        .select({ id: payment.id })
        .from(payment)
        .where(and(eq(payment.workspaceId, ws), eq(payment.clientId, id)))
        .limit(1),
      ctx.db
        .select({ id: charge.id })
        .from(charge)
        .where(and(eq(charge.workspaceId, ws), eq(charge.clientId, id)))
        .limit(1),
      ctx.db
        .select({ id: clientPackage.id })
        .from(clientPackage)
        .where(and(eq(clientPackage.workspaceId, ws), eq(clientPackage.clientId, id)))
        .limit(1),
      ctx.db
        .select({ id: attendance.id })
        .from(attendance)
        .where(
          and(
            eq(attendance.workspaceId, ws),
            eq(attendance.clientId, id),
            inArray(attendance.status, ["present", "late", "no_show", "late_cancel"]),
          ),
        )
        .limit(1),
    ]);
    if (paid.length || charged.length || sold.length || attended.length) {
      throw conflict(
        `${existing.firstName} has payments, packages, or attendance on record, so they can't be deleted. Archive them instead to keep that history.`,
      );
    }
    if (existing.photoKey) await ctx.env.FILES.delete(existing.photoKey);
    await runBatch(ctx, [
      ctx.db.delete(client).where(and(eq(client.id, id), eq(client.workspaceId, ctx.workspaceId))),
      auditEntry(ctx, "delete", "client", id, {
        name: `${existing.firstName} ${existing.lastName}`.trim(),
      }),
    ]);
    return c.body(null, 204);
  })

  .get("/clients/:id/ledger", async (c) => {
    const ctx = ctxOf(c);
    const id = c.req.param("id");
    await loadClient(ctx, id);
    const rows = await ctx.db
      .select({
        l: creditLedger,
        packageName: clientPackage.name,
        creditsTotal: clientPackage.creditsTotal,
        lessonTitle: lesson.title,
        lessonStartsAt: lesson.startsAt,
        groupName: trainingGroup.name,
      })
      .from(creditLedger)
      .innerJoin(clientPackage, eq(clientPackage.id, creditLedger.clientPackageId))
      .leftJoin(lesson, eq(lesson.id, creditLedger.lessonId))
      .leftJoin(trainingGroup, eq(trainingGroup.id, lesson.groupId))
      .where(and(eq(creditLedger.workspaceId, ctx.workspaceId), eq(creditLedger.clientId, id)))
      .orderBy(asc(creditLedger.createdAt));
    const running = new Map<string, number>();
    const lines: LedgerLineDto[] = rows.map((r) => {
      const before = running.get(r.l.clientPackageId) ?? r.creditsTotal;
      const after = before + r.l.delta;
      running.set(r.l.clientPackageId, after);
      return {
        id: r.l.id,
        clientPackageId: r.l.clientPackageId,
        packageName: r.packageName,
        delta: r.l.delta,
        reason: r.l.reason,
        note: r.l.note,
        lessonId: r.l.lessonId,
        lessonTitle: r.lessonTitle || r.groupName,
        lessonStartsAt: r.lessonStartsAt,
        createdAt: r.l.createdAt,
        runningRemaining: after,
      };
    });
    return c.json(lines.reverse());
  });
