import type {
  AcademySocial,
  AttendanceStatus,
  ChargeKind,
  ClientCoachRole,
  ClientPackageStatus,
  ClientStatus,
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
}

/** POST /api/invites/:token/accept. */
export type InviteAcceptedDto =
  | { kind: "staff"; workspaceId: string }
  | { kind: "family"; clientId: string };

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
