import type { ConsentStatus } from "./consents";
import type {
  AcademySocial,
  AttendanceStatus,
  ChargeKind,
  ClientCoachRole,
  ClientPackageStatus,
  ClientStatus,
  ConsentAppliesTo,
  ConsentKind,
  ConsentSignerRelation,
  EventKind,
  EventStatus,
  FamilyRelation,
  GoalStatus,
  InviteKind,
  InviteStatus,
  LedgerReason,
  LessonKind,
  LessonStatus,
  NoteKind,
  NoteVisibility,
  RateKind,
  RateUnit,
  RatingSource,
  RegistrationStatus,
  ValidityMode,
} from "./domain";
import type { Capabilities, StaffRole } from "./roles";

// Response shapes returned by /api/v1 (staff) and /api/account. Instants are epoch ms; dates are
// YYYY-MM-DD.
//
// Money: every amount is a number in minor units in a field named `*Minor`. For staff without the
// `money` capability (coaches) the API removes those fields, and empties `TodayDto.alerts.balancesDue`,
// so the app must check `me.can.money` before showing any of them.

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface WorkspaceSettingsDto {
  currency: string;
  timezone: string;
  locale: string;
  sport: string;
  paymentMethods: string[];
  noShowUsesCredit: boolean;
  lateCancelUsesCredit: boolean;
  lateCancelHours: number;
  defaultSessionMinutes: number;
  weekStartsOn: number;
  onboardedAt: number | null;
}

export interface MeDto {
  user: { id: string; name: string; email: string; image: string | null };
  workspace: { id: string; name: string };
  /** The caller's staff role in this workspace, and what it allows. */
  role: StaffRole;
  can: Capabilities;
  settings: WorkspaceSettingsDto;
  passkeyCount: number;
  hasSampleData: boolean;
  appEnv: string;
}

/** GET /api/account: who is signed in and where they belong (no workspace needed). */
export interface AccountDto {
  user: { id: string; name: string; email: string; image: string | null };
  passkeyCount: number;
  /** A Google account is linked (it signs in too). */
  hasGoogle: boolean;
  /**
   * A passkey-only account: its email is a placeholder (`u-…@passkey.coachman.invalid`) and means
   * nothing. It can link Google from the portal's settings, which replaces the placeholder.
   */
  emailIsPlaceholder: boolean;
  /** Academies where this person is staff, oldest first. */
  staff: {
    workspaceId: string;
    name: string;
    slug: string;
    role: StaffRole;
    logoKey: string | null;
  }[];
  /** Academies where this person is a student or a parent, with the students they're linked to. */
  family: {
    workspaceId: string;
    academyName: string;
    slug: string;
    logoKey: string | null;
    students: { clientId: string; firstName: string; lastName: string; relation: FamilyRelation }[];
  }[];
  /** The staff workspace /api/v1 acts in; null when not staff anywhere. */
  activeWorkspaceId: string | null;
}

export interface VenueDto {
  id: string;
  name: string;
  address: string | null;
  courtCount: number | null;
  notes: string | null;
}

// --- Academy, team, and coaches (WS2) -----------------------------------------------------------

/** GET/PATCH /api/v1/academy: the academy's identity and public profile. */
export interface AcademyDto {
  workspaceId: string;
  name: string;
  /** organization.slug; legacy `ws-<id>` slugs are not public addresses. */
  slug: string;
  /** `${APP_URL}/a/` (the address prefix the slug completes). */
  publicBaseUrl: string;
  /** `${APP_URL}/a/<slug>` when the slug is a real public address, else null. */
  publicUrl: string | null;
  tagline: string | null;
  about: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
  mapUrl: string | null;
  socials: Partial<Record<AcademySocial, string>>;
  /** Public R2 keys (`ws/<id>/public/…`): staff read them through /api/v1/files, anyone through /api/public/files. */
  logoKey: string | null;
  paymentInstructions: string | null;
  paymentQrKey: string | null;
  policies: string | null;
  enrollmentOpen: boolean;
  listed: boolean;
  updatedAt: number;
}

/** A staff member as pickers and avatars need them (GET /api/v1/coaches, current staff only). */
export interface CoachSummaryDto {
  userId: string;
  /** The coach profile's display name, else the account name. */
  name: string;
  title: string | null;
  photoKey: string | null;
  role: StaffRole;
}

/** GET/PATCH /api/v1/coaches/:userId (yourself, or anyone with `team`). */
export interface CoachProfileDto extends CoachSummaryDto {
  /** The name on the person's account (Google). */
  accountName: string;
  email: string;
  /** What they set; null = use the account name. */
  displayName: string | null;
  bio: string | null;
  certifications: string[];
  duprRating: number | null;
  specialties: string[];
  languages: string[];
  yearsCoaching: number | null;
  /** Shown on the academy's public page. */
  isPublic: boolean;
  sortOrder: number;
}

/** Someone who coached (or coaches) here, resolved for display even after they left the team. */
export interface CoachRefDto {
  userId: string;
  name: string;
  photoKey: string | null;
}

export interface TeamMemberDto extends CoachSummaryDto {
  accountName: string;
  /** Their sign-in email: for people with `team`, and for yourself; null otherwise. */
  email: string | null;
  /** When they joined the academy (epoch ms). */
  joinedAt: number;
  isPublic: boolean;
  /** Students they currently coach (primary or assistant). */
  students: number;
}

export interface StaffInviteDto {
  id: string;
  email: string;
  role: StaffRole;
  status: InviteStatus;
  createdAt: number;
  expiresAt: number;
  invitedBy: string | null;
}

/** GET /api/v1/team. Invites are listed only for roles with `team`. */
export interface TeamDto {
  members: TeamMemberDto[];
  invites: StaffInviteDto[];
}

/** POST /api/v1/team/invites: the link carries the only copy of the token; it is never shown again. */
export interface StaffInviteCreatedDto {
  invite: StaffInviteDto;
  link: string;
}

/** GET /api/invites/:token (public): just enough to say who invited whom, no other personal data. */
export interface InvitePreviewDto {
  kind: InviteKind;
  academy: { name: string; logoKey: string | null };
  role?: StaffRole;
  student?: { firstName: string };
  relation?: FamilyRelation;
  status: InviteStatus;
  /** Only when the request is signed in: whether this account's email is the one invited. */
  forYou?: boolean;
  /**
   * Only when the signed-in person is already on this academy's team (for example, they used the
   * link earlier): the page offers to open the academy instead.
   */
  alreadyMember?: boolean;
  workspaceId?: string;
  /**
   * Family invites, signed in only: this account already follows the invite's student (as a
   * parent or as the student), so the link isn't needed and accepting it changes nothing.
   */
  alreadyLinked?: boolean;
}

/** POST /api/invites/:token/accept. */
export type InviteAcceptedDto =
  | { kind: "staff"; workspaceId: string }
  | { kind: "family"; clientId: string; workspaceId: string };

// --- Family access (staff side, WS3) ------------------------------------------------------------

/** Why a family link can't be made (the age rules in src/shared/family.ts). */
export type FamilyRuleCode = "needs_birth_date" | "too_young" | "needs_guardian" | "not_a_minor";

export type FamilyRuleDto = { ok: true } | { ok: false; code: FamilyRuleCode; message: string };

/** Someone linked to a student in the family portal. */
export interface FamilyLinkDto {
  /** The client_access row (revoking takes this id). */
  id: string;
  name: string;
  /** Their Google email; null for a passkey-only account. */
  email: string | null;
  /** How they sign in: Google (maybe with passkeys too), or passkeys only. */
  signIn: "google" | "passkey";
  relation: FamilyRelation;
  /** When this access was granted (epoch ms). */
  since: number;
  /** Who granted it: the staff member or parent who made the invite. */
  grantedBy: string | null;
}

export interface FamilyInviteDto {
  id: string;
  relation: FamilyRelation;
  status: InviteStatus;
  createdAt: number;
  expiresAt: number;
  invitedBy: string | null;
}

/** GET /api/v1/clients/:id/family (`familyAccess`). */
export interface FamilyAccessDto {
  clientId: string;
  firstName: string;
  links: FamilyLinkDto[];
  /** Waiting links, and ones that expired in the last 30 days. */
  invites: FamilyInviteDto[];
  /** Whether each kind of invite can be made now, and if not, why. */
  rules: Record<FamilyRelation, FamilyRuleDto>;
}

/** POST /api/v1/clients/:id/family/invites: the link carries the only copy of the token. */
export interface FamilyInviteCreatedDto {
  invite: FamilyInviteDto;
  link: string;
}

export interface ClientCoachDto {
  id: string;
  coach: CoachRefDto;
  role: ClientCoachRole;
  startedOn: string;
  /** Null = current. */
  endedOn: string | null;
  assignedBy: CoachRefDto | null;
}

/** A student's coaches now, and who coached them when (newest first). */
export interface ClientCoachesDto {
  primary: ClientCoachDto | null;
  assistants: ClientCoachDto[];
  history: ClientCoachDto[];
}

/** PUT /api/v1/clients/:id/coaches. */
export interface ClientCoachesSavedDto {
  coaches: ClientCoachesDto;
  /** The primary coach changed: the app offers to write a handoff note. */
  primaryChanged: boolean;
  previousPrimary: CoachRefDto | null;
}

export interface PackageBalanceDto {
  id: string;
  name: string;
  creditsTotal: number;
  remaining: number;
  expiresOn: string | null;
  status: ClientPackageStatus;
  lessonKinds: LessonKind[];
  // Optional for profiles cached before package tiers (WS4a).
  purchasedOn?: string;
  /** The first local date it can pay for a session (its start month's first day, or purchase day). */
  startsOn?: string;
  /** Month-end packages: the calendar month it runs for (YYYY-MM). */
  startMonth?: string | null;
  /** Sold with the academy's training uniform (staff record the size and hand it out). */
  includesUniform?: boolean;
  uniformSize?: string | null;
  /** When the uniform was handed out (epoch ms); null while it's still owed. */
  uniformIssuedAt?: number | null;
}

export interface ClientListItemDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: ClientStatus;
  level: string | null;
  isJunior: boolean;
  photoKey: string | null;
  tags: string[];
  groupIds: string[];
  creditsRemaining: number;
  activePackages: number;
  balanceMinor: number;
  lastSeenOn: string | null;
  /** Credits bought on the current package(s): active ones, or used-up ones when none is active. */
  creditsTotal?: number;
  /** Nearest expiry among active packages that still have credits. */
  nextExpiryOn?: string | null;
  /** Start (epoch ms) of the next booked session that hasn't ended yet. */
  nextSessionAt?: number | null;
  joinedOn?: string | null;
  /** Current coaches (user ids); powers "My students". */
  primaryCoachUserId?: string | null;
  assistantCoachIds?: string[];
  /** Required consent documents still to sign (missing or needing a new signature). */
  consentsMissing?: number;
}

export interface ClientDto extends ClientListItemDto {
  birthDate: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  guardianEmail: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  duprId: string | null;
  duprRating: number | null;
  dominantHand: string | null;
  paddle: string | null;
  goals: string | null;
  medicalNotes: string | null;
  notes: string | null;
  source: string | null;
  joinedOn: string | null;
  createdAt: number;
}

export interface ClientDetailDto {
  client: ClientDto;
  groups: { id: string; name: string; color: string | null }[];
  packages: PackageBalanceDto[];
  upcoming: LessonSummaryDto[];
  recentAttendance: {
    lessonId: string;
    startsAt: number;
    title: string;
    kind: LessonKind;
    status: AttendanceStatus;
    packageName: string | null;
  }[];
  registrations: {
    id: string;
    eventId: string;
    eventName: string;
    status: RegistrationStatus;
    startsOn: string;
  }[];
  /** Optional for profiles cached before coaches existed. */
  coaches?: ClientCoachesDto;
}

export interface LedgerLineDto {
  id: string;
  clientPackageId: string;
  packageName: string;
  delta: number;
  reason: LedgerReason;
  note: string | null;
  lessonId: string | null;
  lessonTitle: string | null;
  lessonStartsAt: number | null;
  createdAt: number;
  runningRemaining: number;
}

export interface GroupDto {
  id: string;
  name: string;
  level: string | null;
  description: string | null;
  color: string | null;
  capacity: number | null;
  defaultRateId: string | null;
  defaultVenueId: string | null;
  memberCount: number;
  archivedAt: number | null;
  /** The program's lead coach and assistants. */
  coachUserId: string | null;
  assistantCoachIds: string[];
  // A group is a program the academy can publish on its public page (WS4a). Optional for groups
  // cached before then.
  isPublic?: boolean;
  /** Shown on the public page (the plain `description` stays internal). */
  publicDescription?: string | null;
  /** A label that overrides the weekly sessions' days and times, e.g. "Every Tue & Thu, 7–10pm". */
  scheduleNote?: string | null;
  ageMin?: number | null;
  ageMax?: number | null;
  /** Order on the public page (lowest first). */
  sortOrder?: number;
}

export interface GroupDetailDto {
  group: GroupDto;
  members: {
    clientId: string;
    firstName: string;
    lastName: string;
    creditsRemaining: number;
    joinedOn: string | null;
  }[];
  series: SeriesDto[];
  upcoming: LessonSummaryDto[];
}

export interface SeriesDto {
  id: string;
  kind: LessonKind;
  title: string | null;
  weekdays: number[];
  startTime: string;
  durationMinutes: number;
  startsOn: string;
  endsOn: string | null;
  venueId: string | null;
  court: string | null;
  active: boolean;
  coachUserId: string | null;
  assistantCoachIds: string[];
}

export interface RateDto {
  id: string;
  name: string;
  kind: RateKind;
  durationMinutes: number;
  priceMinor: number;
  unit: RateUnit;
  active: boolean;
}

export interface PackageTemplateDto {
  id: string;
  name: string;
  credits: number;
  lessonKinds: LessonKind[];
  priceMinor: number;
  validityDays: number | null;
  description: string | null;
  active: boolean;
  soldCount: number;
  // Tier fields (WS4a), as on a rates sheet. Optional for packages cached before then.
  /** The program (group) this tier belongs to. */
  programId?: string | null;
  /** A coach-specific tier. */
  coachUserId?: string | null;
  /** e.g. "4–6 sessions" when `credits` is the upper bound. */
  sessionsLabel?: string | null;
  validityMode?: ValidityMode;
  /** The checklist of what's included, in order. */
  inclusions?: string[];
  /** "Who it's for". */
  audience?: string | null;
  /** Recommended commitment, e.g. "Best over at least 2 months". */
  commitmentNote?: string | null;
  includesUniform?: boolean;
  /** Enrollment asks for a self-rating (saved to rating history as "self"). */
  asksSelfRating?: boolean;
  /** Shown on the public page and rates sheet (when also for sale and its program is public). */
  isPublic?: boolean;
  /** Emphasised on the public page. */
  highlight?: boolean;
  /** Order on the public page and in lists (lowest first). */
  sortOrder?: number;
}

export interface LessonSummaryDto {
  id: string;
  kind: LessonKind;
  title: string;
  startsAt: number;
  endsAt: number;
  venueId: string | null;
  venueName: string | null;
  court: string | null;
  groupId: string | null;
  eventId: string | null;
  status: LessonStatus;
  seriesId: string | null;
  bookedCount: number;
  checkedInCount: number;
  capacity: number | null;
  /** Lead coach and assistants (user ids). Reminders go to them; "My schedule" filters on them. */
  coachUserId: string | null;
  assistantCoachIds: string[];
}

export interface RosterEntryDto {
  attendanceId: string;
  clientId: string;
  firstName: string;
  lastName: string;
  photoKey: string | null;
  status: AttendanceStatus;
  version: number;
  consumedPackageId: string | null;
  complimentary: boolean;
  chargeId: string | null;
  chargeMinor: number | null;
  note: string | null;
  checkedInAt: number | null;
  /** Credits left on the package that pays (or would pay) for this attendance. */
  packageName: string | null;
  packageRemaining: number | null;
  packageCredits: number | null;
  /** All usable packages for this lesson kind, earliest expiry first. */
  usablePackages: { id: string; name: string; remaining: number; expiresOn: string | null }[];
  balanceMinor: number;
  isJunior: boolean;
  medicalFlag: boolean;
  /** Client-only: set while an offline/optimistic change is waiting to sync. */
  pending?: boolean;
}

export interface LessonDetailDto {
  lesson: LessonSummaryDto & {
    notes: string | null;
    rateId: string | null;
    priceMinor: number | null;
    effectivePriceMinor: number;
    cancelReason: string | null;
    completedAt: number | null;
    groupName: string | null;
    eventName: string | null;
    occurrenceDate: string | null;
  };
  roster: RosterEntryDto[];
  notes: NoteDto[];
}

export interface TodayDto {
  date: string;
  now: number;
  lessons: (LessonSummaryDto & { roster: RosterEntryDto[] })[];
  alerts: {
    lowCredits: { clientId: string; name: string; packageName: string; remaining: number }[];
    expiringPackages: {
      clientId: string;
      name: string;
      packageName: string;
      expiresOn: string;
      remaining: number;
    }[];
    balancesDue: { clientId: string; name: string; balanceMinor: number }[];
    birthdays: { clientId: string; name: string; age: number | null }[];
    /**
     * Uniforms sold with a package and not handed out yet (owners and admins; empty for coaches).
     * Optional for Today pages cached before WS4a.
     */
    uniforms?: {
      clientId: string;
      name: string;
      clientPackageId: string;
      packageName: string;
      uniformSize: string | null;
    }[];
  };
}

export interface OfflinePackDto {
  generatedAt: number;
  from: string;
  to: string;
  lessons: LessonDetailDto[];
}

export interface EventDto {
  id: string;
  kind: EventKind;
  name: string;
  description: string | null;
  startsOn: string;
  endsOn: string;
  venueId: string | null;
  capacity: number | null;
  priceMinor: number;
  earlyBirdPriceMinor: number | null;
  earlyBirdUntil: string | null;
  level: string | null;
  ageMin: number | null;
  ageMax: number | null;
  status: EventStatus;
  registeredCount: number;
  waitlistCount: number;
  paidMinor: number;
  dueMinor: number;
  coachUserId: string | null;
  assistantCoachIds: string[];
}

export interface EventDetailDto {
  event: EventDto;
  registrations: {
    id: string;
    clientId: string;
    firstName: string;
    lastName: string;
    status: RegistrationStatus;
    priceMinor: number;
    paidMinor: number;
    registeredAt: number;
    isJunior: boolean;
    note: string | null;
  }[];
  sessions: LessonSummaryDto[];
}

export interface ChargeDto {
  id: string;
  kind: ChargeKind;
  description: string;
  amountMinor: number;
  paidMinor: number;
  occurredOn: string;
  voidedAt: number | null;
  clientPackageId: string | null;
  attendanceId: string | null;
  registrationId: string | null;
}

/** A charge with its client, for workspace-wide lists (GET /charges?from&to). */
export interface ChargeListItemDto extends ChargeDto {
  clientId: string;
  clientName: string;
}

export interface PaymentDto {
  id: string;
  clientId: string;
  clientName: string;
  amountMinor: number;
  method: string;
  paidOn: string;
  reference: string | null;
  note: string | null;
  voidedAt: number | null;
}

export interface StatementDto {
  balanceMinor: number;
  charges: ChargeDto[];
  payments: PaymentDto[];
}

export interface MoneySummaryDto {
  month: string;
  chargedMinor: number;
  receivedMinor: number;
  outstandingMinor: number;
  byKind: { kind: ChargeKind; amountMinor: number }[];
  byMethod: { method: string; amountMinor: number }[];
  months: { month: string; chargedMinor: number; receivedMinor: number }[];
}

export interface BalanceDto {
  clientId: string;
  firstName: string;
  lastName: string;
  balanceMinor: number;
  oldestUnpaidOn: string | null;
}

export interface SkillDto {
  id: string;
  category: string;
  name: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
}

export interface AssessmentDto {
  id: string;
  assessedOn: string;
  overallLevel: string | null;
  notes: string | null;
  lessonId: string | null;
  scores: { skillId: string; score: number; note: string | null }[];
  /** Shown to the student and parents in the family portal (on by default). */
  sharedWithFamily: boolean;
  createdBy: string | null;
  author: CoachRefDto | null;
  createdAt: number;
}

export interface GoalDto {
  id: string;
  title: string;
  detail: string | null;
  targetDate: string | null;
  status: GoalStatus;
  achievedOn: string | null;
  createdAt: number;
  createdBy: string | null;
  author: CoachRefDto | null;
}

export interface RatingDto {
  id: string;
  source: RatingSource;
  value: number;
  recordedOn: string;
}

export interface NoteDto {
  id: string;
  clientId: string | null;
  lessonId: string | null;
  body: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  /** Who wrote it. Only they may change its text or visibility. */
  createdBy: string | null;
  author: CoachRefDto | null;
  /** `staff` = coaches only (default); `shared` = also the student and their parents. */
  visibility: NoteVisibility;
  /** Handoff notes are written when the primary coach changes; always coaches only. */
  kind: NoteKind;
  /** Set when the author changed the text or visibility. */
  editedAt: number | null;
  /** Client-only: set while waiting to sync. */
  pending?: boolean;
}

export interface ProgressDto {
  skills: SkillDto[];
  assessments: AssessmentDto[];
  goals: GoalDto[];
  ratings: RatingDto[];
  notes: NoteDto[];
}

export interface NotificationPrefDto {
  sessionReminderMinutes: number | null;
  dailyDigestTime: string | null;
  packageExpiryDays: number;
  subscriptions: number;
  vapidPublicKey: string | null;
}

export interface ImportResultDto {
  created: number;
  skipped: { row: number; reason: string }[];
}

// --- Family portal (/api/portal, WS3) -----------------------------------------------------------
//
// Family-safe shapes only, built by their own mappers (src/worker/lib/portal-dto.ts), never from a
// staff DTO: no coaches-only or handoff notes, unshared assessments, internal notes, tags, or
// sources, no other students, and no coach emails, phones, or user ids. Money fields are the
// family's own (their students' packages, charges, payments, and balance).

/** How an academy formats money, dates, and times: the portal never reads /api/v1/me. */
export interface PortalFormatDto {
  currency: string;
  timezone: string;
  locale: string;
  weekStartsOn: number;
}

export interface PortalAcademyRefDto extends PortalFormatDto {
  workspaceId: string;
  name: string;
  /** Public R2 key (`ws/<id>/public/…`): /api/portal/files or /api/public/files. */
  logoKey: string | null;
}

/** GET /api/portal/academies/:workspaceId (and each academy on the home page). */
export interface PortalAcademyDto extends PortalAcademyRefDto {
  /** `${APP_URL}/a/<slug>` when the academy has a public address, else null. */
  publicUrl: string | null;
  tagline: string | null;
  about: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
  mapUrl: string | null;
  socials: Partial<Record<AcademySocial, string>>;
  policies: string | null;
  paymentInstructions: string | null;
  paymentQrKey: string | null;
  /** Payment method names the academy accepts (cash, GCash, bank transfer…). */
  paymentMethods: string[];
}

/** A coach as families see them: name and photo, never an email, phone, or user id. */
export interface PortalCoachRefDto {
  name: string;
  /** Public R2 key (coach photos live under `ws/<id>/public/coaches/`). */
  photoKey: string | null;
}

/** One of a student's current coaches (GET /api/portal/students/:clientId). */
export interface PortalCoachDto extends PortalCoachRefDto {
  /** The assignment row, a stable key. */
  id: string;
  role: ClientCoachRole;
  /** The day they started coaching this student. */
  since: string;
  title: string | null;
  /** Shown only when the coach's profile is public. */
  bio: string | null;
  certifications: string[];
  specialties: string[];
  languages: string[];
  yearsCoaching: number | null;
}

export interface PortalSessionDto {
  id: string;
  /** The session's own title, else its program or event, else its kind. Never other players. */
  title: string;
  kind: LessonKind;
  startsAt: number;
  endsAt: number;
  status: LessonStatus;
  /** This student's attendance; null when they aren't on the roster. */
  attendance: AttendanceStatus | null;
  venue: { name: string; address: string | null } | null;
  court: string | null;
  coach: PortalCoachRefDto | null;
}

export interface PortalCreditsDto {
  /** Credits left on active packages that haven't expired. */
  remaining: number;
  /** Credits those packages started with. */
  total: number;
  /** The soonest expiry among them. */
  nextExpiryOn: string | null;
  activePackages: number;
}

/** A coach's comment the coach shared with the student and parents. */
export interface PortalCommentDto {
  id: string;
  clientId: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
  author: PortalCoachRefDto | null;
  /** The session it was written in, if any. */
  session: { title: string; startsAt: number } | null;
}

export interface PortalStudentRefDto {
  clientId: string;
  workspaceId: string;
  firstName: string;
  lastName: string;
  /** Private R2 key under the student's folder: /api/portal/files. */
  photoKey: string | null;
  /** How the signed-in person is linked: the student themself, or their parent. */
  relation: FamilyRelation;
  isJunior: boolean;
}

export interface PortalHomeStudentDto extends PortalStudentRefDto {
  nextSession: PortalSessionDto | null;
  credits: PortalCreditsDto;
  /** Charges minus payments (positive = owed). */
  balanceMinor: number;
  latestAssessment: {
    assessedOn: string;
    overallLevel: string | null;
    author: PortalCoachRefDto | null;
  } | null;
  /** Required consent forms still to sign for this student (optional for cached homes). */
  consentsMissing?: number;
}

/** Published news from the academy (filled by announcements, WS5). */
export interface PortalAnnouncementDto {
  id: string;
  workspaceId: string;
  title: string;
  body: string;
  pinned: boolean;
  publishedAt: number;
}

/** GET /api/portal/home: everything a family sees first. Empty lists when nothing is linked. */
export interface PortalHomeDto {
  user: { name: string; firstName: string };
  academies: PortalAcademyDto[];
  students: PortalHomeStudentDto[];
  /** The latest shared comments across the linked students, newest first. */
  comments: PortalCommentDto[];
  announcements: PortalAnnouncementDto[];
}

/** A parent's view of their teen's own login (only for guardians). */
export interface PortalTeenAccessDto {
  /** Whether a new "own login" link can be made now, and if not, why. */
  eligible: FamilyRuleDto;
  logins: { accessId: string; name: string; since: number }[];
  invites: { id: string; status: InviteStatus; createdAt: number; expiresAt: number }[];
}

/** GET /api/portal/students/:clientId. */
export interface PortalStudentDto {
  academy: PortalAcademyRefDto;
  student: PortalStudentRefDto & {
    birthDate: string | null;
    /** The overall level of the latest assessment shared with the family. */
    level: string | null;
    duprRating: number | null;
    dominantHand: string | null;
    shirtSize: string | null;
    phone: string | null;
    email: string | null;
    joinedOn: string | null;
  };
  /** Medical and emergency details: only ever for the family's own students. */
  safety: {
    medicalNotes: string | null;
    emergencyName: string | null;
    emergencyPhone: string | null;
    guardianName: string | null;
    guardianPhone: string | null;
  };
  coaches: PortalCoachDto[];
  programs: { name: string }[];
  /** Guardians only; null for the student's own login. */
  teenAccess: PortalTeenAccessDto | null;
}

/** GET /api/portal/students/:clientId/schedule?from&to. */
export interface PortalScheduleDto {
  academy: PortalAcademyRefDto;
  from: string;
  to: string;
  sessions: PortalSessionDto[];
}

export interface PortalAssessmentDto {
  id: string;
  assessedOn: string;
  overallLevel: string | null;
  notes: string | null;
  scores: { skillId: string; score: number; note: string | null }[];
  author: PortalCoachRefDto | null;
}

export interface PortalGoalDto {
  id: string;
  title: string;
  detail: string | null;
  targetDate: string | null;
  status: GoalStatus;
  achievedOn: string | null;
  author: PortalCoachRefDto | null;
}

/** GET /api/portal/students/:clientId/progress: shared assessments and comments only. */
export interface PortalProgressDto {
  academy: PortalAcademyRefDto;
  skills: { id: string; category: string; name: string; description: string | null }[];
  assessments: PortalAssessmentDto[];
  goals: PortalGoalDto[];
  ratings: { id: string; source: RatingSource; value: number; recordedOn: string }[];
  comments: PortalCommentDto[];
}

export interface PortalPackageDto {
  id: string;
  name: string;
  creditsTotal: number;
  remaining: number;
  purchasedOn: string;
  expiresOn: string | null;
  status: ClientPackageStatus;
}

export interface PortalChargeDto {
  id: string;
  kind: ChargeKind;
  description: string;
  amountMinor: number;
  paidMinor: number;
  occurredOn: string;
}

export interface PortalPaymentDto {
  id: string;
  amountMinor: number;
  method: string;
  paidOn: string;
  reference: string | null;
}

/** GET /api/portal/students/:clientId/money (voided entries left out). */
export interface PortalMoneyDto {
  academy: PortalAcademyRefDto;
  balanceMinor: number;
  packages: PortalPackageDto[];
  charges: PortalChargeDto[];
  payments: PortalPaymentDto[];
}

/** POST /api/portal/students/:clientId/teen-invite (guardians of 13–17 year olds). */
export interface PortalTeenInviteCreatedDto {
  invite: { id: string; status: InviteStatus; createdAt: number; expiresAt: number };
  link: string;
}

// --- Consents (WS4a) -----------------------------------------------------------------------------

/** GET /api/v1/consent-documents: the academy's consent documents (drafts are inactive). */
export interface ConsentDocumentDto {
  id: string;
  kind: ConsentKind;
  title: string;
  /** Plain text; blank lines separate paragraphs. */
  body: string;
  /** Goes up when the text changes after someone signed the current version. */
  version: number;
  required: boolean;
  appliesTo: ConsentAppliesTo;
  /** Off = a draft families don't see. */
  active: boolean;
  createdAt: number;
  updatedAt: number;
  /** Signatures of the current version. */
  signedCurrent: number;
  /** Signatures of any version (a document with signatures can't be deleted). */
  signedTotal: number;
}

/** A signature as staff see it: who signed, as what, which version, when. */
export interface ConsentSignatureDto {
  id: string;
  documentVersion: number;
  /** The typed name (or the name on the paper form). */
  signerName: string;
  relation: ConsentSignerRelation;
  signedAt: number;
  /** Paper signatures: the staff member who recorded it. */
  recordedBy: CoachRefDto | null;
}

/** One document for one student. */
export interface ClientConsentDto {
  document: {
    id: string;
    kind: ConsentKind;
    title: string;
    version: number;
    required: boolean;
    appliesTo: ConsentAppliesTo;
  };
  status: ConsentStatus;
  /** The signature the status rests on (the latest one that counts), if any. */
  signature: ConsentSignatureDto | null;
}

/** GET /api/v1/clients/:id/consents: the active documents that apply to the student. */
export interface ClientConsentsDto {
  clientId: string;
  firstName: string;
  /** Under 18 (or junior without a birth date): only a parent or guardian's signature counts. */
  minor: boolean;
  documents: ClientConsentDto[];
  /** Required documents still to sign. */
  missing: number;
}

/** A consent document in the family portal, with the text to read before signing. */
export interface PortalConsentDocumentDto {
  id: string;
  kind: ConsentKind;
  title: string;
  body: string;
  version: number;
  required: boolean;
  status: ConsentStatus;
  signature: {
    signerName: string;
    relation: ConsentSignerRelation;
    signedAt: number;
    documentVersion: number;
  } | null;
}

/** GET /api/portal/students/:clientId/consents. */
export interface PortalConsentsDto {
  academy: PortalAcademyRefDto;
  student: { clientId: string; firstName: string; minor: boolean };
  /** Whether the signed-in person may sign for this student, and as what. */
  signer:
    | { ok: true; relation: "guardian" | "self" }
    | { ok: false; code: "needs_guardian" | "adult_signs"; message: string };
  documents: PortalConsentDocumentDto[];
  missing: number;
}

// --- Public academy page (WS4a) ------------------------------------------------------------------
//
// GET /api/public/academies/:slug: what anyone may see of a listed academy. Built field by field
// (src/worker/lib/public-dto.ts) from published rows only: no clients, notes, internal
// descriptions, staff emails or phones, user ids, unpublished programs or tiers, or payment details.

/** A coach as the public page shows them (a profile they chose to make public). */
export interface PublicCoachDto {
  /** The coach profile's id (not the person's account id). */
  id: string;
  name: string;
  title: string | null;
  bio: string | null;
  /** Public R2 key (`ws/<id>/public/coaches/…`): /api/public/files. */
  photoKey: string | null;
  certifications: string[];
  specialties: string[];
  languages: string[];
  yearsCoaching: number | null;
  duprRating: number | null;
}

export interface PublicCoachRefDto {
  id: string;
  name: string;
  title: string | null;
  photoKey: string | null;
}

export interface PublicVenueDto {
  name: string;
  address: string | null;
}

/** A weekly session of a program, from its recurring series. */
export interface PublicWeeklySessionDto {
  /** 0 = Sunday … 6 = Saturday. */
  weekdays: number[];
  /** Local HH:MM in the academy's time zone. */
  startTime: string;
  durationMinutes: number;
  venue: PublicVenueDto | null;
}

/** A published program (a public training group). */
export interface PublicProgramDto {
  id: string;
  name: string;
  /** The program's public description (never its internal one). */
  description: string | null;
  level: string | null;
  ageMin: number | null;
  ageMax: number | null;
  capacity: number | null;
  /** A label the academy wrote, e.g. "Every Tue & Thu, 7–10pm"; shown instead of `schedule`. */
  scheduleNote: string | null;
  /** The program's weekly series that are running. */
  schedule: PublicWeeklySessionDto[];
  /** Its default venue. */
  venue: PublicVenueDto | null;
  /** Lead coach first; only coaches with public profiles. */
  coaches: PublicCoachRefDto[];
  /** Start of its next scheduled session (epoch ms), if any. */
  nextSessionAt: number | null;
}

/** A published package tier with its price per head. */
export interface PublicPackageDto {
  id: string;
  /** Its program, when the tier belongs to one (always a published program). */
  programId: string | null;
  name: string;
  priceMinor: number;
  /** Sessions it pays for (the upper bound of `sessionsLabel`). */
  credits: number;
  sessionsLabel: string | null;
  validityMode: ValidityMode;
  /** Days-based tiers only. */
  validityDays: number | null;
  inclusions: string[];
  audience: string | null;
  commitmentNote: string | null;
  includesUniform: boolean;
  asksSelfRating: boolean;
  highlight: boolean;
  /** A coach-specific tier, when that coach's profile is public. */
  coach: PublicCoachRefDto | null;
}

/** A consent families sign when they enroll (titles here; texts from …/consents). */
export interface PublicConsentRefDto {
  id: string;
  kind: ConsentKind;
  title: string;
  version: number;
  appliesTo: ConsentAppliesTo;
}

export interface PublicConsentDocumentDto extends PublicConsentRefDto {
  body: string;
}

export interface PublicAcademyDto {
  slug: string;
  name: string;
  tagline: string | null;
  about: string | null;
  /** Public R2 keys: /api/public/files. */
  logoKey: string | null;
  coverKey: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
  mapUrl: string | null;
  socials: Partial<Record<AcademySocial, string>>;
  policies: string | null;
  enrollmentOpen: boolean;
  /** How the academy formats prices, dates, and times. */
  currency: string;
  locale: string;
  timezone: string;
  weekStartsOn: number;
  /** In the academy's order. */
  programs: PublicProgramDto[];
  /** Published tiers, in the academy's order (grouped by `programId` on the page). */
  packages: PublicPackageDto[];
  coaches: PublicCoachDto[];
  /** Active, required consent documents (titles; the enrollment wizard reads the texts). */
  consents: PublicConsentRefDto[];
  /** Today in the academy's time zone (YYYY-MM-DD), for "as of" lines and start months. */
  today: string;
  updatedAt: number;
}

/** GET /api/v1/academy/public-preview: the same page for staff, also while it isn't listed. */
export interface PublicAcademyPreviewDto extends PublicAcademyDto {
  listed: boolean;
  /** `${APP_URL}/a/<slug>`, or null without a public address yet. */
  publicUrl: string | null;
}
