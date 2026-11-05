// Domain vocabulary shared by the Worker API and the React app.

export const LESSON_KINDS = ["private", "semi_private", "group", "clinic", "event"] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export const LESSON_KIND_LABELS: Record<LessonKind, string> = {
  private: "Private",
  semi_private: "Semi-private",
  group: "Group",
  clinic: "Clinic",
  event: "Event session",
};

export const LESSON_STATUSES = ["scheduled", "completed", "cancelled"] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export const ATTENDANCE_STATUSES = [
  "booked",
  "present",
  "late",
  "absent",
  "late_cancel",
  "no_show",
  "excused",
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  booked: "Booked",
  present: "Checked in",
  late: "Late",
  absent: "Absent",
  late_cancel: "Late cancel",
  no_show: "No-show",
  excused: "Excused",
};

export const CLIENT_STATUSES = ["lead", "active", "paused", "archived"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const RATE_KINDS = [
  "private",
  "semi_private",
  "group",
  "clinic",
  "court_fee",
  "other",
] as const;
export type RateKind = (typeof RATE_KINDS)[number];

export const RATE_UNITS = ["session", "hour"] as const;
export type RateUnit = (typeof RATE_UNITS)[number];

export const CLIENT_PACKAGE_STATUSES = ["active", "exhausted", "expired", "void"] as const;
export type ClientPackageStatus = (typeof CLIENT_PACKAGE_STATUSES)[number];

export const LEDGER_REASONS = ["use", "reversal", "adjustment", "expiry", "void"] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];

export const EVENT_KINDS = ["camp", "academy", "clinic", "tournament", "social", "other"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  camp: "Camp",
  academy: "Academy",
  clinic: "Clinic",
  tournament: "Tournament",
  social: "Social",
  other: "Other",
};

export const EVENT_STATUSES = ["draft", "open", "closed", "completed", "cancelled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const REGISTRATION_STATUSES = ["registered", "waitlisted", "cancelled"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const CHARGE_KINDS = ["package", "session", "event", "adjustment", "other"] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];

export const GOAL_STATUSES = ["active", "achieved", "dropped"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const RATING_SOURCES = ["dupr", "coach", "self"] as const;
export type RatingSource = (typeof RATING_SOURCES)[number];

export const DEFAULT_PAYMENT_METHODS = ["Cash", "Bank transfer", "Card", "E-wallet"];

/** Attendance statuses that always consume a credit (or create a pay-per-session charge). */
export const CONSUMING_STATUSES: readonly AttendanceStatus[] = ["present", "late"];

/** Statuses that consume only when the workspace policy says so. */
export const POLICY_STATUSES: readonly AttendanceStatus[] = ["no_show", "late_cancel"];

export const SCORE_MIN = 1;
export const SCORE_MAX = 5;

// --- Academy ----------------------------------------------------------------

/** A student's coach: the primary coach leads; assistants help. */
export const CLIENT_COACH_ROLES = ["primary", "assistant"] as const;
export type ClientCoachRole = (typeof CLIENT_COACH_ROLES)[number];

export const CLIENT_COACH_ROLE_LABELS: Record<ClientCoachRole, string> = {
  primary: "Primary coach",
  assistant: "Assistant coach",
};

/** How a signed-in person is linked to a student: the student themself, or a parent/guardian. */
export const FAMILY_RELATIONS = ["self", "guardian"] as const;
export type FamilyRelation = (typeof FAMILY_RELATIONS)[number];

export const FAMILY_RELATION_LABELS: Record<FamilyRelation, string> = {
  self: "Student",
  guardian: "Parent or guardian",
};

export const INVITE_KINDS = ["staff", "family"] as const;
export type InviteKind = (typeof INVITE_KINDS)[number];

/** Where an invite link stands. Revoked wins over used, used over expired. */
export const INVITE_STATUSES = ["valid", "expired", "used", "revoked"] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export const ENROLLMENT_STATUSES = [
  "requested",
  "approved",
  "waitlisted",
  "declined",
  "cancelled",
] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const PAYMENT_SUBMISSION_STATUSES = ["pending", "confirmed", "rejected"] as const;
export type PaymentSubmissionStatus = (typeof PAYMENT_SUBMISSION_STATUSES)[number];

export const CONSENT_KINDS = ["waiver", "privacy", "parental", "media", "other"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export const CONSENT_APPLIES_TO = ["all", "minors"] as const;
export type ConsentAppliesTo = (typeof CONSENT_APPLIES_TO)[number];

/** Who signed a consent for a student. */
export const CONSENT_SIGNER_RELATIONS = ["self", "guardian", "staff"] as const;
export type ConsentSignerRelation = (typeof CONSENT_SIGNER_RELATIONS)[number];

export const ANNOUNCEMENT_AUDIENCES = ["all", "program", "event"] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

/** `staff` = coaches only (the default); `shared` = also the student and their parents. */
export const NOTE_VISIBILITIES = ["staff", "shared"] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

/** Handoff notes are written when a student's primary coach changes; always coaches only. */
export const NOTE_KINDS = ["comment", "handoff"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** Package validity: a number of days from purchase, or to the end of the start month. */
export const VALIDITY_MODES = ["days", "month_end"] as const;
export type ValidityMode = (typeof VALIDITY_MODES)[number];

/** A person allowed to pick a junior up after training, as a family enters them when enrolling. */
export interface EnrollmentPickup {
  name: string;
  relationship: string | null;
  phone: string | null;
}

/** What a family answered on an enrollment request (stored as JSON). */
export interface EnrollmentAnswers {
  /** Self-rating on the DUPR-style scale (saved to rating history with source "self"). */
  selfRating?: number | null;
  /** The tier asked for a self-rating and the family chose "Not sure". */
  selfRatingUnsure?: boolean;
  shirtSize?: string | null;
  /** Preferred weekdays, 0 = Sunday ... 6 = Saturday. */
  preferredDays?: number[];
  notes?: string | null;
  /** The submitter's phone (the student's own for adults, the parent's for a child). */
  phone?: string | null;
  /** An address to reach a passkey-only account (its own email is a placeholder). */
  email?: string | null;
  medicalNotes?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  /** Juniors: who may pick them up (saved to authorized_pickup when the request is sent). */
  pickups?: EnrollmentPickup[];
  /** Tiers enrolled by start date ("date" mode): the day the family wants to start. */
  startDate?: string | null;
  /** Who the family said is training. */
  who?: "self" | "child" | "new_child";
  /** How the submitter is linked to the student. */
  relation?: FamilyRelation;
  /** The request created the student (a `lead` client) rather than picking a linked one. */
  newStudent?: boolean;
  /** Renewals: the month-end package this one follows. */
  renewalOf?: string | null;
  [key: string]: unknown;
}

/** Public academy slugs: lowercase letters, digits, single hyphens; 3–40 characters. */
export const ACADEMY_SLUG_RE = /^[a-z0-9](-?[a-z0-9])+$/;

export function isAcademySlug(slug: string): boolean {
  // Legacy `ws-<id>` slugs come from automatic provisioning and are never public.
  return (
    slug.length >= 3 && slug.length <= 40 && ACADEMY_SLUG_RE.test(slug) && !slug.startsWith("ws-")
  );
}

/**
 * A public address suggested from an academy's name ("The Pickle Spot Academy" becomes
 * "the-pickle-spot-academy"), or "" when the name has too few usable characters.
 */
export function slugify(name: string): string {
  let slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  if (slug.startsWith("ws-")) slug = `academy-${slug.slice(3)}`.slice(0, 40).replace(/-+$/, "");
  return isAcademySlug(slug) ? slug : "";
}

/** Social links an academy can show, in display order. */
export const ACADEMY_SOCIALS = ["facebook", "instagram", "tiktok", "youtube", "website"] as const;
export type AcademySocial = (typeof ACADEMY_SOCIALS)[number];

export const ACADEMY_SOCIAL_LABELS: Record<AcademySocial, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  website: "Website",
};

/** A full http(s) link, the only kind of URL an academy profile stores. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Passkey-only family accounts get an address here, so no email can ever link to them. */
export const PLACEHOLDER_EMAIL_DOMAIN = "passkey.coachman.invalid";

export const isPlaceholderEmail = (email: string | null | undefined) =>
  Boolean(email?.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`));

/** A passkey-only account's address: `u-<uuid>@passkey.coachman.invalid` (never deliverable). */
export const placeholderEmail = (uuid: string) => `u-${uuid}@${PLACEHOLDER_EMAIL_DOMAIN}`;
