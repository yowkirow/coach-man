import { and, eq } from "drizzle-orm";
import type { TeamPageDto, TeamPageEntryDto, TeamPersonDto } from "../../shared/api-types";
import { isCoachingRole } from "../../shared/roles";
import type { Db } from "../db/client";
import { academyProfile, organization, teamPerson } from "../db/schema";
import { notFound } from "../lib/errors";
import { isListed } from "../lib/public-dto";
import { type TeamPageItem, teamPageOrder } from "../lib/team-page";
import type { Ctx } from "../types";
import { coachName, type StaffRow, staffRows } from "./coaches";

export type TeamPersonRow = typeof teamPerson.$inferSelect;

export function toTeamPersonDto(p: TeamPersonRow): TeamPersonDto {
  return {
    id: p.id,
    name: p.name,
    title: p.title,
    bio: p.bio,
    portraitKey: p.portraitKey,
    portraitFraming: p.portraitFraming ?? null,
    certifications: p.certifications ?? [],
    highlights: p.highlights ?? [],
    duprRating: p.duprRating,
    specialties: p.specialties ?? [],
    languages: p.languages ?? [],
    yearsCoaching: p.yearsCoaching,
    isPublic: p.isPublic,
    sortOrder: p.sortOrder,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** The academy's display-only people, in no particular order. */
export function teamPeople(db: Db, workspaceId: string) {
  return db.select().from(teamPerson).where(eq(teamPerson.workspaceId, workspaceId));
}

/** One of the academy's display-only people, or 404. */
export async function findTeamPerson(
  ctx: Pick<Ctx, "db" | "workspaceId">,
  id: string,
): Promise<TeamPersonRow> {
  const row = await ctx.db.query.teamPerson.findFirst({
    where: and(eq(teamPerson.id, id), eq(teamPerson.workspaceId, ctx.workspaceId)),
  });
  if (!row) throw notFound("Person");
  return row;
}

/** An entry of the page with what ordering needs (`id`: the user id for staff). */
export interface PlacedEntry extends TeamPageItem {
  entry: TeamPageEntryDto;
  /** Staff only: whether their coach profile row exists yet. */
  hasProfile: boolean;
}

function staffEntry(s: StaffRow): PlacedEntry {
  const name = coachName(s);
  return {
    kind: "staff",
    id: s.userId,
    name,
    sortOrder: s.sortOrder,
    hasProfile: s.profileId !== null,
    entry: {
      kind: "staff",
      userId: s.userId,
      name,
      title: s.title,
      role: s.role,
      photoKey: s.photoKey,
      portraitKey: s.portraitKey,
      portraitFraming: s.portraitFraming,
      isPublic: s.isPublic,
      sortOrder: s.sortOrder,
    },
  };
}

function personEntry(p: TeamPersonRow): PlacedEntry {
  return {
    kind: "listed",
    id: p.id,
    name: p.name,
    sortOrder: p.sortOrder,
    hasProfile: true,
    entry: {
      kind: "listed",
      id: p.id,
      name: p.name,
      title: p.title,
      photoKey: null,
      portraitKey: p.portraitKey,
      portraitFraming: p.portraitFraming ?? null,
      isPublic: p.isPublic,
      sortOrder: p.sortOrder,
    },
  };
}

/**
 * Everyone on the page (current staff who coach, and display-only people), in the page's order.
 * The front desk is never on it, whatever their profile says.
 */
export async function placedEntries(ctx: Pick<Ctx, "db" | "workspaceId">): Promise<PlacedEntry[]> {
  const [staff, people] = await Promise.all([
    staffRows(ctx.db, ctx.workspaceId),
    teamPeople(ctx.db, ctx.workspaceId),
  ]);
  return teamPageOrder(
    staff.filter((s) => isCoachingRole(s.role)).map(staffEntry),
    people.map(personEntry),
  );
}

/** GET /team-page: the page's people in order, and where the page lives. */
export async function loadTeamPage(ctx: Pick<Ctx, "db" | "workspaceId">): Promise<TeamPageDto> {
  const [placed, org, profile] = await Promise.all([
    placedEntries(ctx),
    ctx.db.query.organization.findFirst({
      where: eq(organization.id, ctx.workspaceId),
      columns: { slug: true },
    }),
    ctx.db.query.academyProfile.findFirst({
      where: eq(academyProfile.workspaceId, ctx.workspaceId),
      columns: { listed: true },
    }),
  ]);
  return {
    entries: placed.map((p) => p.entry),
    listed: org ? isListed(org, profile) : false,
    slug: org?.slug ?? "",
  };
}
