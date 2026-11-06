// The public academy page's DTOs (/api/public/academies/:slug). Like the portal's mappers, each
// copies the fields anyone may see one by one from a row, never by spreading a row or a staff DTO:
// a column added later stays private until someone adds it here on purpose.

import type {
  PublicAcademyDto,
  PublicAcademyPhotoDto,
  PublicCoachDto,
  PublicCoachRefDto,
  PublicConsentDocumentDto,
  PublicConsentRefDto,
  PublicPackageDto,
  PublicProgramDto,
  PublicVenueDto,
  PublicWeeklySessionDto,
} from "../../shared/api-types";
import { ACADEMY_SOCIALS, type AcademySocial, isAcademySlug } from "../../shared/domain";
import type {
  academyPhoto,
  academyProfile,
  consentDocument,
  lessonSeries,
  packageTemplate,
  teamPerson,
  trainingGroup,
  venue,
  workspaceSettings,
} from "../db/schema";

type ProfileRow = typeof academyProfile.$inferSelect;
type PhotoRow = typeof academyPhoto.$inferSelect;
type SettingsRow = typeof workspaceSettings.$inferSelect;
type GroupRow = typeof trainingGroup.$inferSelect;
type PackageRow = typeof packageTemplate.$inferSelect;
type SeriesRow = typeof lessonSeries.$inferSelect;
type VenueRow = typeof venue.$inferSelect;
type ConsentRow = typeof consentDocument.$inferSelect;
type TeamPersonRow = typeof teamPerson.$inferSelect;

/** Whether an academy's page is public: listed, under a real public address (not `ws-…`). */
export function isListed(
  org: { slug: string },
  profile: Pick<ProfileRow, "listed"> | null | undefined,
): boolean {
  return Boolean(profile?.listed) && isAcademySlug(org.slug);
}

/**
 * A person on the team page as the public sees them: a staff member's coach profile (only
 * coaches who chose to appear), or a display-only person the academy shows (only public ones).
 */
export interface PublicCoachFacts {
  /** The coach profile's id, or the display-only person's id. */
  profileId: string;
  name: string;
  title: string | null;
  bio: string | null;
  /** The square photo; display-only people have none. */
  photoKey: string | null;
  portraitKey: string | null;
  certifications: string[];
  highlights: string[];
  specialties: string[];
  languages: string[];
  yearsCoaching: number | null;
  duprRating: number | null;
}

export function toPublicCoach(c: PublicCoachFacts): PublicCoachDto {
  return {
    id: c.profileId,
    name: c.name,
    title: c.title,
    bio: c.bio,
    photoKey: c.photoKey,
    portraitKey: c.portraitKey,
    certifications: [...c.certifications],
    highlights: [...c.highlights],
    specialties: [...c.specialties],
    languages: [...c.languages],
    yearsCoaching: c.yearsCoaching,
    duprRating: c.duprRating,
  };
}

/** A display-only person's public facts: never who added them, their order, or the switch. */
export function teamPersonFacts(p: TeamPersonRow): PublicCoachFacts {
  return {
    profileId: p.id,
    name: p.name,
    title: p.title,
    bio: p.bio,
    photoKey: null,
    portraitKey: p.portraitKey,
    certifications: p.certifications ?? [],
    highlights: p.highlights ?? [],
    specialties: p.specialties ?? [],
    languages: p.languages ?? [],
    yearsCoaching: p.yearsCoaching,
    duprRating: p.duprRating,
  };
}

/** `lead`: the program's lead coach (false for anyone else, and outside programs). */
export function toPublicCoachRef(
  c: Pick<PublicCoachFacts, "profileId" | "name" | "title" | "photoKey">,
  lead: boolean,
): PublicCoachRefDto {
  return { id: c.profileId, name: c.name, title: c.title, photoKey: c.photoKey, lead };
}

/**
 * A program's coaches as the public page names them: the lead first, then the assistants, only
 * those with public profiles (`coaches`, by user id). Only the program's own lead is marked
 * `lead`, so a hidden lead never makes an assistant look like the lead.
 */
export function toProgramCoachRefs(
  program: Pick<GroupRow, "coachUserId" | "assistantCoachIds">,
  coaches: ReadonlyMap<string, PublicCoachFacts>,
): PublicCoachRefDto[] {
  const out: PublicCoachRefDto[] = [];
  const seen = new Set<string>();
  for (const userId of [program.coachUserId, ...(program.assistantCoachIds ?? [])]) {
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    const c = coaches.get(userId);
    if (c) out.push(toPublicCoachRef(c, userId === program.coachUserId));
  }
  return out;
}

export function toPublicVenue(v: Pick<VenueRow, "name" | "address">): PublicVenueDto {
  return { name: v.name, address: v.address };
}

export function toPublicWeeklySession(
  s: Pick<SeriesRow, "weekdays" | "startTime" | "durationMinutes">,
  venueRow: Pick<VenueRow, "name" | "address"> | null | undefined,
): PublicWeeklySessionDto {
  return {
    weekdays: [...s.weekdays].sort((a, b) => a - b),
    startTime: s.startTime,
    durationMinutes: s.durationMinutes,
    venue: venueRow ? toPublicVenue(venueRow) : null,
  };
}

/** A published program: its public description, never the internal one. */
export function toPublicProgram(
  g: GroupRow,
  parts: {
    schedule: PublicWeeklySessionDto[];
    venue: Pick<VenueRow, "name" | "address"> | null | undefined;
    coaches: PublicCoachRefDto[];
    nextSessionAt: number | null;
  },
): PublicProgramDto {
  return {
    id: g.id,
    name: g.name,
    description: g.publicDescription,
    level: g.level,
    ageMin: g.ageMin,
    ageMax: g.ageMax,
    capacity: g.capacity,
    scheduleNote: g.scheduleNote,
    schedule: parts.schedule,
    venue: parts.venue ? toPublicVenue(parts.venue) : null,
    coaches: parts.coaches,
    nextSessionAt: parts.nextSessionAt,
  };
}

/** A published tier: its price per head and the rates-sheet fields; never its staff description. */
export function toPublicPackage(p: PackageRow, coach: PublicCoachRefDto | null): PublicPackageDto {
  return {
    id: p.id,
    programId: p.programId,
    name: p.name,
    priceMinor: p.priceMinor,
    credits: p.credits,
    sessionsLabel: p.sessionsLabel,
    validityMode: p.validityMode,
    validityDays: p.validityMode === "month_end" ? null : p.validityDays,
    inclusions: [...(p.inclusions ?? [])],
    audience: p.audience,
    commitmentNote: p.commitmentNote,
    includesUniform: p.includesUniform,
    asksSelfRating: p.asksSelfRating,
    highlight: p.highlight,
    coach,
  };
}

export function toPublicConsentRef(d: ConsentRow): PublicConsentRefDto {
  return { id: d.id, kind: d.kind, title: d.title, version: d.version, appliesTo: d.appliesTo };
}

export function toPublicConsentDocument(d: ConsentRow): PublicConsentDocumentDto {
  return { ...toPublicConsentRef(d), body: d.body };
}

/** A website photo: its file and caption, never its place in the order or when it was added. */
export function toPublicAcademyPhoto(
  p: Pick<PhotoRow, "id" | "key" | "caption">,
): PublicAcademyPhotoDto {
  return { id: p.id, key: p.key, caption: p.caption };
}

/** The academy's public profile: no payment details, no internal settings. */
export function toPublicAcademy(
  org: { name: string; slug: string },
  profile: ProfileRow | null | undefined,
  settings:
    | Pick<SettingsRow, "currency" | "locale" | "timezone" | "weekStartsOn">
    | null
    | undefined,
  parts: {
    programs: PublicProgramDto[];
    packages: PublicPackageDto[];
    coaches: PublicCoachDto[];
    /** The website photos, in the academy's order. */
    photos: PublicAcademyPhotoDto[];
    consents: PublicConsentRefDto[];
    today: string;
  },
): PublicAcademyDto {
  const socials: Partial<Record<AcademySocial, string>> = {};
  for (const key of ACADEMY_SOCIALS) {
    const value = profile?.socials?.[key];
    if (value) socials[key] = value;
  }
  return {
    slug: org.slug,
    name: org.name,
    tagline: profile?.tagline ?? null,
    about: profile?.about ?? null,
    logoKey: profile?.logoKey ?? null,
    coverKey: profile?.coverKey ?? null,
    contactPhone: profile?.contactPhone ?? null,
    contactEmail: profile?.contactEmail ?? null,
    address: profile?.address ?? null,
    mapUrl: profile?.mapUrl ?? null,
    socials,
    policies: profile?.policies ?? null,
    enrollmentOpen: profile?.enrollmentOpen ?? false,
    currency: settings?.currency ?? "USD",
    locale: settings?.locale ?? "en-US",
    timezone: settings?.timezone ?? "UTC",
    weekStartsOn: settings?.weekStartsOn ?? 1,
    programs: parts.programs,
    packages: parts.packages,
    coaches: parts.coaches,
    photos: parts.photos,
    consents: parts.consents,
    today: parts.today,
    updatedAt: profile?.updatedAt ?? 0,
  };
}
