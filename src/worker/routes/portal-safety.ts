import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import type { PortalStudentDto } from "../../shared/api-types";
import { isMinor } from "../../shared/family";
import { familySafetyRights, forbiddenSafetyField } from "../../shared/safety";
import { familySafetySchema, pickupInputSchema } from "../../shared/schemas";
import { todayIn } from "../../shared/time";
import { client } from "../db/schema";
import { ApiError, notFound } from "../lib/errors";
import { linkFor, type PortalLink } from "../lib/portal-scope";
import { enforce } from "../lib/rate-limit";
import { readFormWithImage } from "../lib/uploads";
import { parseWith, v } from "../lib/validate";
import { academyTimezone, portalStudentDto } from "../services/portal";
import { deletePickup, savePickup, updateFamilySafety } from "../services/safety";
import type { AppBindings } from "../types";

/** Profile edits: plenty for a family, few enough to stop a script. */
const EDIT_RULE = { windowMs: 60 * 60_000, max: 120 };

type ClientRow = typeof client.$inferSelect;

/** Drains an unread body (Miniflare's local proxy can fail a request answered unread). */
const drain = (c: Context<AppBindings>) =>
  c.req.method === "GET"
    ? Promise.resolve()
    : c.req.raw.arrayBuffer().then(
        () => undefined,
        () => undefined,
      );

/** The caller's link to the student in the path, the student, and what the caller may change. */
async function editable(c: Context<AppBindings>) {
  const link = linkFor(c.var.portal, c.req.param("clientId") ?? "");
  const row = link
    ? await c.var.db.query.client.findFirst({
        where: and(eq(client.id, link.clientId), eq(client.workspaceId, link.workspaceId)),
      })
    : undefined;
  if (!link || !row) {
    await drain(c);
    throw notFound("Student");
  }
  const today = todayIn(await academyTimezone(c.var.db, link.workspaceId));
  const rights = familySafetyRights({
    relation: link.relation,
    birthDate: row.birthDate,
    isJunior: row.isJunior,
    today,
  });
  return { link, row, today, rights };
}

/** Why a family member can't change something (403 `read_only`), in their words. */
async function refuse(
  c: Context<AppBindings>,
  link: PortalLink,
  row: ClientRow,
  today: string,
  what: "details" | "pickups" | "guardian",
): Promise<never> {
  await drain(c);
  const minor = isMinor({ birthDate: row.birthDate, isJunior: row.isJunior, today });
  const message =
    link.relation === "self" && minor
      ? "Your parent or guardian keeps your health details and pickup people up to date. Ask them, or the academy, to change something."
      : link.relation === "guardian" && !minor
        ? `${row.firstName} keeps their own details up to date now. Ask them, or the academy.`
        : what === "pickups"
          ? "Pickup people are for students under 18."
          : what === "guardian"
            ? "A parent or guardian's contact is theirs to change."
            : "You can't change these details here. Ask the academy.";
  throw new ApiError(403, "read_only", message);
}

async function answer(c: Context<AppBindings>, link: PortalLink, status: 200 | 201 = 200) {
  const row = await c.var.db.query.client.findFirst({
    where: and(eq(client.id, link.clientId), eq(client.workspaceId, link.workspaceId)),
  });
  if (!row) throw notFound("Student");
  const today = todayIn(await academyTimezone(c.var.db, link.workspaceId));
  return c.json<PortalStudentDto>(
    await portalStudentDto(c.var.db, link, row, today, c.var.user.id),
    status,
  );
}

const actorOf = (c: Context<AppBindings>, link: PortalLink) => ({
  userId: c.var.user.id,
  by: link.relation,
});

/**
 * The family keeping a student's Profile up to date (mounted on /api/portal, behind
 * `requirePortal`): health and emergency details, the parent's own contact, the shirt size, and
 * authorized pickup people with photos. What each person may change comes from
 * `familySafetyRights` (a parent of a minor: everything; an adult student: their own health,
 * emergency contact, and shirt size; a teen's own login: nothing). Unlinked students answer 404;
 * every change is audited by field name, never the medical text. Each answer is the student's
 * fresh Profile (`PortalStudentDto`).
 */
export const portalSafetyRoutes = new Hono<AppBindings>()
  .patch("/students/:clientId/safety", v("json", familySafetySchema), async (c) => {
    const input = c.req.valid("json");
    const { link, row, today, rights } = await editable(c);
    const denied = forbiddenSafetyField(rights, input);
    if (denied) {
      await refuse(
        c,
        link,
        row,
        today,
        denied === "guardianPhone" || denied === "guardianEmail" ? "guardian" : "details",
      );
    }
    await enforce(c, `safety-edit:user:${c.var.user.id}`, EDIT_RULE);
    await updateFamilySafety(c.var.db, row, input, actorOf(c, link));
    return answer(c, link);
  })

  .post("/students/:clientId/pickups", async (c) => {
    const { link, row, today, rights } = await editable(c);
    if (!rights.pickups) await refuse(c, link, row, today, "pickups");
    const { data, image } = await readFormWithImage(c, { fileField: "photo", noun: "photo" });
    await enforce(c, `safety-edit:user:${c.var.user.id}`, EDIT_RULE);
    const input = parseWith(pickupInputSchema, data);
    await savePickup(c.var.db, c.env, {
      workspaceId: link.workspaceId,
      clientId: link.clientId,
      data: input,
      image,
      actor: actorOf(c, link),
    });
    return answer(c, link, 201);
  })

  .patch("/students/:clientId/pickups/:pickupId", async (c) => {
    const { link, row, today, rights } = await editable(c);
    if (!rights.pickups) await refuse(c, link, row, today, "pickups");
    const { data, image } = await readFormWithImage(c, { fileField: "photo", noun: "photo" });
    await enforce(c, `safety-edit:user:${c.var.user.id}`, EDIT_RULE);
    const input = parseWith(pickupInputSchema, data);
    await savePickup(c.var.db, c.env, {
      workspaceId: link.workspaceId,
      clientId: link.clientId,
      pickupId: c.req.param("pickupId"),
      data: input,
      image,
      actor: actorOf(c, link),
    });
    return answer(c, link);
  })

  .delete("/students/:clientId/pickups/:pickupId", async (c) => {
    const { link, row, today, rights } = await editable(c);
    if (!rights.pickups) await refuse(c, link, row, today, "pickups");
    await enforce(c, `safety-edit:user:${c.var.user.id}`, EDIT_RULE);
    await deletePickup(c.var.db, c.env, {
      workspaceId: link.workspaceId,
      clientId: link.clientId,
      pickupId: c.req.param("pickupId"),
      actor: actorOf(c, link),
    });
    return answer(c, link);
  });
