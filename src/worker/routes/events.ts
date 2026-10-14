import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { EventDetailDto, EventDto } from "../../shared/api-types";
import { uuidv7 } from "../../shared/ids";
import {
  eventSchema,
  registrationCreateSchema,
  registrationUpdateSchema,
} from "../../shared/schemas";
import { compareDates, todayIn } from "../../shared/time";
import { attendance, charge, client, event, eventRegistration, lesson } from "../db/schema";
import { auditEntry } from "../lib/audit";
import { badRequest, conflict, notFound } from "../lib/errors";
import { v } from "../lib/validate";
import { ctxOf } from "../middleware";
import { runBatch } from "../services/credits";
import { bookClientsIntoLessons, lessonSummaries } from "../services/lessons";
import { rebuildAllocations } from "../services/money";
import type { AppBindings, Ctx } from "../types";

const paidSql = sql<number>`coalesce((select sum(pa.amount_minor) from payment_allocation pa where pa.charge_id = "event_registration"."charge_id"), 0)`;

function eventColumns() {
  return {
    e: event,
    registered: sql<number>`(select count(*) from event_registration r where r.event_id = "event"."id" and r.status = 'registered')`,
    waitlisted: sql<number>`(select count(*) from event_registration r where r.event_id = "event"."id" and r.status = 'waitlisted')`,
    billed: sql<number>`(select coalesce(sum(c.amount_minor), 0) from event_registration r join charge c on c.id = r.charge_id where r.event_id = "event"."id" and r.status = 'registered' and c.voided_at is null)`,
    paid: sql<number>`(select coalesce(sum(pa.amount_minor), 0) from event_registration r join payment_allocation pa on pa.charge_id = r.charge_id where r.event_id = "event"."id" and r.status = 'registered')`,
  };
}

function toEventDto(r: {
  e: typeof event.$inferSelect;
  registered: number;
  waitlisted: number;
  billed: number;
  paid: number;
}): EventDto {
  const e = r.e;
  return {
    id: e.id,
    kind: e.kind,
    name: e.name,
    description: e.description,
    startsOn: e.startsOn,
    endsOn: e.endsOn,
    venueId: e.venueId,
    capacity: e.capacity,
    priceMinor: e.priceMinor,
    earlyBirdPriceMinor: e.earlyBirdPriceMinor,
    earlyBirdUntil: e.earlyBirdUntil,
    level: e.level,
    ageMin: e.ageMin,
    ageMax: e.ageMax,
    status: e.status,
    registeredCount: Number(r.registered),
    waitlistCount: Number(r.waitlisted),
    paidMinor: Number(r.paid),
    dueMinor: Math.max(0, Number(r.billed) - Number(r.paid)),
  };
}

async function loadEvent(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select(eventColumns())
    .from(event)
    .where(and(eq(event.id, id), eq(event.workspaceId, ctx.workspaceId)));
  if (!row) throw notFound("Event");
  return row;
}

function priceFor(e: typeof event.$inferSelect, onDate: string): number {
  if (
    e.earlyBirdPriceMinor !== null &&
    e.earlyBirdUntil &&
    compareDates(onDate, e.earlyBirdUntil) <= 0
  ) {
    return e.earlyBirdPriceMinor;
  }
  return e.priceMinor;
}

async function upcomingEventLessonIds(ctx: Ctx, eventId: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: lesson.id })
    .from(lesson)
    .where(
      and(
        eq(lesson.workspaceId, ctx.workspaceId),
        eq(lesson.eventId, eventId),
        eq(lesson.status, "scheduled"),
        gte(lesson.startsAt, Date.now() - 3_600_000),
      ),
    );
  return rows.map((r) => r.id);
}

/** Marks a registration registered: creates its charge and books the player into upcoming event sessions. */
async function activateRegistration(
  ctx: Ctx,
  e: typeof event.$inferSelect,
  regId: string,
  clientId: string,
  price: number,
) {
  const today = todayIn(ctx.settings.timezone);
  const chargeId = price > 0 ? uuidv7() : null;
  await runBatch(ctx, [
    ...(chargeId
      ? [
          ctx.db.insert(charge).values({
            id: chargeId,
            workspaceId: ctx.workspaceId,
            clientId,
            kind: "event",
            description: e.name,
            amountMinor: price,
            registrationId: regId,
            occurredOn: today,
            createdBy: ctx.userId,
          }),
        ]
      : []),
    ctx.db
      .update(eventRegistration)
      .set({ status: "registered", chargeId, priceMinor: price })
      .where(eq(eventRegistration.id, regId)),
  ]);
  await bookClientsIntoLessons(ctx, await upcomingEventLessonIds(ctx, e.id), [clientId]);
  if (chargeId) await rebuildAllocations(ctx, clientId);
}

async function promoteWaitlist(ctx: Ctx, e: typeof event.$inferSelect) {
  if (!e.capacity) return;
  const [counts] = await ctx.db
    .select({
      registered: sql<number>`count(*) filter (where ${eventRegistration.status} = 'registered')`,
    })
    .from(eventRegistration)
    .where(eq(eventRegistration.eventId, e.id));
  let open = e.capacity - Number(counts?.registered ?? 0);
  if (open <= 0) return;
  const waiting = await ctx.db
    .select()
    .from(eventRegistration)
    .where(and(eq(eventRegistration.eventId, e.id), eq(eventRegistration.status, "waitlisted")))
    .orderBy(asc(eventRegistration.registeredAt));
  for (const w of waiting) {
    if (open <= 0) break;
    await activateRegistration(ctx, e, w.id, w.clientId, w.priceMinor);
    open--;
  }
}

export const eventRoutes = new Hono<AppBindings>()
  .get("/events", async (c) => {
    const ctx = ctxOf(c);
    const scope = c.req.query("scope");
    const today = todayIn(ctx.settings.timezone);
    const rows = await ctx.db
      .select(eventColumns())
      .from(event)
      .where(
        and(
          eq(event.workspaceId, ctx.workspaceId),
          scope === "past"
            ? sql`${event.endsOn} < ${today}`
            : scope === "all"
              ? undefined
              : sql`${event.endsOn} >= ${today}`,
        ),
      )
      .orderBy(scope === "past" ? desc(event.startsOn) : asc(event.startsOn));
    return c.json(rows.map(toEventDto));
  })

  .post("/events", v("json", eventSchema), async (c) => {
    const ctx = ctxOf(c);
    const input = c.req.valid("json");
    if (compareDates(input.endsOn, input.startsOn) < 0)
      throw badRequest("The event ends before it starts.");
    const id = input.id ?? uuidv7();
    await runBatch(ctx, [
      ctx.db
        .insert(event)
        .values({ ...input, id, workspaceId: ctx.workspaceId, status: input.status ?? "open" }),
      auditEntry(ctx, "create", "event", id),
    ]);
    return c.json(toEventDto(await loadEvent(ctx, id)), 201);
  })

  .get("/events/:id", async (c) => {
    const ctx = ctxOf(c);
    const row = await loadEvent(ctx, c.req.param("id"));
    const [registrations, sessions] = await Promise.all([
      ctx.db
        .select({
          id: eventRegistration.id,
          clientId: client.id,
          firstName: client.firstName,
          lastName: client.lastName,
          status: eventRegistration.status,
          priceMinor: eventRegistration.priceMinor,
          paidMinor: paidSql,
          registeredAt: eventRegistration.registeredAt,
          isJunior: client.isJunior,
          note: eventRegistration.note,
        })
        .from(eventRegistration)
        .innerJoin(client, eq(client.id, eventRegistration.clientId))
        .where(
          and(
            eq(eventRegistration.eventId, row.e.id),
            eq(eventRegistration.workspaceId, ctx.workspaceId),
          ),
        )
        .orderBy(asc(eventRegistration.registeredAt)),
      lessonSummaries(ctx, eq(lesson.eventId, row.e.id)),
    ]);
    const body: EventDetailDto = {
      event: toEventDto(row),
      registrations: registrations.map((r) => ({ ...r, paidMinor: Number(r.paidMinor) })),
      sessions: sessions.map((s) => s.summary),
    };
    return c.json(body);
  })

  .patch("/events/:id", v("json", eventSchema.partial()), async (c) => {
    const ctx = ctxOf(c);
    const { id: _ignored, ...input } = c.req.valid("json");
    const before = await loadEvent(ctx, c.req.param("id"));
    const startsOn = input.startsOn ?? before.e.startsOn;
    const endsOn = input.endsOn ?? before.e.endsOn;
    if (compareDates(endsOn, startsOn) < 0) throw badRequest("The event ends before it starts.");
    await ctx.db.update(event).set(input).where(eq(event.id, before.e.id));
    const after = await loadEvent(ctx, before.e.id);
    if (
      (after.e.capacity ?? Infinity) > (before.e.capacity ?? Infinity) ||
      (!after.e.capacity && before.e.capacity)
    ) {
      await promoteWaitlist(ctx, after.e);
    }
    return c.json(toEventDto(await loadEvent(ctx, before.e.id)));
  })

  .post("/events/:id/registrations", v("json", registrationCreateSchema), async (c) => {
    const ctx = ctxOf(c);
    const row = await loadEvent(ctx, c.req.param("id"));
    const e = row.e;
    if (e.status === "cancelled" || e.status === "completed")
      throw conflict("This event is closed.");
    const input = c.req.valid("json");
    const who = await ctx.db.query.client.findFirst({
      where: and(eq(client.id, input.clientId), eq(client.workspaceId, ctx.workspaceId)),
    });
    if (!who) throw notFound("Client");
    const existing = await ctx.db.query.eventRegistration.findFirst({
      where: and(
        eq(eventRegistration.eventId, e.id),
        eq(eventRegistration.clientId, input.clientId),
      ),
    });
    if (existing && existing.status !== "cancelled")
      throw conflict(`${who.firstName} is already on the list.`);
    const today = todayIn(ctx.settings.timezone);
    const price = input.priceMinor ?? priceFor(e, today);
    const full = e.capacity !== null && Number(row.registered) >= e.capacity;
    const regId = existing?.id ?? uuidv7();
    if (existing) {
      await ctx.db
        .update(eventRegistration)
        .set({
          status: "waitlisted",
          priceMinor: price,
          registeredAt: Date.now(),
          note: input.note ?? existing.note,
        })
        .where(eq(eventRegistration.id, existing.id));
    } else {
      await ctx.db.insert(eventRegistration).values({
        id: regId,
        workspaceId: ctx.workspaceId,
        eventId: e.id,
        clientId: input.clientId,
        status: "waitlisted",
        priceMinor: price,
        registeredAt: Date.now(),
        note: input.note ?? null,
      });
    }
    if (!full) await activateRegistration(ctx, e, regId, input.clientId, price);
    await auditEntry(ctx, "register", "event", e.id, {
      clientId: input.clientId,
      waitlisted: full,
    });
    return c.json(
      { status: full ? "waitlisted" : "registered", event: toEventDto(await loadEvent(ctx, e.id)) },
      201,
    );
  })

  .patch("/registrations/:id", v("json", registrationUpdateSchema), async (c) => {
    const ctx = ctxOf(c);
    const reg = await ctx.db.query.eventRegistration.findFirst({
      where: and(
        eq(eventRegistration.id, c.req.param("id")),
        eq(eventRegistration.workspaceId, ctx.workspaceId),
      ),
    });
    if (!reg) throw notFound("Registration");
    const { status } = c.req.valid("json");
    const row = await loadEvent(ctx, reg.eventId);
    if (status === reg.status) return c.json(toEventDto(row));

    if (status === "registered") {
      await activateRegistration(ctx, row.e, reg.id, reg.clientId, reg.priceMinor);
    } else {
      const statements: unknown[] = [
        ctx.db
          .update(eventRegistration)
          .set({ status, chargeId: null })
          .where(eq(eventRegistration.id, reg.id)),
      ];
      if (reg.chargeId) {
        statements.push(
          ctx.db
            .update(charge)
            .set({ voidedAt: Date.now(), voidReason: `Registration ${status}` })
            .where(eq(charge.id, reg.chargeId)),
        );
      }
      if (reg.status === "registered") {
        statements.push(
          ctx.db
            .delete(attendance)
            .where(
              and(
                eq(attendance.clientId, reg.clientId),
                eq(attendance.status, "booked"),
                sql`"attendance"."lesson_id" in (select l.id from lesson l where l.event_id = ${reg.eventId} and l.starts_at >= ${Date.now()})`,
              ),
            ),
        );
      }
      await runBatch(ctx, statements);
      if (reg.chargeId) await rebuildAllocations(ctx, reg.clientId);
      if (reg.status === "registered") await promoteWaitlist(ctx, row.e);
    }
    await auditEntry(ctx, "registration", "event", reg.eventId, { registrationId: reg.id, status });
    return c.json(toEventDto(await loadEvent(ctx, reg.eventId)));
  });
