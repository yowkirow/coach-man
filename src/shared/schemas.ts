import { z } from "zod";
import {
  ATTENDANCE_STATUSES,
  CLIENT_STATUSES,
  EVENT_KINDS,
  EVENT_STATUSES,
  GOAL_STATUSES,
  LESSON_KINDS,
  RATE_KINDS,
  RATE_UNITS,
  RATING_SOURCES,
  REGISTRATION_STATUSES,
  SCORE_MAX,
  SCORE_MIN,
} from "./domain";
import { UUID_RE } from "./ids";
import { DATE_RE, isValidTimeZone, TIME_RE } from "./time";

const id = z.string().regex(UUID_RE, "Invalid id");
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
});
export type ClientInput = z.infer<typeof clientSchema>;
export const clientUpdateSchema = clientSchema.partial().omit({ id: true });
export type ClientUpdateInput = z.infer<typeof clientUpdateSchema>;

export const clientImportSchema = z.object({
  rows: z
    .array(clientSchema.omit({ id: true, groupIds: true }))
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
});
export type GroupInput = z.infer<typeof groupSchema>;

export const groupMembersSchema = z.object({ clientIds: z.array(id).min(1).max(200) });

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
});
export type PackageTemplateInput = z.infer<typeof packageTemplateSchema>;

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
});
export type AssessmentInput = z.infer<typeof assessmentSchema>;

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
  })
  .refine((v) => v.clientId || v.lessonId, { message: "A note needs a client or a session" });
export type NoteInput = z.infer<typeof noteSchema>;

export const noteUpdateSchema = z.object({
  body: trimmed(4000).min(1).optional(),
  pinned: z.boolean().optional(),
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
