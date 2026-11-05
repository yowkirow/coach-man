// The public academy page's DTOs (/api/public/academies/:slug). Like the portal's mappers, each
// copies the fields anyone may see one by one from a row, never by spreading a row or a staff DTO:
// a column added later stays private until someone adds it here on purpose.

import type {
  PublicAcademyDto,
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
  academyProfile,
  consentDocument,
  lessonSeries,
  packageTemplate,
  trainingGroup,
  venue,
  workspaceSettings,
} from "../db/schema";

type ProfileRow = typeof academyProfile.$inferSelect;
type SettingsRow = typeof workspaceSettings.$inferSelect;
type GroupRow = typeof trainingGroup.$inferSelect;
type PackageRow = typeof packageTemplate.$inferSelect;
type SeriesRow = typeof lessonSeries.$inferSelect;
type VenueRow = typeof venue.$inferSelect;
type ConsentRow = typeof consentDocument.$inferSelect;

/** Whether an academy's page is public: listed, under a real public address (not `ws-…`). */
export function isListed(
  org: { slug: string },
  profile: Pick<ProfileRow, "listed"> | null | undefined,
): boolean {
  return Boolean(profile?.listed) && isAcademySlug(org.slug);
}

/** A coach's public profile, from their team row (only coaches who chose to appear). */
export interface PublicCoachFacts {
  profileId: string;
  name: string;
  title: string | null;
  bio: string | null;
  photoKey: string | null;
  certifications: string[];
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
    certifications: [...c.certifications],
    specialties: [...c.specialties],
    languages: [...c.languages],
    yearsCoaching: c.yearsCoaching,
    duprRating: c.duprRating,
  };
}

export function toPublicCoachRef(
  c: Pick<PublicCoachFacts, "profileId" | "name" | "title" | "photoKey">,
): PublicCoachRefDto {
  return { id: c.profileId, name: c.name, title: c.title, photoKey: c.photoKey };
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
    consents: parts.consents,
    today: parts.today,
    updatedAt: profile?.updatedAt ?? 0,
  };
}
