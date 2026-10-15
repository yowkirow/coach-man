import type {
  AttendanceStatus,
  ChargeKind,
  ClientPackageStatus,
  ClientStatus,
  EventKind,
  EventStatus,
  GoalStatus,
  LedgerReason,
  LessonKind,
  LessonStatus,
  RateKind,
  RateUnit,
  RatingSource,
  RegistrationStatus,
} from "./domain";

// Response shapes returned by /api/v1. Instants are epoch ms; dates are YYYY-MM-DD.

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
  settings: WorkspaceSettingsDto;
  passkeyCount: number;
  hasSampleData: boolean;
  appEnv: string;
}

export interface VenueDto {
  id: string;
  name: string;
  address: string | null;
  courtCount: number | null;
  notes: string | null;
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
}

export interface GoalDto {
  id: string;
  title: string;
  detail: string | null;
  targetDate: string | null;
  status: GoalStatus;
  achievedOn: string | null;
  createdAt: number;
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
