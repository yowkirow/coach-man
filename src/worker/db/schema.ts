import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type {
  AnnouncementAudience,
  AttendanceStatus,
  ChargeKind,
  ClientCoachRole,
  ClientPackageStatus,
  ClientStatus,
  ConsentAppliesTo,
  ConsentKind,
  ConsentSignerRelation,
  EnrollmentAnswers,
  EnrollmentStatus,
  EventKind,
  EventStatus,
  FamilyRelation,
  GoalStatus,
  InviteKind,
  LedgerReason,
  LessonKind,
  LessonStatus,
  NoteKind,
  NoteVisibility,
  PaymentSubmissionStatus,
  RateKind,
  RateUnit,
  RatingSource,
  RegistrationStatus,
  ValidityMode,
} from "../../shared/domain";
import type { StaffRole } from "../../shared/roles";

// Column names are snake_case via drizzle's `casing: "snake_case"` (see drizzle.config.ts and db/client.ts).
// Auth tables use Date timestamps (Better Auth expects Date objects); app tables use epoch-ms numbers.

const authCreatedAt = () =>
  integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());
const authUpdatedAt = () =>
  integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

const createdAt = () =>
  integer()
    .notNull()
    .$defaultFn(() => Date.now());
const updatedAt = () =>
  integer()
    .notNull()
    .$defaultFn(() => Date.now())
    .$onUpdateFn(() => Date.now());

// ---------------------------------------------------------------------------
// Better Auth (core + organization + passkey plugins)
// ---------------------------------------------------------------------------

export const user = sqliteTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: integer({ mode: "boolean" }).notNull().default(false),
  image: text(),
  createdAt: authCreatedAt(),
  updatedAt: authUpdatedAt(),
});

export const session = sqliteTable(
  "session",
  {
    id: text().primaryKey(),
    expiresAt: integer({ mode: "timestamp_ms" }).notNull(),
    token: text().notNull().unique(),
    createdAt: authCreatedAt(),
    updatedAt: authUpdatedAt(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: integer({ mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer({ mode: "timestamp_ms" }),
    scope: text(),
    password: text(),
    createdAt: authCreatedAt(),
    updatedAt: authUpdatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: integer({ mode: "timestamp_ms" }).notNull(),
    createdAt: authCreatedAt(),
    updatedAt: authUpdatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const passkey = sqliteTable(
  "passkey",
  {
    id: text().primaryKey(),
    name: text(),
    publicKey: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text().notNull(),
    counter: integer().notNull(),
    deviceType: text().notNull(),
    backedUp: integer({ mode: "boolean" }).notNull(),
    transports: text(),
    createdAt: integer({ mode: "timestamp_ms" }),
    aaguid: text(),
  },
  (t) => [
    index("passkey_user_idx").on(t.userId),
    index("passkey_credential_idx").on(t.credentialID),
  ],
);

export const organization = sqliteTable("organization", {
  id: text().primaryKey(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  logo: text(),
  createdAt: integer({ mode: "timestamp_ms" }).notNull(),
  metadata: text(),
});

export const member = sqliteTable(
  "member",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text().notNull().default("member"),
    createdAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("member_org_idx").on(t.organizationId), index("member_user_idx").on(t.userId)],
);

export const invitation = sqliteTable(
  "invitation",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text().notNull(),
    role: text(),
    status: text().notNull().default("pending"),
    expiresAt: integer({ mode: "timestamp_ms" }).notNull(),
    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    inviterId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("invitation_org_idx").on(t.organizationId)],
);

export const rateLimit = sqliteTable("rate_limit", {
  id: text().primaryKey(),
  key: text().notNull().unique(),
  count: integer().notNull(),
  lastRequest: integer().notNull(),
});

// ---------------------------------------------------------------------------
// Workspace (an academy, or a solo coach's one-person academy; a Better Auth organization)
// ---------------------------------------------------------------------------

const workspaceId = () =>
  text()
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

export const workspaceSettings = sqliteTable("workspace_settings", {
  workspaceId: text()
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  currency: text().notNull().default("USD"),
  timezone: text().notNull().default("UTC"),
  locale: text().notNull().default("en-US"),
  sport: text().notNull().default("pickleball"),
  paymentMethods: text({ mode: "json" }).$type<string[]>().notNull(),
  noShowUsesCredit: integer({ mode: "boolean" }).notNull().default(true),
  lateCancelUsesCredit: integer({ mode: "boolean" }).notNull().default(true),
  lateCancelHours: integer().notNull().default(24),
  defaultSessionMinutes: integer().notNull().default(60),
  weekStartsOn: integer().notNull().default(1),
  onboardedAt: integer(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const venue = sqliteTable(
  "venue",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    name: text().notNull(),
    address: text(),
    courtCount: integer(),
    notes: text(),
    archivedAt: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("venue_ws_idx").on(t.workspaceId)],
);

// ---------------------------------------------------------------------------
// Clients and groups
// ---------------------------------------------------------------------------

export const client = sqliteTable(
  "client",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    firstName: text().notNull(),
    lastName: text().notNull().default(""),
    email: text(),
    phone: text(),
    birthDate: text(),
    isJunior: integer({ mode: "boolean" }).notNull().default(false),
    guardianName: text(),
    guardianPhone: text(),
    guardianEmail: text(),
    emergencyName: text(),
    emergencyPhone: text(),
    level: text(),
    duprId: text(),
    duprRating: real(),
    dominantHand: text(),
    paddle: text(),
    goals: text(),
    medicalNotes: text(),
    notes: text(),
    status: text().$type<ClientStatus>().notNull().default("active"),
    source: text(),
    tags: text({ mode: "json" })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    photoKey: text(),
    joinedOn: text(),
    shirtSize: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("client_ws_status_idx").on(t.workspaceId, t.status),
    index("client_ws_name_idx").on(t.workspaceId, t.firstName, t.lastName),
    index("client_ws_email_idx").on(t.workspaceId, t.email),
    index("client_ws_phone_idx").on(t.workspaceId, t.phone),
  ],
);

export const trainingGroup = sqliteTable(
  "training_group",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    name: text().notNull(),
    level: text(),
    description: text(),
    color: text(),
    capacity: integer(),
    defaultRateId: text(),
    defaultVenueId: text(),
    archivedAt: integer(),
    // Academy: a group is a program, with a lead coach and assistants, publishable to the
    // academy page.
    coachUserId: text(),
    assistantCoachIds: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    isPublic: integer({ mode: "boolean" }).notNull().default(false),
    publicDescription: text(),
    /** e.g. "Every Tue & Thu, 7–10pm". */
    scheduleNote: text(),
    ageMin: integer(),
    ageMax: integer(),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("group_ws_idx").on(t.workspaceId)],
);

export const groupMember = sqliteTable(
  "group_member",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    groupId: text()
      .notNull()
      .references(() => trainingGroup.id, { onDelete: "cascade" }),
    clientId: text()
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    joinedOn: text(),
    leftOn: text(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("group_member_unique").on(t.groupId, t.clientId),
    index("group_member_client_idx").on(t.clientId),
  ],
);

// ---------------------------------------------------------------------------
// Rates, packages, and the credit ledger
// ---------------------------------------------------------------------------

export const rate = sqliteTable(
  "rate",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    name: text().notNull(),
    kind: text().$type<RateKind>().notNull(),
    durationMinutes: integer().notNull().default(60),
    priceMinor: integer().notNull(),
    unit: text().$type<RateUnit>().notNull().default("session"),
    active: integer({ mode: "boolean" }).notNull().default(true),
    /** Set for a coach-specific rate; null = the academy's rate. */
    coachUserId: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("rate_ws_idx").on(t.workspaceId)],
);

export const packageTemplate = sqliteTable(
  "package",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    name: text().notNull(),
    credits: integer().notNull(),
    /** Lesson kinds this package can pay for. Empty array = any kind except event sessions. */
    lessonKinds: text({ mode: "json" })
      .$type<LessonKind[]>()
      .notNull()
      .$defaultFn(() => []),
    priceMinor: integer().notNull(),
    validityDays: integer(),
    description: text(),
    active: integer({ mode: "boolean" }).notNull().default(true),
    // Academy package tiers (the rates sheet): program, label, validity, inclusions, publishing.
    programId: text(),
    coachUserId: text(),
    /** e.g. "4–6 sessions" when credits is the upper bound. */
    sessionsLabel: text(),
    validityMode: text().$type<ValidityMode>().notNull().default("days"),
    inclusions: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    /** "Who it's for". */
    audience: text(),
    /** Recommended commitment, e.g. "At least 2 months". */
    commitmentNote: text(),
    includesUniform: integer({ mode: "boolean" }).notNull().default(false),
    asksSelfRating: integer({ mode: "boolean" }).notNull().default(false),
    isPublic: integer({ mode: "boolean" }).notNull().default(false),
    highlight: integer({ mode: "boolean" }).notNull().default(false),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("package_ws_idx").on(t.workspaceId)],
);

export const clientPackage = sqliteTable(
  "client_package",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    clientId: text()
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    packageId: text().references(() => packageTemplate.id, { onDelete: "set null" }),
    name: text().notNull(),
    creditsTotal: integer().notNull(),
    lessonKinds: text({ mode: "json" })
      .$type<LessonKind[]>()
      .notNull()
      .$defaultFn(() => []),
    priceMinor: integer().notNull(),
    purchasedOn: text().notNull(),
    expiresOn: text(),
    status: text().$type<ClientPackageStatus>().notNull().default("active"),
    notes: text(),
    /** YYYY-MM for month-end packages. */
    startMonth: text(),
    /** Sold with the training uniform (copied from the package tier at sale, like its name). */
    includesUniform: integer({ mode: "boolean" }).notNull().default(false),
    uniformSize: text(),
    uniformIssuedAt: integer(),
    enrollmentId: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("client_package_client_idx").on(t.workspaceId, t.clientId, t.status),
    index("client_package_expiry_idx").on(t.workspaceId, t.status, t.expiresOn),
  ],
);

/** Append-only. Remaining credits = credits_total + SUM(delta). */
export const creditLedger = sqliteTable(
  "credit_ledger",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    clientPackageId: text()
      .notNull()
      .references(() => clientPackage.id, { onDelete: "cascade" }),
    clientId: text().notNull(),
    delta: integer().notNull(),
    reason: text().$type<LedgerReason>().notNull(),
    attendanceId: text(),
    lessonId: text(),
    note: text(),
    createdBy: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("ledger_package_idx").on(t.clientPackageId),
    index("ledger_attendance_idx").on(t.attendanceId),
    index("ledger_client_idx").on(t.workspaceId, t.clientId),
  ],
);

// ---------------------------------------------------------------------------
// Schedule and attendance
// ---------------------------------------------------------------------------

export const lessonSeries = sqliteTable(
  "lesson_series",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    kind: text().$type<LessonKind>().notNull(),
    title: text(),
    groupId: text(),
    venueId: text(),
    court: text(),
    rateId: text(),
    priceMinor: integer(),
    capacity: integer(),
    /** 0 = Sunday ... 6 = Saturday, in the series timezone. */
    weekdays: text({ mode: "json" }).$type<number[]>().notNull(),
    startTime: text().notNull(),
    durationMinutes: integer().notNull(),
    startsOn: text().notNull(),
    endsOn: text(),
    timezone: text().notNull(),
    /** Client ids booked into every occurrence (private/semi-private series). Group series use membership. */
    participantIds: text({ mode: "json" })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    materializedThrough: text(),
    active: integer({ mode: "boolean" }).notNull().default(true),
    /** Lead coach; occurrences inherit it. */
    coachUserId: text(),
    assistantCoachIds: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("series_ws_idx").on(t.workspaceId, t.active)],
);

export const lesson = sqliteTable(
  "lesson",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    kind: text().$type<LessonKind>().notNull(),
    title: text(),
    startsAt: integer().notNull(),
    endsAt: integer().notNull(),
    venueId: text(),
    court: text(),
    groupId: text(),
    eventId: text(),
    rateId: text(),
    /** Per-attendee price used for pay-per-session charges; overrides the rate. */
    priceMinor: integer(),
    capacity: integer(),
    status: text().$type<LessonStatus>().notNull().default("scheduled"),
    cancelReason: text(),
    seriesId: text(),
    /** Local date (YYYY-MM-DD) of the series occurrence this lesson materializes. */
    occurrenceDate: text(),
    detached: integer({ mode: "boolean" }).notNull().default(false),
    notes: text(),
    completedAt: integer(),
    /** Lead coach. */
    coachUserId: text(),
    assistantCoachIds: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("lesson_ws_start_idx").on(t.workspaceId, t.startsAt),
    index("lesson_group_idx").on(t.groupId),
    index("lesson_event_idx").on(t.eventId),
    index("lesson_coach_idx").on(t.workspaceId, t.coachUserId, t.startsAt),
    uniqueIndex("lesson_series_occurrence_unique").on(t.seriesId, t.occurrenceDate),
  ],
);

export const attendance = sqliteTable(
  "attendance",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    lessonId: text()
      .notNull()
      .references(() => lesson.id, { onDelete: "cascade" }),
    clientId: text()
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    status: text().$type<AttendanceStatus>().notNull().default("booked"),
    /** Package currently paying for this attendance (null when none consumed). */
    consumedPackageId: text(),
    /** Pay-per-session charge currently attached (null when none). */
    chargeId: text(),
    /** True when a coach chose "no charge" for this attendance. */
    complimentary: integer({ mode: "boolean" }).notNull().default(false),
    checkedInAt: integer(),
    note: text(),
    version: integer().notNull().default(0),
    lastMutationId: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("attendance_lesson_client_unique").on(t.lessonId, t.clientId),
    index("attendance_client_idx").on(t.workspaceId, t.clientId),
  ],
);

// ---------------------------------------------------------------------------
// Events / programs
// ---------------------------------------------------------------------------

export const event = sqliteTable(
  "event",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    kind: text().$type<EventKind>().notNull(),
    name: text().notNull(),
    description: text(),
    startsOn: text().notNull(),
    endsOn: text().notNull(),
    venueId: text(),
    capacity: integer(),
    priceMinor: integer().notNull().default(0),
    earlyBirdPriceMinor: integer(),
    earlyBirdUntil: text(),
    level: text(),
    ageMin: integer(),
    ageMax: integer(),
    status: text().$type<EventStatus>().notNull().default("draft"),
    /** Lead coach. */
    coachUserId: text(),
    assistantCoachIds: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("event_ws_idx").on(t.workspaceId, t.startsOn)],
);

export const eventRegistration = sqliteTable(
  "event_registration",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    eventId: text()
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    clientId: text()
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    status: text().$type<RegistrationStatus>().notNull().default("registered"),
    priceMinor: integer().notNull(),
    chargeId: text(),
    registeredAt: integer().notNull(),
    note: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("registration_event_client_unique").on(t.eventId, t.clientId),
    index("registration_client_idx").on(t.workspaceId, t.clientId),
  ],
);

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export const charge = sqliteTable(
  "charge",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    clientId: text()
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    kind: text().$type<ChargeKind>().notNull(),
    description: text().notNull(),
    amountMinor: integer().notNull(),
    clientPackageId: text(),
    attendanceId: text(),
    registrationId: text(),
    occurredOn: text().notNull(),
    voidedAt: integer(),
    voidReason: text(),
    createdBy: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("charge_client_idx").on(t.workspaceId, t.clientId),
    index("charge_ws_date_idx").on(t.workspaceId, t.occurredOn),
  ],
);

export const payment = sqliteTable(
  "payment",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    clientId: text()
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    amountMinor: integer().notNull(),
    method: text().notNull(),
    paidOn: text().notNull(),
    reference: text(),
    note: text(),
    voidedAt: integer(),
    createdBy: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payment_client_idx").on(t.workspaceId, t.clientId),
    index("payment_ws_date_idx").on(t.workspaceId, t.paidOn),
  ],
);

/** Derived: rebuilt oldest-first per client whenever charges or payments change. */
export const paymentAllocation = sqliteTable(
  "payment_allocation",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    clientId: text().notNull(),
    paymentId: text()
      .notNull()
      .references(() => payment.id, { onDelete: "cascade" }),
    chargeId: text()
      .notNull()
      .references(() => charge.id, { onDelete: "cascade" }),
    amountMinor: integer().notNull(),
  },
  (t) => [
    index("allocation_charge_idx").on(t.chargeId),
    index("allocation_client_idx").on(t.workspaceId, t.clientId),
  ],
);

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export const skill = sqliteTable(
  "skill",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    category: text().notNull(),
    name: text().notNull(),
    description: text(),
    sortOrder: integer().notNull().default(0),
    active: integer({ mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("skill_ws_idx").on(t.workspaceId, t.sortOrder)],
);

export const assessment = sqliteTable(
  "assessment",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    clientId: text()
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    assessedOn: text().notNull(),
    overallLevel: text(),
    notes: text(),
    lessonId: text(),
    createdBy: text(),
    /** Progress is the point: assessments are shared with the student and parents by default. */
    sharedWithFamily: integer({ mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("assessment_client_idx").on(t.workspaceId, t.clientId, t.assessedOn)],
);

export const assessmentScore = sqliteTable(
  "assessment_score",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    assessmentId: text()
      .notNull()
      .references(() => assessment.id, { onDelete: "cascade" }),
    skillId: text()
      .notNull()
      .references(() => skill.id, { onDelete: "cascade" }),
    score: integer().notNull(),
    note: text(),
  },
  (t) => [uniqueIndex("assessment_score_unique").on(t.assessmentId, t.skillId)],
);

export const goal = sqliteTable(
  "goal",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    clientId: text()
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    title: text().notNull(),
    detail: text(),
    targetDate: text(),
    status: text().$type<GoalStatus>().notNull().default("active"),
    achievedOn: text(),
    /** The coach who set the goal (null on goals from before coaches were tracked). */
    createdBy: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("goal_client_idx").on(t.workspaceId, t.clientId)],
);

export const note = sqliteTable(
  "note",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    clientId: text().references(() => client.id, { onDelete: "cascade" }),
    lessonId: text().references(() => lesson.id, { onDelete: "set null" }),
    body: text().notNull(),
    pinned: integer({ mode: "boolean" }).notNull().default(false),
    createdBy: text(),
    /** Coaches only by default; `shared` also shows to the student and parents. */
    visibility: text().$type<NoteVisibility>().notNull().default("staff"),
    kind: text().$type<NoteKind>().notNull().default("comment"),
    editedAt: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("note_client_idx").on(t.workspaceId, t.clientId, t.createdAt),
    index("note_lesson_idx").on(t.lessonId),
  ],
);

export const ratingSnapshot = sqliteTable(
  "rating_snapshot",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    clientId: text()
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    source: text().$type<RatingSource>().notNull(),
    value: real().notNull(),
    recordedOn: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("rating_client_idx").on(t.workspaceId, t.clientId, t.recordedOn)],
);

// ---------------------------------------------------------------------------
// Academy: profile, coaches, family access, invites, enrollment, consents, safety, news
// ---------------------------------------------------------------------------

/** The public face of a workspace. Its public URL slug is `organization.slug`. */
export const academyProfile = sqliteTable("academy_profile", {
  workspaceId: text()
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  tagline: text(),
  about: text(),
  contactPhone: text(),
  contactEmail: text(),
  address: text(),
  mapUrl: text(),
  socials: text({ mode: "json" }).$type<Record<string, string>>().notNull().default({}),
  logoKey: text(),
  coverKey: text(),
  paymentInstructions: text(),
  paymentQrKey: text(),
  policies: text(),
  enrollmentOpen: integer({ mode: "boolean" }).notNull().default(false),
  /** The public academy page is visible. */
  listed: integer({ mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const coachProfile = sqliteTable(
  "coach_profile",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Null = the user's own name. */
    displayName: text(),
    title: text(),
    bio: text(),
    photoKey: text(),
    certifications: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    duprRating: real(),
    specialties: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    languages: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    yearsCoaching: integer(),
    isPublic: integer({ mode: "boolean" }).notNull().default(true),
    sortOrder: integer().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("coach_profile_ws_user_unique").on(t.workspaceId, t.userId)],
);

/** A student's coaches over time. At most one current primary per client (enforced in code). */
export const clientCoach = sqliteTable(
  "client_coach",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    clientId: text()
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    coachUserId: text().notNull(),
    role: text().$type<ClientCoachRole>().notNull(),
    startedOn: text().notNull(),
    /** Null = current. */
    endedOn: text(),
    assignedBy: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("client_coach_client_idx").on(t.workspaceId, t.clientId),
    index("client_coach_coach_idx").on(t.workspaceId, t.coachUserId, t.endedOn),
  ],
);

/** Links a signed-in person (student or parent) to a student for the family portal. */
export const clientAccess = sqliteTable(
  "client_access",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    clientId: text()
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    relation: text().$type<FamilyRelation>().notNull(),
    grantedBy: text(),
    createdAt: createdAt(),
    /** Null = active. */
    revokedAt: integer(),
  },
  (t) => [
    uniqueIndex("client_access_client_user_unique").on(t.clientId, t.userId),
    index("client_access_user_idx").on(t.userId),
  ],
);

/** Staff and family invite links. Only the SHA-256 of the token is stored. */
export const invite = sqliteTable(
  "invite",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    kind: text().$type<InviteKind>().notNull(),
    tokenHash: text().notNull().unique(),
    /** Staff invites: the Google email that may accept, lowercased. */
    email: text(),
    role: text().$type<StaffRole>(),
    clientId: text().references(() => client.id, { onDelete: "cascade" }),
    relation: text().$type<FamilyRelation>(),
    createdBy: text(),
    createdAt: createdAt(),
    expiresAt: integer().notNull(),
    acceptedBy: text(),
    acceptedAt: integer(),
    revokedAt: integer(),
  },
  (t) => [index("invite_ws_kind_idx").on(t.workspaceId, t.kind)],
);

export const enrollmentRequest = sqliteTable(
  "enrollment_request",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    /** New students are created as clients with status `lead` when the request is sent. */
    clientId: text()
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    requestedBy: text().notNull(),
    packageId: text(),
    /** A program (training_group) id. */
    programId: text(),
    eventId: text(),
    /** YYYY-MM. */
    startMonth: text(),
    /** The trial session picked. */
    lessonId: text(),
    answers: text({ mode: "json" }).$type<EnrollmentAnswers>().notNull().default({}),
    status: text().$type<EnrollmentStatus>().notNull().default("requested"),
    decidedBy: text(),
    decidedAt: integer(),
    decisionNote: text(),
    clientPackageId: text(),
    registrationId: text(),
    chargeId: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("enrollment_ws_status_idx").on(t.workspaceId, t.status, t.createdAt),
    index("enrollment_client_idx").on(t.clientId),
    // The passkey-account cleanup keeps accounts that sent a request.
    index("enrollment_requested_by_idx").on(t.requestedBy),
  ],
);

/** A family's proof of an outside payment (GCash, bank transfer, cash), waiting for review. */
export const paymentSubmission = sqliteTable(
  "payment_submission",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    clientId: text()
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    submittedBy: text().notNull(),
    enrollmentId: text(),
    amountMinor: integer().notNull(),
    method: text().notNull(),
    reference: text(),
    paidOn: text().notNull(),
    proofKey: text(),
    note: text(),
    status: text().$type<PaymentSubmissionStatus>().notNull().default("pending"),
    reviewedBy: text(),
    reviewedAt: integer(),
    rejectReason: text(),
    /** The payment recorded when staff confirmed it. */
    paymentId: text(),
    /** WS4c: the proof (not accepted) this one sends again. */
    resubmitOf: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("payment_submission_ws_status_idx").on(t.workspaceId, t.status, t.createdAt),
    index("payment_submission_client_idx").on(t.clientId),
    // The family's file reads look a proof up by its key; one key, one proof (NULLs allowed).
    uniqueIndex("payment_submission_proof_key_idx").on(t.proofKey),
    // Voiding a payment finds the proof that recorded it.
    index("payment_submission_payment_idx").on(t.paymentId),
    index("payment_submission_enrollment_idx").on(t.enrollmentId),
  ],
);

export const consentDocument = sqliteTable(
  "consent_document",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    kind: text().$type<ConsentKind>().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    version: integer().notNull().default(1),
    required: integer({ mode: "boolean" }).notNull().default(true),
    appliesTo: text().$type<ConsentAppliesTo>().notNull().default("all"),
    active: integer({ mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("consent_document_ws_idx").on(t.workspaceId)],
);

/**
 * The text of every version of a consent document that was put in front of families, so a
 * signature can always be matched to the words it agreed to.
 */
export const consentDocumentVersion = sqliteTable(
  "consent_document_version",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    documentId: text()
      .notNull()
      .references(() => consentDocument.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("consent_document_version_unique").on(t.documentId, t.version)],
);

/** A typed-name signature of one version of a consent document, for one student. */
export const consentSignature = sqliteTable(
  "consent_signature",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    documentId: text()
      .notNull()
      .references(() => consentDocument.id, { onDelete: "cascade" }),
    documentVersion: integer().notNull(),
    clientId: text()
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    signedByUserId: text(),
    signerName: text().notNull(),
    relation: text().$type<ConsentSignerRelation>().notNull(),
    signedAt: integer().notNull(),
    ipAddress: text(),
    userAgent: text(),
    enrollmentId: text(),
  },
  (t) => [
    index("consent_signature_client_idx").on(t.clientId, t.documentId),
    index("consent_signature_ws_idx").on(t.workspaceId, t.documentId),
  ],
);

/** People allowed to pick up a junior after a session. */
export const authorizedPickup = sqliteTable(
  "authorized_pickup",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    clientId: text()
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    name: text().notNull(),
    relationship: text(),
    phone: text(),
    photoKey: text(),
    notes: text(),
    createdBy: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("authorized_pickup_client_idx").on(t.clientId)],
);

export const announcement = sqliteTable(
  "announcement",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    title: text().notNull(),
    body: text().notNull(),
    audience: text().$type<AnnouncementAudience>().notNull().default("all"),
    /** The program or event id when the audience is narrowed. */
    audienceId: text(),
    pinned: integer({ mode: "boolean" }).notNull().default(false),
    /** Null = draft. */
    publishedAt: integer(),
    expiresAt: integer(),
    createdBy: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("announcement_ws_published_idx").on(t.workspaceId, t.publishedAt)],
);

// ---------------------------------------------------------------------------
// Platform: push, idempotency, audit
// ---------------------------------------------------------------------------

export const pushSubscription = sqliteTable(
  "push_subscription",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: workspaceId(),
    endpoint: text().notNull().unique(),
    p256dh: text().notNull(),
    auth: text().notNull(),
    userAgent: text(),
    failureCount: integer().notNull().default(0),
    lastSuccessAt: integer(),
    createdAt: createdAt(),
  },
  (t) => [index("push_user_idx").on(t.userId)],
);

export const notificationPref = sqliteTable("notification_pref", {
  userId: text()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  workspaceId: workspaceId(),
  /** Minutes before a session to remind; null = off. */
  sessionReminderMinutes: integer().default(30),
  /** Local HH:MM for the daily digest; null = off. */
  dailyDigestTime: text().default("07:00"),
  packageExpiryDays: integer().notNull().default(7),
  updatedAt: updatedAt(),
});

export const notificationLog = sqliteTable(
  "notification_log",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    userId: text().notNull(),
    kind: text().notNull(),
    refKey: text().notNull(),
    sentAt: integer().notNull(),
  },
  (t) => [uniqueIndex("notification_log_unique").on(t.userId, t.kind, t.refKey)],
);

export const idempotencyKey = sqliteTable(
  "idempotency_key",
  {
    key: text().primaryKey(),
    workspaceId: workspaceId(),
    method: text().notNull(),
    path: text().notNull(),
    status: integer().notNull(),
    response: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("idempotency_created_idx").on(t.createdAt)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text().primaryKey(),
    workspaceId: workspaceId(),
    userId: text(),
    action: text().notNull(),
    entity: text().notNull(),
    entityId: text(),
    data: text({ mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_ws_idx").on(t.workspaceId, t.createdAt)],
);

export const authSchema = {
  user,
  session,
  account,
  verification,
  passkey,
  organization,
  member,
  invitation,
  rateLimit,
};

// Re-exported for raw SQL fragments in queries.
export { sql };
