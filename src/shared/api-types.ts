import type { AnnouncementState } from "./announcements";
import type { ConsentStatus } from "./consents";
import type {
  AcademySocial,
  AnnouncementAudience,
  AttendanceStatus,
  ChargeKind,
  ClientCoachRole,
  ClientPackageStatus,
  ClientStatus,
  ConsentAppliesTo,
  ConsentKind,
  ConsentSignerRelation,
  EnrollmentStatus,
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
  PaymentSubmissionStatus,
  RateKind,
  RateUnit,
  RatingSource,
  RegistrationStatus,
  ValidityMode,
} from "./domain";
import type { EnrollmentMode } from "./enrollment";
import type { FamilyPrefs } from "./notifications";
import type { Capabilities, StaffRole } from "./roles";
import type { SafetyEditor, SafetyRights } from "./safety";

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
  /** The big photo on the academy's website (landscape, at most 1800 px on its long side). */
  coverKey: string | null;
  paymentInstructions: string | null;
  paymentQrKey: string | null;
  policies: string | null;
  enrollmentOpen: boolean;
  listed: boolean;
  updatedAt: number;
}

/**
 * GET /api/v1/academy/photos (everyone on the team; changes take `settings`): a photo on the
 * academy's website, in the academy's order.
 */
export interface AcademyPhotoDto {
  id: string;
  /** Public R2 key (`ws/<id>/public/photos/…`). */
  key: string;
  /** The line under the photo, or null. */
  caption: string | null;
  sortOrder: number;
  createdAt: number;
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
  /** The half-body team page photo, cropped 4:5 (a public key, like `photoKey`). */
  portraitKey: string | null;
  /** Tournament results, titles, and milestones, in the order written. */
  highlights: string[];
  /** Shown on the academy's public pages (the academy page and its team page). */
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

// --- The team page (staff side) -----------------------------------------------------------------
//
// The academy's public team page shows staff coach profiles and display-only people (people the
// academy shows who don't sign in) in one order the academy sets. Owners and admins (`team`)
// manage it through /api/v1/team-page.

/** A display-only person on the team page (GET/PATCH /api/v1/team-page/people/:id). */
export interface TeamPersonDto {
  id: string;
  name: string;
  title: string | null;
  bio: string | null;
  /** The half-body team page photo, cropped 4:5 (a public key under `ws/<id>/public/coaches/`). */
  portraitKey: string | null;
  certifications: string[];
  /** Tournament results, titles, and milestones, in the order written. */
  highlights: string[];
  duprRating: number | null;
  specialties: string[];
  languages: string[];
  yearsCoaching: number | null;
  /** Shown on the team page. */
  isPublic: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** Someone on the team page: a staff member (by user id) or a display-only person (by id). */
export type TeamPageEntryDto =
  | {
      kind: "staff";
      userId: string;
      name: string;
      title: string | null;
      role: StaffRole;
      /** The square photo. */
      photoKey: string | null;
      portraitKey: string | null;
      /** Their coach profile is public. */
      isPublic: boolean;
      sortOrder: number;
    }
  | {
      kind: "listed";
      id: string;
      name: string;
      title: string | null;
      /** Display-only people have only the team page photo. */
      photoKey: null;
      portraitKey: string | null;
      isPublic: boolean;
      sortOrder: number;
    };

/** GET /api/v1/team-page (and PUT /api/v1/team-page/order): everyone, in the page's order. */
export interface TeamPageDto {
  entries: TeamPageEntryDto[];
  /** The academy's public pages are listed (under a real public address). */
  listed: boolean;
  /** organization.slug: the team page is `/a/<slug>/team` (legacy `ws-…` slugs aren't public). */
  slug: string;
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
  /** Training shirt size (optional for profiles cached before WS5a). */
  shirtSize?: string | null;
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
  /** Authorized pickup people (optional for profiles cached before WS5a). */
  pickups?: PickupDto[];
  /** The last change to the health and emergency details, when known. */
  safetyUpdate?: SafetyUpdateDto | null;
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
  /**
   * What a coach needs at the court: the medical note itself, the contacts, and for juniors who
   * may pick them up (optional for rosters cached before WS5a).
   */
  safety?: RosterSafetyDto;
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
    /**
     * Owners and admins (`enrollment`): requests waiting in the inbox, and in the month's last
     * week the students who haven't renewed (null outside it). Absent for coaches and for Today
     * pages cached before WS4b.
     */
    enrollments?: { requested: number; notRenewed: number | null };
  };
  /** Live announcements, pinned first then newest (every staff role reads them; WS5a). */
  announcements?: AnnouncementDto[];
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
  /** Owners and admins: new enrollment requests and payment proofs (optional for old caches). */
  enrollmentAlerts?: boolean;
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

/** Published news from the academy (announcements, WS5a). */
export interface PortalAnnouncementDto {
  id: string;
  workspaceId: string;
  title: string;
  body: string;
  pinned: boolean;
  publishedAt: number;
  /** Who it's for, and the program's or event's name (optional for homes cached before WS5a). */
  audience?: AnnouncementAudience;
  audienceName?: string | null;
  expiresAt?: number | null;
}

/** GET /api/portal/home: everything a family sees first. Empty lists when nothing is linked. */
export interface PortalHomeDto {
  user: { name: string; firstName: string };
  academies: PortalAcademyDto[];
  students: PortalHomeStudentDto[];
  /** The latest shared comments across the linked students, newest first. */
  comments: PortalCommentDto[];
  announcements: PortalAnnouncementDto[];
  /**
   * Enrollment requests of the linked students: open ones, and ones decided in the last 60 days
   * (optional for homes cached before WS4b).
   */
  enrollments?: PortalEnrollmentDto[];
  /** Students who can renew their month-end package for next month. */
  renewals?: PortalRenewalDto[];
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
    /**
     * Whether the academy has a parent's email on file. The address itself never goes to the
     * portal (one guardian email serves every parent of the student); a parent can replace it.
     */
    guardianEmailOnFile?: boolean;
  };
  coaches: PortalCoachDto[];
  programs: { name: string }[];
  /** Guardians only; null for the student's own login. */
  teenAccess: PortalTeenAccessDto | null;
  /** Authorized pickup people (juniors; optional for students cached before WS5a). */
  pickups?: PickupDto[];
  /** Whether pickup people apply to this student (under 18, or marked junior). */
  pickupsApply?: boolean;
  /** What the signed-in person may change here (a teen's own login: nothing). */
  editable?: SafetyRights;
  /** When the health and emergency details last changed, and whether by the viewer or the academy. */
  safetyUpdate?: PortalSafetyUpdateDto | null;
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
  /**
   * A team page person: the coach profile's id for staff (not the person's account id), or the
   * display-only profile's id for people the academy adds who don't sign in.
   */
  id: string;
  name: string;
  title: string | null;
  bio: string | null;
  /** Public R2 key (`ws/<id>/public/coaches/…`): /api/public/files. A square photo; staff only. */
  photoKey: string | null;
  /** Public R2 key of the half-body team page photo, cropped 4:5 (`ws/<id>/public/…`). */
  portraitKey: string | null;
  certifications: string[];
  /** Tournament results, titles, and milestones, in the order written. */
  highlights: string[];
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
  /** The program's lead coach (the rest assist). Hidden profiles are left out, lead included. */
  lead: boolean;
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

/** A photo on the academy's website (courts, sessions, camps), in the academy's order. */
export interface PublicAcademyPhotoDto {
  id: string;
  /** Public R2 key (`ws/<id>/public/photos/…`): /api/public/files. */
  key: string;
  /** A short line under the photo, or null. */
  caption: string | null;
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
  /** The website photos, in the academy's order (none until the academy uploads some). */
  photos: PublicAcademyPhotoDto[];
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

// --- Enrollment (WS4b) ---------------------------------------------------------------------------
//
// A family asks to join a tier from the academy page (or the portal's Enroll page); the academy
// approves, waitlists, or declines it from its Enrollments inbox. Approving sells the tier (the
// charge is created), adds the student to the program or books the trial session, and makes a
// new student active.

/**
 * A session of a public program a family can pick for a trial (GET
 * /api/public/academies/:slug/programs/:programId/sessions). Never who's booked on it.
 */
export interface PublicSessionDto {
  /** The session (lesson) id, sent back when enrolling. */
  id: string;
  /** Local date in the academy's time zone. */
  date: string;
  startsAt: number;
  endsAt: number;
  venue: PublicVenueDto | null;
  court: string | null;
  /** Places left (its own capacity, else the program's); null = no limit. */
  seatsLeft: number | null;
}

/** What's owed for an approved request: its charge and how much of it payments cover. */
export interface EnrollmentPaymentDto {
  /** The charge approving made (null when the tier was free). */
  chargeId: string | null;
  amountMinor: number;
  paidMinor: number;
  dueMinor: number;
  status: "unpaid" | "partial" | "paid";
}

/** Who the family said may pick a junior up (authorized_pickup rows). */
export interface EnrollmentPickupDto {
  id: string;
  name: string;
  relationship: string | null;
  phone: string | null;
}

/** A student the signed-in person can choose in the wizard's first step. */
export interface EnrollStudentChoiceDto {
  clientId: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  minor: boolean;
  relation: FamilyRelation;
  /** Whether this person may enroll the student, and if not, why. */
  allowed: { ok: true } | { ok: false; code: string; message: string };
  /** Consent documents this student already signed (current version, by someone who counts). */
  signedDocumentIds: string[];
  /** What the academy has on file, to start the details step from. */
  details: {
    phone: string | null;
    medicalNotes: string | null;
    emergencyName: string | null;
    emergencyPhone: string | null;
    shirtSize: string | null;
  };
}

/**
 * GET /api/portal/enrollment-context?slug=: who the signed-in person can enroll at a listed
 * academy, and what they already asked for there.
 */
export interface EnrollmentContextDto {
  workspaceId: string;
  slug: string;
  academyName: string;
  /** New students can enroll (current ones can always renew or add a tier). */
  enrollmentOpen: boolean;
  today: string;
  account: {
    name: string;
    emailIsPlaceholder: boolean;
    hasPasskey: boolean;
    hasGoogle: boolean;
  };
  /** A teen's own login: a parent or guardian enrolls them. */
  blocked: { code: string; message: string } | null;
  /** Their own student record here (a `self` link), if any. */
  self: EnrollStudentChoiceDto | null;
  /** Students they're a parent or guardian of here. */
  children: EnrollStudentChoiceDto[];
  /** Open and approved requests of those students, to catch a repeat before it's sent. */
  requests: {
    clientId: string;
    packageId: string | null;
    startMonth: string | null;
    lessonId: string | null;
    status: EnrollmentStatus;
  }[];
}

/** A request as the family sees it (the portal's home, a student's Payments page). */
export interface PortalEnrollmentDto {
  id: string;
  clientId: string;
  workspaceId: string;
  student: { firstName: string; lastName: string };
  tier: {
    name: string;
    sessionsLabel: string | null;
    credits: number | null;
    validityMode: ValidityMode | null;
    /** The tier's price now (what approving charges). */
    priceMinor: number | null;
  };
  programName: string | null;
  mode: EnrollmentMode;
  startMonth: string | null;
  startDate: string | null;
  session: {
    startsAt: number;
    endsAt: number;
    venue: string | null;
    court: string | null;
  } | null;
  status: EnrollmentStatus;
  createdAt: number;
  decidedAt: number | null;
  /** The academy's words for the family: why it was declined, or a waitlist note. */
  note: string | null;
  /** Still requested or waitlisted, and the caller may withdraw it. */
  canCancel: boolean;
  /** It renews a month-end package. */
  renewal: boolean;
  /** Approved: what it charged and what's still due. */
  payment: EnrollmentPaymentDto | null;
  /**
   * Payment proofs sent for this request, newest first (WS4c; optional for requests cached
   * before, and absent where proofs aren't loaded: the answer to sending or cancelling a request).
   */
  proofs?: PortalPaymentProofDto[];
}

/** "Renew for next month" for one student (the portal's home and Payments page). */
export interface PortalRenewalDto {
  clientId: string;
  workspaceId: string;
  student: { firstName: string; lastName: string };
  tierName: string;
  packageId: string;
  startMonth: string;
  expiresOn: string;
  priceMinor: number;
  /** Required forms to sign (or sign again) before renewing. */
  consents: PortalConsentDocumentDto[];
  /** Whether the caller may renew (a parent for a minor, the student as an adult). */
  allowed: { ok: true } | { ok: false; code: string; message: string };
}

/** GET /api/portal/students/:clientId/enrollments. */
export interface PortalStudentEnrollmentsDto {
  academy: PortalAcademyRefDto;
  requests: PortalEnrollmentDto[];
  renewal: PortalRenewalDto | null;
}

/** POST /api/portal/enrollments (and …/renew): the request made, and the student it's for. */
export interface EnrollmentSubmittedDto {
  request: PortalEnrollmentDto;
  clientId: string;
  /** The request made a new student (a `lead` until approved). */
  newStudent: boolean;
  /** A retried send: this request already existed. */
  replay: boolean;
}

/** GET /api/portal/enroll: tiers of the academies the person's students train at. */
export interface PortalEnrollAcademyDto {
  workspaceId: string;
  name: string;
  slug: string;
  logoKey: string | null;
  /** Enrolling goes through the academy's public page, so it must be listed. */
  listed: boolean;
  enrollmentOpen: boolean;
  contactPhone: string | null;
  contactEmail: string | null;
  /** The academy page's programs and tiers (null when the page isn't listed). */
  page: PublicAcademyDto | null;
}

/** The staff inbox's list (GET /api/v1/enrollments?status=), newest first. */
export interface EnrollmentListItemDto {
  id: string;
  status: EnrollmentStatus;
  createdAt: number;
  decidedAt: number | null;
  student: {
    clientId: string;
    firstName: string;
    lastName: string;
    /** The request made this student (still a lead). */
    isNew: boolean;
    minor: boolean;
  };
  submitter: { name: string; relation: FamilyRelation | null };
  tierName: string;
  programName: string | null;
  mode: EnrollmentMode;
  startMonth: string | null;
  startDate: string | null;
  sessionStartsAt: number | null;
  renewal: boolean;
  /** Payment proofs for this request waiting for review (WS4c; optional for cached lists). */
  proofsPending?: number;
}

export interface EnrollmentListDto {
  counts: Record<EnrollmentStatus, number>;
  items: EnrollmentListItemDto[];
}

/** GET /api/v1/enrollments/:id: everything staff need to decide a request. */
export interface EnrollmentDetailDto {
  id: string;
  status: EnrollmentStatus;
  createdAt: number;
  decidedAt: number | null;
  decidedBy: CoachRefDto | null;
  /** Why it was declined, or the waitlist note (both shown to the family). */
  decisionNote: string | null;
  renewal: boolean;
  student: {
    clientId: string;
    firstName: string;
    lastName: string;
    birthDate: string | null;
    age: number | null;
    minor: boolean;
    status: ClientStatus;
    /** Made by this request (a lead): it can be matched to someone already training here. */
    isNew: boolean;
    phone: string | null;
    email: string | null;
    guardianName: string | null;
    guardianPhone: string | null;
  };
  submitter: {
    name: string;
    /** Their sign-in address (null for passkey-only accounts). */
    email: string | null;
    relation: FamilyRelation | null;
    signIn: "google" | "passkey";
  };
  tier: {
    id: string;
    name: string;
    priceMinor: number;
    credits: number;
    sessionsLabel: string | null;
    validityMode: ValidityMode;
    validityDays: number | null;
    includesUniform: boolean;
    asksSelfRating: boolean;
    inclusions: string[];
    /** Still for sale (an inactive tier can't be approved). */
    active: boolean;
  } | null;
  program: {
    id: string;
    name: string;
    capacity: number | null;
    members: number;
    ageMin: number | null;
    ageMax: number | null;
  } | null;
  mode: EnrollmentMode;
  period: {
    startMonth: string | null;
    startDate: string | null;
    /** The validity approving would give (month-end and date modes). */
    startsOn: string | null;
    expiresOn: string | null;
    session: {
      lessonId: string;
      startsAt: number;
      endsAt: number;
      venueName: string | null;
      court: string | null;
      status: LessonStatus;
      capacity: number | null;
      booked: number;
    } | null;
  };
  answers: {
    selfRating: number | null;
    selfRatingUnsure: boolean;
    shirtSize: string | null;
    phone: string | null;
    email: string | null;
    medicalNotes: string | null;
    emergencyName: string | null;
    emergencyPhone: string | null;
    notes: string | null;
  };
  pickups: EnrollmentPickupDto[];
  /** Consents signed with this request. */
  consents: {
    documentId: string;
    title: string;
    version: number;
    signerName: string;
    relation: ConsentSignerRelation;
    signedAt: number;
  }[];
  /** Required documents the student still has to sign (if any were added since). */
  consentsMissing: number;
  /** Room in the program (or on the session) if this is approved. */
  capacity: {
    kind: "program" | "session";
    capacity: number | null;
    taken: number;
    left: number | null;
    over: boolean;
    alreadyIn: boolean;
  } | null;
  /** The student's age is outside the program's ages. */
  ageNote: string | null;
  /** Approved: the charge and how much of it is paid. */
  payment: EnrollmentPaymentDto | null;
  /** Payment proofs the family sent for this request, newest first (WS4c). */
  proofs?: PaymentProofDto[];
  created: { clientPackageId: string | null; chargeId: string | null };
  /** New students: people already training here who may be the same person. */
  matches: {
    clientId: string;
    firstName: string;
    lastName: string;
    birthDate: string | null;
    phone: string | null;
    status: ClientStatus;
  }[];
  /** What approving can pick instead of the request's own choice. */
  options: {
    startMonths: { month: string; expiresOn: string }[];
    sessions: { lessonId: string; startsAt: number; endsAt: number; seatsLeft: number | null }[];
  };
  /** Set by approve: things staff were told but that didn't stop it (over capacity). */
  warnings?: string[];
}

/** One student whose month-end package ends this month with nothing booked for next month. */
export interface RenewalDueDto {
  clientId: string;
  firstName: string;
  lastName: string;
  minor: boolean;
  tierName: string;
  packageId: string;
  clientPackageId: string;
  expiresOn: string;
  /** Who to message: the student, or for a junior their parent (as on file). */
  contactName: string | null;
  contactPhone: string | null;
}

/** GET /api/v1/enrollments/renewals: "Not yet renewed" (owners and admins). */
export interface RenewalsDueDto {
  academyName: string;
  today: string;
  nextMonth: string;
  /** `${APP_URL}/my`: where families renew in one tap. */
  portalUrl: string;
  items: RenewalDueDto[];
}

/** GET /api/v1/enrollments/count: the inbox badge. */
export interface EnrollmentCountDto {
  requested: number;
}

// --- Payment proofs (WS4c) -----------------------------------------------------------------------
//
// Families pay outside CoachMan and send a screenshot (or say they'll pay cash at the court);
// owners and admins confirm it, which records a payment through the money service, or don't
// accept it with a reason the family reads.

/** Another proof or payment of the academy that looks like the same money. */
export interface ProofDuplicateDto {
  kind: "proof" | "payment";
  id: string;
  /** The same reference number, or the same student, amount, and date. */
  reason: "reference" | "same_details";
  clientId: string;
  clientName: string;
  amountMinor: number;
  method: string;
  paidOn: string;
  reference: string | null;
  /** A proof's status, or "recorded" for a payment. */
  status: PaymentSubmissionStatus | "recorded";
}

/** A payment proof as owners and admins review it (GET /api/v1/payment-proofs and friends). */
export interface PaymentProofDto {
  id: string;
  status: PaymentSubmissionStatus;
  createdAt: number;
  student: {
    clientId: string;
    firstName: string;
    lastName: string;
    photoKey: string | null;
    /** The student's balance now (charges minus payments; positive = owed). */
    balanceMinor: number;
  };
  /** Who sent it: a parent or the student, with their sign-in address (null for passkey-only). */
  submitter: { name: string; email: string | null; relation: FamilyRelation | null };
  amountMinor: number;
  method: string;
  reference: string | null;
  paidOn: string;
  /** The family's own note. */
  note: string | null;
  /**
   * The screenshot, a private key under the student's `payments/` folder (staff read it through
   * /api/v1/files with `money` or `enrollment`). Null when they'll pay cash at the court.
   */
  proofKey: string | null;
  /** The approved request it pays, with that request's charge and what's still due. */
  enrollment: {
    id: string;
    tierName: string;
    mode: EnrollmentMode;
    startMonth: string | null;
    startDate: string | null;
    sessionStartsAt: number | null;
    status: EnrollmentStatus;
    payment: EnrollmentPaymentDto | null;
  } | null;
  reviewedBy: CoachRefDto | null;
  reviewedAt: number | null;
  /** Why it wasn't accepted (the family reads it). */
  rejectReason: string | null;
  /** The payment confirming it recorded (struck through once voided). */
  payment: {
    id: string;
    amountMinor: number;
    method: string;
    paidOn: string;
    reference: string | null;
    voidedAt: number | null;
  } | null;
  /** The proof this one sends again, after the academy didn't accept it. */
  resubmitOf: { id: string; rejectReason: string | null; createdAt: number } | null;
  /** A newer proof that sends this one again. */
  resubmittedBy: string | null;
  /** Proofs and payments that may be the same money (pending and voided proofs only). */
  duplicates: ProofDuplicateDto[];
}

/** GET /api/v1/payment-proofs?status=: the list, with how many there are in each status. */
export interface PaymentProofListDto {
  counts: Record<PaymentSubmissionStatus, number>;
  items: PaymentProofDto[];
}

/** GET /api/v1/payment-proofs/count: the Money badge. */
export interface PaymentProofCountDto {
  pending: number;
}

/** A payment proof as the family sees it: never who reviewed it, or staff notes. */
export interface PortalPaymentProofDto {
  id: string;
  clientId: string;
  workspaceId: string;
  /** The enrollment request it pays, if it was sent from one. */
  enrollmentId: string | null;
  amountMinor: number;
  method: string;
  reference: string | null;
  paidOn: string;
  note: string | null;
  /** The screenshot (/api/portal/files), or null for cash at the court. */
  proofKey: string | null;
  status: PaymentSubmissionStatus;
  createdAt: number;
  /** When the academy confirmed it or didn't accept it. */
  decidedAt: number | null;
  /** Why the academy didn't accept it. */
  rejectReason: string | null;
  /** What the academy recorded when it confirmed (it may differ from what was sent). */
  recorded: { amountMinor: number; paidOn: string } | null;
  sentBy: { name: string; you: boolean };
  /** Pending, and the caller sent it. */
  canWithdraw: boolean;
  /** It sends again a proof the academy didn't accept. */
  resubmitOf: string | null;
  /** A newer proof sends this one again. */
  resubmitted: boolean;
}

/** GET /api/portal/students/:clientId/payment-proofs. */
export interface PortalPaymentProofsDto {
  academy: PortalAcademyRefDto;
  proofs: PortalPaymentProofDto[];
}

// --- Kids' safety, announcements, and public pages (WS5a) ----------------------------------------

/**
 * An authorized pickup person: who may collect a junior after training. Never who added them (no
 * user ids): the same shape goes to staff and to the student's family.
 */
export interface PickupDto {
  id: string;
  name: string;
  relationship: string | null;
  phone: string | null;
  notes: string | null;
  /**
   * Private R2 key `ws/<id>/clients/<clientId>/pickups/<uuid>.<ext>`: staff read it through
   * /api/v1/files, the student's family through /api/portal/files (checked against this row).
   */
  photoKey: string | null;
  updatedAt: number;
}

/** Staff: who last changed a student's health and emergency details, and when. */
export interface SafetyUpdateDto {
  at: number;
  /** As a parent or guardian or the student (family portal), or as academy staff. */
  relation: SafetyEditor;
  /** The person's name (null when their account is gone). */
  byName: string | null;
}

/** Family: when the details last changed, and whether it was the viewer or the academy. */
export interface PortalSafetyUpdateDto {
  at: number;
  byYou: boolean;
  byAcademy: boolean;
}

/** A roster entry's safety details: what a coach needs at the court. */
export interface RosterSafetyDto {
  /** Under 18 by birth date, or marked junior: pickup people apply. */
  junior: boolean;
  medicalNotes: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  /** Juniors only (empty for adults). */
  pickups: PickupDto[];
}

/** An announcement as staff see it (the composer, the list's tabs, and Today). */
export interface AnnouncementDto {
  id: string;
  title: string;
  /** Plain text: paragraphs (a blank line) and links are shown, never HTML. */
  body: string;
  audience: AnnouncementAudience;
  /** The program (group) or event it's for. */
  audienceId: string | null;
  /** That program's or event's name (null for everyone, or when it no longer exists). */
  audienceName: string | null;
  pinned: boolean;
  /** Null while a draft; ahead of now while scheduled. */
  publishedAt: number | null;
  expiresAt: number | null;
  state: AnnouncementState;
  /** When it went live and the publish hook ran (null until then). */
  notifiedAt: number | null;
  author: CoachRefDto | null;
  createdAt: number;
  updatedAt: number;
}

/** GET /api/v1/announcements?status=. */
export interface AnnouncementListDto {
  /** The server's clock, so "goes live in…" reads right on a phone whose clock is off. */
  now: number;
  counts: Record<AnnouncementState, number>;
  items: AnnouncementDto[];
}

/** GET /api/portal/announcements: everything live for the caller's students, pinned first. */
export interface PortalAnnouncementsDto {
  academies: PortalAcademyRefDto[];
  items: PortalAnnouncementDto[];
}

/** GET /api/public/config: what the public pages need from the server's settings. */
export interface PublicConfigDto {
  /** Where people write about privacy, their data, or the terms (`PUBLIC_CONTACT_EMAIL`). */
  contactEmail: string;
}

// --- WS5b: family reminders (push for students and parents) ----------------------------------

/** The family portal's notification settings (see src/shared/notifications.ts for the rules). */
export type FamilyNotificationPrefsDto = FamilyPrefs;

/** GET /api/portal/notifications (also the answer to saving them). */
export interface FamilyNotificationsDto {
  prefs: FamilyNotificationPrefsDto;
  /** Null when push isn't set up on this server. */
  vapidPublicKey: string | null;
  /** Devices that get this person's family notifications. */
  devices: number;
  /** Quiet hours and the evening-before reminder use this academy time zone. */
  timezone: string;
  /** "Get reminders on this phone" on Home was dismissed (or the settings were opened). */
  promptDismissed: boolean;
  /** The person is also staff somewhere (coach notifications are set in the staff app). */
  staff: boolean;
}

/** Which surfaces a device (this browser's push endpoint) gets notifications for. */
export interface PushDeviceStateDto {
  staff: boolean;
  family: boolean;
}

/** POST …/test: how many devices the test went to. */
export interface PushTestResultDto {
  delivered: number;
}
