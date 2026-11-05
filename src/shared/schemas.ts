import { z } from "zod";
import { CONSENT_TEMPLATE_KINDS } from "./consent-templates";
import {
  ACADEMY_SOCIALS,
  ATTENDANCE_STATUSES,
  CLIENT_STATUSES,
  CONSENT_APPLIES_TO,
  CONSENT_KINDS,
  ENROLLMENT_STATUSES,
  EVENT_KINDS,
  EVENT_STATUSES,
  FAMILY_RELATIONS,
  GOAL_STATUSES,
  isAcademySlug,
  isHttpUrl,
  isPlaceholderEmail,
  LESSON_KINDS,
  NOTE_KINDS,
  NOTE_VISIBILITIES,
  RATE_KINDS,
  RATE_UNITS,
  RATING_SOURCES,
  REGISTRATION_STATUSES,
  SCORE_MAX,
  SCORE_MIN,
  VALIDITY_MODES,
} from "./domain";
import { ALL_UNIFORM_SIZES, isSelfRating, MAX_PICKUPS } from "./enrollment";
import { UUID_RE } from "./ids";
import { STAFF_ROLES } from "./roles";
import { DATE_RE, isValidTimeZone, TIME_RE } from "./time";
import { MONTH_RE } from "./validity";

const id = z.string().regex(UUID_RE, "Invalid id");
/** A Better Auth user id (a staff member's); membership is checked by the server. */
const userId = z.string().trim().min(1).max(64);
const coachIds = z.array(userId).max(10);
const date = z.string().regex(DATE_RE, "Use YYYY-MM-DD");
const time = z.string().regex(TIME_RE, "Use HH:MM");
const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();
const optionalEmail = z
  .string()
  .trim()
  .max(120)
  .transform((v) => (v === "" ? null : v.toLowerCase()))
  .pipe(z.email("That email doesn't look complete.").nullable())
  .nullable()
  .optional();
const optionalLink = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => v === "" || isHttpUrl(v), "Use a full link that starts with https://")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();
const money = z.number().int().min(0).max(1_000_000_000);
const signedMoney = z.number().int().min(-1_000_000_000).max(1_000_000_000);

// --- Workspace -------------------------------------------------------------

export const workspaceUpdateSchema = z.object({
  name: trimmed(80).min(1).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  timezone: z.string().refine(isValidTimeZone, "Unknown timezone").optional(),
  locale: z.string().min(2).max(20).optional(),
  sport: z.string().min(2).max(40).optional(),
  paymentMethods: z.array(trimmed(40).min(1)).min(1).max(20).optional(),
  noShowUsesCredit: z.boolean().optional(),
  lateCancelUsesCredit: z.boolean().optional(),
  lateCancelHours: z.number().int().min(0).max(168).optional(),
  defaultSessionMinutes: z.number().int().min(15).max(480).optional(),
  weekStartsOn: z.number().int().min(0).max(6).optional(),
});
export type WorkspaceUpdateInput = z.infer<typeof workspaceUpdateSchema>;

export const onboardingSchema = z.object({
  name: trimmed(80).min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezone: z.string().refine(isValidTimeZone, "Unknown timezone"),
  locale: z.string().min(2).max(20),
  withSampleData: z.boolean().default(false),
});
export type OnboardingInput = z.infer<typeof onboardingSchema>;

export const venueSchema = z.object({
  id: id.optional(),
  name: trimmed(80).min(1),
  address: optionalText(200),
  courtCount: z.number().int().min(1).max(64).nullable().optional(),
  notes: optionalText(500),
});
export type VenueInput = z.infer<typeof venueSchema>;

// --- Academy profile, team, and coaches ---------------------------------------

/** PATCH /academy: the academy's name, public address (slug), and public profile. */
export const academyUpdateSchema = z.object({
  name: trimmed(80).min(1, "Give your academy a name.").optional(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .refine(
      isAcademySlug,
      "Use 3 to 40 lowercase letters and numbers, with single hyphens between words.",
    )
    .optional(),
  tagline: optionalText(120),
  about: optionalText(2000),
  contactPhone: optionalText(40),
  contactEmail: optionalEmail,
  address: optionalText(200),
  mapUrl: optionalLink(500),
  /** Missing or empty links are removed. */
  socials: z
    .partialRecord(
      z.enum(ACADEMY_SOCIALS),
      trimmed(300).refine(
        (v) => v === "" || isHttpUrl(v),
        "Use a full link that starts with https://",
      ),
    )
    .optional(),
  paymentInstructions: optionalText(2000),
  policies: optionalText(4000),
  enrollmentOpen: z.boolean().optional(),
  listed: z.boolean().optional(),
});
export type AcademyUpdateInput = z.infer<typeof academyUpdateSchema>;

/** POST /team/invites: owners are made from inside the team, so invites are for admins and coaches. */
export const staffInviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("That email doesn't look complete."))
    // Passkey-only family accounts carry a placeholder address; it must never match a staff invite.
    .refine((e) => !isPlaceholderEmail(e), "Use the person's Google email address."),
  role: z.enum(["admin", "coach"]),
});
export type StaffInviteInput = z.infer<typeof staffInviteSchema>;

/** POST /clients/:id/family/invites: a parent's link, or the student's own login. */
export const familyInviteSchema = z.object({ relation: z.enum(FAMILY_RELATIONS) });

/** GET /api/portal/students/:id/schedule: an optional window of local dates. */
export const portalRangeQuerySchema = z.object({
  from: date.optional(),
  to: date.optional(),
});

export const memberRoleSchema = z.object({ role: z.enum(STAFF_ROLES) });

export const transferOwnershipSchema = z.object({ userId });

export const coachProfileUpdateSchema = z.object({
  /** Empty = use the account's name. */
  displayName: optionalText(80),
  title: optionalText(80),
  bio: optionalText(2000),
  certifications: z.array(trimmed(80).min(1)).max(20).optional(),
  duprRating: z.number().min(1).max(8).nullable().optional(),
  specialties: z.array(trimmed(60).min(1)).max(20).optional(),
  languages: z.array(trimmed(40).min(1)).max(10).optional(),
  yearsCoaching: z.number().int().min(0).max(80).nullable().optional(),
  isPublic: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
export type CoachProfileUpdateInput = z.infer<typeof coachProfileUpdateSchema>;

/** PUT /clients/:id/coaches: the student's current coaches; history is kept by the server. */
export const clientCoachesSchema = z.object({
  primaryCoachUserId: userId.nullable(),
  assistantCoachIds: coachIds,
});
export type ClientCoachesInput = z.infer<typeof clientCoachesSchema>;

// --- Clients -----------------------------------------------------------------

export const clientSchema = z.object({
  id: id.optional(),
  firstName: trimmed(60).min(1, "First name is required"),
  lastName: trimmed(60).default(""),
  email: z
    .string()
    .trim()
    .max(120)
    .transform((v) => (v === "" ? null : v.toLowerCase()))
    .pipe(z.email().nullable())
    .nullable()
    .optional(),
  phone: optionalText(40),
  birthDate: date.nullable().optional(),
  isJunior: z.boolean().optional(),
  guardianName: optionalText(80),
  guardianPhone: optionalText(40),
  guardianEmail: optionalText(120),
  emergencyName: optionalText(80),
  emergencyPhone: optionalText(40),
  level: optionalText(40),
  duprId: optionalText(40),
  duprRating: z.number().min(1).max(8).nullable().optional(),
  dominantHand: z.enum(["right", "left", "ambidextrous"]).nullable().optional(),
  paddle: optionalText(80),
  goals: optionalText(1000),
  medicalNotes: optionalText(1000),
  notes: optionalText(2000),
  status: z.enum(CLIENT_STATUSES).optional(),
  source: optionalText(80),
  tags: z.array(trimmed(30).min(1)).max(20).optional(),
  joinedOn: date.nullable().optional(),
  groupIds: z.array(id).max(50).optional(),
  /** New clients only: their primary coach. Omitted = whoever adds them; null = no coach yet. */
  primaryCoachUserId: userId.nullable().optional(),
});
export type ClientInput = z.infer<typeof clientSchema>;
// Zod 4's .partial() still applies inner .default()s, so a PATCH without lastName would reset it
// to "". Update schemas re-declare defaulted fields as plain optionals. Coaches change through
// PUT /clients/:id/coaches, which keeps their history.
export const clientUpdateSchema = clientSchema
  .extend({ lastName: trimmed(60).optional() })
  .partial()
  .omit({ id: true, primaryCoachUserId: true });
export type ClientUpdateInput = z.infer<typeof clientUpdateSchema>;

export const clientImportSchema = z.object({
  rows: z
    .array(clientSchema.omit({ id: true, groupIds: true, primaryCoachUserId: true }))
    .min(1)
    .max(2000),
  skipDuplicates: z.boolean().default(true),
});
export type ClientImportInput = z.infer<typeof clientImportSchema>;

// --- Groups ----------------------------------------------------------------

export const groupSchema = z.object({
  id: id.optional(),
  name: trimmed(80).min(1),
  level: optionalText(40),
  description: optionalText(500),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  capacity: z.number().int().min(1).max(500).nullable().optional(),
  defaultRateId: id.nullable().optional(),
  defaultVenueId: id.nullable().optional(),
  /** The program's lead coach; new sessions of the group start with it. */
  coachUserId: userId.nullable().optional(),
  assistantCoachIds: coachIds.optional(),
  // A program on the academy's public page.
  isPublic: z.boolean().optional(),
  publicDescription: optionalText(1000),
  /** Overrides the weekly sessions' days and times on the public page, e.g. "Every Tue & Thu, 7–10pm". */
  scheduleNote: optionalText(80),
  ageMin: z.number().int().min(3).max(100).nullable().optional(),
  ageMax: z.number().int().min(3).max(100).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type GroupInput = z.infer<typeof groupSchema>;

export const groupMembersSchema = z.object({ clientIds: z.array(id).min(1).max(200) });

/** POST /groups/reorder and /packages/reorder: ids in their new order (public page order). */
export const reorderSchema = z.object({ ids: z.array(id).min(1).max(200) });

// --- Rates and packages ----------------------------------------------------

export const rateSchema = z.object({
  id: id.optional(),
  name: trimmed(80).min(1),
  kind: z.enum(RATE_KINDS),
  durationMinutes: z.number().int().min(15).max(600),
  priceMinor: money,
  unit: z.enum(RATE_UNITS),
  active: z.boolean().optional(),
});
export type RateInput = z.infer<typeof rateSchema>;

export const packageTemplateSchema = z.object({
  id: id.optional(),
  name: trimmed(80).min(1),
  credits: z.number().int().min(1).max(500),
  lessonKinds: z.array(z.enum(LESSON_KINDS)).max(LESSON_KINDS.length).default([]),
  priceMinor: money,
  validityDays: z.number().int().min(1).max(3650).nullable().optional(),
  description: optionalText(500),
  active: z.boolean().optional(),
  // Tier fields, as on a rates sheet.
  programId: id.nullable().optional(),
  /** A coach-specific tier. */
  coachUserId: userId.nullable().optional(),
  /** e.g. "4–6 sessions"; `credits` is the upper bound. */
  sessionsLabel: optionalText(40),
  /** `month_end`: valid to the end of the start month (validityDays is ignored). */
  validityMode: z.enum(VALIDITY_MODES).optional(),
  inclusions: z.array(trimmed(120).min(1)).max(20).optional(),
  /** "Who it's for". */
  audience: optionalText(300),
  commitmentNote: optionalText(200),
  includesUniform: z.boolean().optional(),
  asksSelfRating: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  highlight: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type PackageTemplateInput = z.infer<typeof packageTemplateSchema>;
/** PATCH body: omitted session types stay as they are (see clientUpdateSchema). */
export const packageTemplateUpdateSchema = packageTemplateSchema
  .extend({ lessonKinds: z.array(z.enum(LESSON_KINDS)).max(LESSON_KINDS.length).optional() })
  .partial();

export const sellPackageSchema = z
  .object({
    id: id.optional(),
    packageId: id.optional(),
    custom: z
      .object({
        name: trimmed(80).min(1),
        credits: z.number().int().min(1).max(500),
        lessonKinds: z.array(z.enum(LESSON_KINDS)).default([]),
        validityDays: z.number().int().min(1).max(3650).nullable().optional(),
      })
      .optional(),
    priceMinor: money.optional(),
    purchasedOn: date.optional(),
    expiresOn: date.nullable().optional(),
    /** Month-end packages: the month it runs for (this month or next; this month by default). */
    startMonth: z.string().regex(MONTH_RE, "Use YYYY-MM").optional(),
    /** Packages that include the training uniform. */
    uniformSize: optionalText(20),
    notes: optionalText(500),
    payment: z
      .object({
        amountMinor: money.min(1),
        method: trimmed(40).min(1),
        reference: optionalText(80),
      })
      .optional(),
  })
  .refine((v) => Boolean(v.packageId) !== Boolean(v.custom), {
    message: "Choose a package or describe a custom one",
  });
export type SellPackageInput = z.infer<typeof sellPackageSchema>;

export const clientPackageUpdateSchema = z.object({
  expiresOn: date.nullable().optional(),
  notes: optionalText(500),
  status: z.enum(["active", "void"]).optional(),
});

/** PATCH /client-packages/:id/uniform: the size, and whether it was handed out (any staff). */
export const uniformUpdateSchema = z.object({
  uniformSize: optionalText(20),
  issued: z.boolean().optional(),
});

export const creditAdjustSchema = z.object({
  delta: z
    .number()
    .int()
    .min(-100)
    .max(100)
    .refine((v) => v !== 0, "Adjustment cannot be zero"),
  note: trimmed(200).min(1, "Say why credits changed"),
});

// --- Schedule ----------------------------------------------------------------

export const recurrenceSchema = z.object({
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  endsOn: date.nullable().optional(),
});

export const lessonCreateSchema = z.object({
  id: id.optional(),
  kind: z.enum(LESSON_KINDS),
  title: optionalText(120),
  date,
  startTime: time,
  durationMinutes: z.number().int().min(15).max(720),
  venueId: id.nullable().optional(),
  court: optionalText(20),
  groupId: id.nullable().optional(),
  eventId: id.nullable().optional(),
  rateId: id.nullable().optional(),
  priceMinor: money.nullable().optional(),
  capacity: z.number().int().min(1).max(500).nullable().optional(),
  notes: optionalText(2000),
  clientIds: z.array(id).max(200).default([]),
  recurrence: recurrenceSchema.nullable().optional(),
  /** Lead coach. Omitted = the group's or event's lead coach, else whoever schedules it. */
  coachUserId: userId.nullable().optional(),
  /** Omitted = the group's or event's assistants. */
  assistantCoachIds: coachIds.optional(),
});
export type LessonCreateInput = z.infer<typeof lessonCreateSchema>;

export const lessonUpdateSchema = z.object({
  title: optionalText(120),
  date: date.optional(),
  startTime: time.optional(),
  durationMinutes: z.number().int().min(15).max(720).optional(),
  venueId: id.nullable().optional(),
  court: optionalText(20),
  rateId: id.nullable().optional(),
  priceMinor: money.nullable().optional(),
  capacity: z.number().int().min(1).max(500).nullable().optional(),
  notes: optionalText(2000),
  coachUserId: userId.nullable().optional(),
  assistantCoachIds: coachIds.optional(),
  scope: z.enum(["this", "following"]).default("this"),
});
export type LessonUpdateInput = z.infer<typeof lessonUpdateSchema>;

export const lessonCancelSchema = z.object({
  reason: optionalText(200),
  scope: z.enum(["this", "following"]).default("this"),
});

export const rainOutSchema = z.object({
  date,
  venueId: id.nullable().optional(),
  reason: optionalText(200),
});

export const participantSchema = z.object({ clientId: id });

export const attendanceUpdateSchema = z.object({
  status: z.enum(ATTENDANCE_STATUSES),
  /** Package to charge; "none" = pay per session; omitted = automatic choice. */
  packageId: z.union([id, z.literal("none")]).optional(),
  complimentary: z.boolean().optional(),
  note: optionalText(500),
  mutationId: id,
});
export type AttendanceUpdateInput = z.infer<typeof attendanceUpdateSchema>;

export const rangeQuerySchema = z.object({ from: date, to: date });

// --- Events -----------------------------------------------------------------

export const eventSchema = z.object({
  id: id.optional(),
  kind: z.enum(EVENT_KINDS),
  name: trimmed(120).min(1),
  description: optionalText(4000),
  startsOn: date,
  endsOn: date,
  venueId: id.nullable().optional(),
  capacity: z.number().int().min(1).max(1000).nullable().optional(),
  priceMinor: money,
  earlyBirdPriceMinor: money.nullable().optional(),
  earlyBirdUntil: date.nullable().optional(),
  level: optionalText(40),
  ageMin: z.number().int().min(3).max(100).nullable().optional(),
  ageMax: z.number().int().min(3).max(100).nullable().optional(),
  status: z.enum(EVENT_STATUSES).optional(),
  coachUserId: userId.nullable().optional(),
  assistantCoachIds: coachIds.optional(),
});
export type EventInput = z.infer<typeof eventSchema>;

export const registrationCreateSchema = z.object({
  clientId: id,
  priceMinor: money.optional(),
  note: optionalText(500),
});

export const registrationUpdateSchema = z.object({
  status: z.enum(REGISTRATION_STATUSES),
});

// --- Money -----------------------------------------------------------------

export const paymentSchema = z.object({
  id: id.optional(),
  clientId: id,
  amountMinor: money.min(1, "Enter an amount"),
  method: trimmed(40).min(1),
  paidOn: date,
  reference: optionalText(80),
  note: optionalText(500),
});
export type PaymentInput = z.infer<typeof paymentSchema>;

export const chargeSchema = z.object({
  id: id.optional(),
  clientId: id,
  kind: z.enum(["adjustment", "other"]),
  description: trimmed(120).min(1),
  amountMinor: signedMoney.refine((v) => v !== 0, "Amount cannot be zero"),
  occurredOn: date,
});
export type ChargeInput = z.infer<typeof chargeSchema>;

export const voidSchema = z.object({ reason: optionalText(200) });

// --- Progress ----------------------------------------------------------------

export const skillSchema = z.object({
  id: id.optional(),
  category: trimmed(40).min(1),
  name: trimmed(60).min(1),
  description: optionalText(300),
  active: z.boolean().optional(),
});

export const skillOrderSchema = z.object({ ids: z.array(id).min(1).max(200) });

export const assessmentSchema = z.object({
  id: id.optional(),
  assessedOn: date,
  overallLevel: optionalText(20),
  notes: optionalText(2000),
  lessonId: id.nullable().optional(),
  scores: z
    .array(
      z.object({
        skillId: id,
        score: z.number().int().min(SCORE_MIN).max(SCORE_MAX),
        note: optionalText(300),
      }),
    )
    .max(200),
  /** Shown to the student and their parents in the family portal. Defaults to true. */
  sharedWithFamily: z.boolean().optional(),
});
export type AssessmentInput = z.infer<typeof assessmentSchema>;
/** PATCH /assessments/:id: omitted fields stay as they are; scores, when sent, replace them all. */
export const assessmentUpdateSchema = assessmentSchema.omit({ id: true }).partial();

export const goalSchema = z.object({
  id: id.optional(),
  title: trimmed(120).min(1),
  detail: optionalText(1000),
  targetDate: date.nullable().optional(),
  status: z.enum(GOAL_STATUSES).optional(),
});

export const ratingSchema = z.object({
  id: id.optional(),
  source: z.enum(RATING_SOURCES),
  value: z.number().min(1).max(8),
  recordedOn: date,
});

export const noteSchema = z
  .object({
    id: id.optional(),
    clientId: id.nullable().optional(),
    lessonId: id.nullable().optional(),
    body: trimmed(4000).min(1, "Write something first"),
    pinned: z.boolean().optional(),
    /** Coaches only unless set to "shared"; handoff notes are always coaches only. */
    visibility: z.enum(NOTE_VISIBILITIES).optional(),
    kind: z.enum(NOTE_KINDS).optional(),
  })
  .refine((v) => v.clientId || v.lessonId, { message: "A note needs a client or a session" })
  .refine((v) => v.kind !== "handoff" || v.clientId, {
    message: "A handoff note is about a student",
    path: ["clientId"],
  });
export type NoteInput = z.infer<typeof noteSchema>;

export const noteUpdateSchema = z.object({
  body: trimmed(4000).min(1).optional(),
  pinned: z.boolean().optional(),
  visibility: z.enum(NOTE_VISIBILITIES).optional(),
});
export type NoteUpdateInput = z.infer<typeof noteUpdateSchema>;

// --- Consents ----------------------------------------------------------------

const consentBody = z
  .string()
  .max(20_000, "Keep the text under 20,000 characters.")
  .refine((v) => v.trim().length > 0, "Write the text families will sign.");

/** POST /consent-documents (owners and admins). Plain text; blank lines separate paragraphs. */
export const consentDocumentSchema = z.object({
  kind: z.enum(CONSENT_KINDS),
  title: trimmed(120).min(1, "Give the document a title."),
  body: consentBody,
  required: z.boolean().optional(),
  appliesTo: z.enum(CONSENT_APPLIES_TO).optional(),
  active: z.boolean().optional(),
});
export type ConsentDocumentInput = z.infer<typeof consentDocumentSchema>;
/** PATCH: omitted fields stay; a changed text after signatures starts a new version. */
export const consentDocumentUpdateSchema = consentDocumentSchema.partial();

/** POST /consent-documents/templates: a starter document, added as a draft. */
export const consentTemplateSchema = z.object({ kind: z.enum(CONSENT_TEMPLATE_KINDS) });

/**
 * Signing a version of a document by typing a name (family portal), or recording a paper form
 * (staff). `version` is the one the signer read: a document changed since answers 409.
 */
export const consentSignSchema = z.object({
  signerName: trimmed(120).min(2, "Type your full name to sign."),
  version: z.number().int().min(1),
});

// --- Enrollment ----------------------------------------------------------------

/** A consent signed inside the enrollment wizard (or a renewal): saved with the request. */
export const enrollmentSignatureSchema = z.object({
  documentId: id,
  version: z.number().int().min(1),
  signerName: trimmed(120).min(2, "Type your full name to sign."),
});

const pickupSchema = z.object({
  name: trimmed(80).min(1, "Add the person's name."),
  relationship: optionalText(40),
  phone: optionalText(40),
});

/** The details step of the enrollment wizard. Which ones a tier needs is checked by the server. */
export const enrollmentAnswersSchema = z.object({
  phone: trimmed(40).min(5, "Add a phone number the academy can reach you on."),
  /** Passkey-only accounts: an address the academy can use (optional). */
  email: optionalEmail,
  selfRating: z.number().refine(isSelfRating, "Pick a level from the scale.").nullable().optional(),
  selfRatingUnsure: z.boolean().optional(),
  shirtSize: z
    .string()
    .trim()
    .refine((v) => v === "" || ALL_UNIFORM_SIZES.includes(v), "Pick a size from the list.")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  medicalNotes: optionalText(1000),
  emergencyName: trimmed(80).min(1, "Add someone to call in an emergency."),
  emergencyPhone: trimmed(40).min(5, "Add their phone number."),
  notes: optionalText(1000),
  pickups: z.array(pickupSchema).max(MAX_PICKUPS).default([]),
});
export type EnrollmentAnswersInput = z.infer<typeof enrollmentAnswersSchema>;

/**
 * POST /api/portal/enrollments: the wizard's request. `who` is the caller themself (their own
 * student record here, or a new one with their name and birth date), one of their children, or a
 * new child. The period field matches the tier's mode (start month, session, or start date).
 */
export const enrollmentSubmitSchema = z.object({
  /** Made by the app, so a retried send finds the request it already made. */
  id: id.optional(),
  slug: z.string().trim().toLowerCase().min(3).max(40),
  packageId: id,
  who: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("self"),
      firstName: trimmed(60).min(1, "Add your first name.").optional(),
      lastName: trimmed(60).optional(),
      birthDate: date.optional(),
    }),
    z.object({ kind: z.literal("child"), clientId: id }),
    z.object({
      kind: z.literal("new_child"),
      firstName: trimmed(60).min(1, "Add your child's first name."),
      lastName: trimmed(60).default(""),
      birthDate: date,
    }),
  ]),
  startMonth: z.string().regex(MONTH_RE, "Use YYYY-MM").optional(),
  lessonId: id.optional(),
  startDate: date.optional(),
  answers: enrollmentAnswersSchema,
  signatures: z.array(enrollmentSignatureSchema).max(20).default([]),
});
export type EnrollmentSubmitInput = z.infer<typeof enrollmentSubmitSchema>;

/** POST /api/portal/students/:clientId/renew: next month, same tier; forms to re-sign, if any. */
export const enrollmentRenewSchema = z.object({
  id: id.optional(),
  signatures: z.array(enrollmentSignatureSchema).max(20).default([]),
});

/** POST /api/v1/enrollments/:id/approve. Every field is optional: the request's own choice wins. */
export const enrollmentApproveSchema = z.object({
  /** Month-end tiers: the month to approve (this month or next), when the asked one has passed. */
  startMonth: z.string().regex(MONTH_RE, "Use YYYY-MM").optional(),
  /** Trial sessions: another session of the program, when the chosen one passed or is full. */
  lessonId: id.optional(),
  /** Tiers by start date: another start date. */
  startDate: date.optional(),
  /** New students: the student already on the books this really is (their record is used). */
  linkClientId: id.optional(),
  /** Book a session that's already full. */
  force: z.boolean().optional(),
});
export type EnrollmentApproveInput = z.infer<typeof enrollmentApproveSchema>;

/** POST /api/v1/enrollments/:id/waitlist: an optional note the family sees. */
export const enrollmentWaitlistSchema = z.object({ note: optionalText(500) });

/** POST /api/v1/enrollments/:id/decline: the reason, which the family sees. */
export const enrollmentDeclineSchema = z.object({
  reason: trimmed(500).min(2, "Say why, so the family knows."),
});

/** GET /api/v1/enrollments?status=. */
export const enrollmentListQuerySchema = z.object({
  status: z.enum([...ENROLLMENT_STATUSES, "all"]).optional(),
});

/** GET /api/public/academies/:slug/programs/:programId/sessions?from&to. */
export const publicSessionsQuerySchema = z.object({
  from: date.optional(),
  to: date.optional(),
});

// --- Push ------------------------------------------------------------------

export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export const notificationPrefSchema = z.object({
  sessionReminderMinutes: z.number().int().min(5).max(240).nullable(),
  dailyDigestTime: time.nullable(),
  packageExpiryDays: z.number().int().min(1).max(60),
});
export type NotificationPrefInput = z.infer<typeof notificationPrefSchema>;
