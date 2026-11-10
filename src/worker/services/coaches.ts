import { and, asc, eq, isNull } from "drizzle-orm";
import type {
  ClientCoachDto,
  ClientCoachesDto,
  CoachProfileDto,
  CoachRefDto,
  CoachSummaryDto,
} from "../../shared/api-types";
import type { PhotoFraming } from "../../shared/framing";
import { uuidv7 } from "../../shared/ids";
import { isCoachingRole, normalizeRole, type StaffRole } from "../../shared/roles";
import type { Db } from "../db/client";
import { clientCoach, coachProfile, member, user } from "../db/schema";
import { badRequest } from "../lib/errors";
import { inList, unique } from "../lib/sql";
import { teamPageEnd } from "../lib/workspace";
import type { Ctx } from "../types";

/** A current staff member with their coach profile (or its defaults when they have none yet). */
export interface StaffRow {
  userId: string;
  role: StaffRole;
  accountName: string;
  email: string;
  image: string | null;
  joinedAt: number;
  /** Null until the member's coach profile row exists (members from before profiles). */
  profileId: string | null;
  displayName: string | null;
  title: string | null;
  bio: string | null;
  photoKey: string | null;
  portraitKey: string | null;
  portraitFraming: PhotoFraming | null;
  certifications: string[];
  highlights: string[];
  duprRating: number | null;
  specialties: string[];
  languages: string[];
  yearsCoaching: number | null;
  isPublic: boolean;
  sortOrder: number;
}

export const coachName = (r: { displayName: string | null; accountName: string }) =>
  r.displayName?.trim() || r.accountName;

/** Everyone on the academy's team, in the academy's coach order, then by name. */
export async function staffRows(db: Db, workspaceId: string): Promise<StaffRow[]> {
  const rows = await db
    .select({ m: member, u: user, p: coachProfile })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(
      coachProfile,
      and(eq(coachProfile.userId, member.userId), eq(coachProfile.workspaceId, workspaceId)),
    )
    .where(eq(member.organizationId, workspaceId))
    .orderBy(asc(member.createdAt));
  const seen = new Set<string>();
  const out: StaffRow[] = [];
  for (const { m, u, p } of rows) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    out.push({
      userId: u.id,
      role: normalizeRole(m.role),
      accountName: u.name,
      email: u.email,
      image: u.image ?? null,
      joinedAt: m.createdAt.getTime(),
      profileId: p?.id ?? null,
      displayName: p?.displayName ?? null,
      title: p?.title ?? null,
      bio: p?.bio ?? null,
      photoKey: p?.photoKey ?? null,
      portraitKey: p?.portraitKey ?? null,
      portraitFraming: p?.portraitFraming ?? null,
      certifications: p?.certifications ?? [],
      highlights: p?.highlights ?? [],
      duprRating: p?.duprRating ?? null,
      specialties: p?.specialties ?? [],
      languages: p?.languages ?? [],
      yearsCoaching: p?.yearsCoaching ?? null,
      isPublic: p?.isPublic ?? true,
      sortOrder: p?.sortOrder ?? 0,
    });
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder || coachName(a).localeCompare(coachName(b)));
}

export function toCoachSummary(r: StaffRow): CoachSummaryDto {
  return {
    userId: r.userId,
    name: coachName(r),
    title: r.title,
    photoKey: r.photoKey,
    role: r.role,
  };
}

export function toCoachProfile(r: StaffRow): CoachProfileDto {
  return {
    ...toCoachSummary(r),
    accountName: r.accountName,
    email: r.email,
    displayName: r.displayName,
    bio: r.bio,
    certifications: r.certifications,
    duprRating: r.duprRating,
    specialties: r.specialties,
    languages: r.languages,
    yearsCoaching: r.yearsCoaching,
    portraitKey: r.portraitKey,
    portraitFraming: r.portraitFraming,
    highlights: r.highlights,
    isPublic: r.isPublic,
    sortOrder: r.sortOrder,
  };
}

/** Everyone on the team with their stored role. */
function members(db: Db, workspaceId: string) {
  return db
    .select({ userId: member.userId, role: member.role })
    .from(member)
    .where(eq(member.organizationId, workspaceId));
}

/** Ids of everyone currently on the team. */
export async function staffIds(db: Db, workspaceId: string): Promise<Set<string>> {
  return new Set((await members(db, workspaceId)).map((m) => m.userId));
}

/** Ids of the people on the team who coach (the front desk doesn't). */
export async function coachIds(db: Db, workspaceId: string): Promise<Set<string>> {
  const rows = await members(db, workspaceId);
  return new Set(rows.filter((m) => isCoachingRole(m.role)).map((m) => m.userId));
}

/**
 * Checks that every id given is someone on the team who coaches (a session can't be led by a
 * stranger, or by the front desk). `field` names the form field for the error.
 */
export async function assertStaff(
  ctx: Pick<Ctx, "db" | "workspaceId">,
  ids: readonly (string | null | undefined)[],
  field = "coachUserId",
): Promise<void> {
  const wanted = unique(ids.filter((id): id is string => Boolean(id)));
  if (!wanted.length) return;
  const team = await members(ctx.db, ctx.workspaceId);
  const roles = new Map(team.map((m) => [m.userId, m.role]));
  const refuse = (why: string) =>
    badRequest("Pick coaches from your team.", { fields: { [field]: why } });
  if (wanted.some((id) => !roles.has(id))) throw refuse("That person isn't on your team.");
  if (wanted.some((id) => !isCoachingRole(roles.get(id)))) {
    throw refuse("Front desk staff don't coach.");
  }
}

/** Lead and assistants tidied: no duplicates, the lead never also an assistant. */
export function cleanCoaches(lead: string | null, assistants: readonly string[]) {
  return {
    coachUserId: lead || null,
    assistantCoachIds: unique(assistants.filter((id) => id && id !== lead)),
  };
}

/**
 * The coaches of a program or event from a create or edit (empty when the request doesn't touch
 * them): tidied, and anyone new must be on the team. Someone who left may stay on a record until
 * it's edited.
 */
export async function programCoaches(
  ctx: Pick<Ctx, "db" | "workspaceId">,
  input: { coachUserId?: string | null; assistantCoachIds?: string[] },
  current?: { coachUserId: string | null; assistantCoachIds: string[] },
): Promise<{ coachUserId?: string | null; assistantCoachIds?: string[] }> {
  if (input.coachUserId === undefined && input.assistantCoachIds === undefined) return {};
  const coaches = cleanCoaches(
    input.coachUserId === undefined ? (current?.coachUserId ?? null) : input.coachUserId,
    input.assistantCoachIds ?? current?.assistantCoachIds ?? [],
  );
  const before = new Set([current?.coachUserId, ...(current?.assistantCoachIds ?? [])]);
  await assertStaff(
    ctx,
    [coaches.coachUserId, ...coaches.assistantCoachIds].filter((id) => !before.has(id)),
  );
  return coaches;
}

/**
 * Names and photos for anyone who has coached here, current team or not (a coach who left still
 * wrote their notes). Unknown ids are left out.
 */
export async function coachRefs(
  db: Db,
  workspaceId: string,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, CoachRefDto>> {
  const wanted = unique(ids.filter((id): id is string => Boolean(id)));
  const out = new Map<string, CoachRefDto>();
  if (!wanted.length) return out;
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      displayName: coachProfile.displayName,
      photoKey: coachProfile.photoKey,
    })
    .from(user)
    .leftJoin(
      coachProfile,
      and(eq(coachProfile.userId, user.id), eq(coachProfile.workspaceId, workspaceId)),
    )
    .where(inList(user.id, wanted));
  for (const r of rows) {
    out.set(r.id, {
      userId: r.id,
      name: coachName({ displayName: r.displayName, accountName: r.name }),
      photoKey: r.photoKey ?? null,
    });
  }
  return out;
}

/**
 * Creates the member's coach profile if it's missing (members from before profiles existed), at
 * the end of the team page.
 */
export async function ensureCoachProfile(db: Db, workspaceId: string, userId: string) {
  const sortOrder = await teamPageEnd(db, workspaceId);
  await db
    .insert(coachProfile)
    .values({ id: uuidv7(), workspaceId, userId, sortOrder })
    .onConflictDoNothing();
}

/** A student's current coaches and who coached them before (newest first). */
export async function loadClientCoaches(
  ctx: Pick<Ctx, "db" | "workspaceId">,
  clientId: string,
): Promise<ClientCoachesDto> {
  const rows = await ctx.db
    .select()
    .from(clientCoach)
    .where(and(eq(clientCoach.workspaceId, ctx.workspaceId), eq(clientCoach.clientId, clientId)))
    .limit(200);
  const refs = await coachRefs(
    ctx.db,
    ctx.workspaceId,
    rows.flatMap((r) => [r.coachUserId, r.assignedBy]),
  );
  const ref = (id: string): CoachRefDto =>
    refs.get(id) ?? { userId: id, name: "Former coach", photoKey: null };
  const toDto = (r: typeof clientCoach.$inferSelect): ClientCoachDto => ({
    id: r.id,
    coach: ref(r.coachUserId),
    role: r.role,
    startedOn: r.startedOn,
    endedOn: r.endedOn,
    assignedBy: r.assignedBy ? ref(r.assignedBy) : null,
  });
  const newest = (a: typeof clientCoach.$inferSelect, b: typeof clientCoach.$inferSelect) =>
    (b.endedOn ?? "9999").localeCompare(a.endedOn ?? "9999") ||
    b.startedOn.localeCompare(a.startedOn) ||
    b.createdAt - a.createdAt;
  const current = rows.filter((r) => r.endedOn === null);
  const primary = current.filter((r) => r.role === "primary").sort(newest)[0];
  return {
    primary: primary ? toDto(primary) : null,
    assistants: current
      .filter((r) => r.role === "assistant")
      .sort((a, b) => a.startedOn.localeCompare(b.startedOn))
      .map(toDto),
    history: rows
      .filter((r) => r.endedOn !== null)
      .sort(newest)
      .map(toDto),
  };
}

/** Current coach rows of a student (for planning a change). */
export function currentClientCoaches(ctx: Pick<Ctx, "db" | "workspaceId">, clientId: string) {
  return ctx.db
    .select({ id: clientCoach.id, coachUserId: clientCoach.coachUserId, role: clientCoach.role })
    .from(clientCoach)
    .where(
      and(
        eq(clientCoach.workspaceId, ctx.workspaceId),
        eq(clientCoach.clientId, clientId),
        isNull(clientCoach.endedOn),
      ),
    );
}
