import type { EnrollmentStatus, FamilyRelation, ValidityMode } from "./domain";
import { ADULT_AGE, isMinor } from "./family";
import { addDays, ageOn, compareDates, DATE_RE, daysBetween } from "./time";
import { addMonths, firstDayOf, lastDayOf, MONTH_RE, monthOf, startMonthChoices } from "./validity";

// Enrollment: a family asks to join a tier (a package template on the academy page), the academy
// approves, waitlists, or declines it. Everything here is pure so the Worker, the app, and the
// unit tests share one set of rules.

// --- Status ------------------------------------------------------------------------------------

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  requested: "Requested",
  waitlisted: "Waitlisted",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
};

/** Requests still waiting on the academy: the family may cancel them, staff may decide them. */
export const OPEN_ENROLLMENT_STATUSES = ["requested", "waitlisted"] as const;

export const isOpenEnrollment = (status: EnrollmentStatus) =>
  (OPEN_ENROLLMENT_STATUSES as readonly string[]).includes(status);

/** Where a request may go from each status. Decided requests are final. */
export const ENROLLMENT_TRANSITIONS: Record<EnrollmentStatus, readonly EnrollmentStatus[]> = {
  requested: ["approved", "waitlisted", "declined", "cancelled"],
  waitlisted: ["approved", "declined", "cancelled"],
  approved: [],
  declined: [],
  cancelled: [],
};

export function canTransition(from: EnrollmentStatus, to: EnrollmentStatus): boolean {
  return ENROLLMENT_TRANSITIONS[from].includes(to);
}

export type EnrollmentAction = "approve" | "waitlist" | "decline" | "cancel";

const ACTION_TARGET: Record<EnrollmentAction, EnrollmentStatus> = {
  approve: "approved",
  waitlist: "waitlisted",
  decline: "declined",
  cancel: "cancelled",
};

/** Staff decide requests; the family can only withdraw their own. */
const ACTION_ACTOR: Record<EnrollmentAction, "staff" | "family"> = {
  approve: "staff",
  waitlist: "staff",
  decline: "staff",
  cancel: "family",
};

export type TransitionCheck =
  | { ok: true; status: EnrollmentStatus; replay: boolean }
  | { ok: false; code: "invalid_transition" | "forbidden"; message: string };

const DONE_MESSAGES: Record<EnrollmentStatus, string> = {
  requested: "This request is waiting for the academy.",
  waitlisted: "This request is on the waitlist.",
  approved: "This request was already approved.",
  declined: "This request was declined.",
  cancelled: "This request was cancelled.",
};

/**
 * What an action does to a request in `current`: the new status, or why it can't happen. Doing
 * an action again (approving an approved request) is a replay, not an error: the caller answers
 * with what happened the first time and changes nothing (approving twice never sells twice).
 */
export function nextStatus(
  current: EnrollmentStatus,
  action: EnrollmentAction,
  actor: "staff" | "family",
): TransitionCheck {
  if (ACTION_ACTOR[action] !== actor) {
    return {
      ok: false,
      code: "forbidden",
      message:
        actor === "family"
          ? "Only the academy can decide a request."
          : "Only the family can withdraw their request.",
    };
  }
  const target = ACTION_TARGET[action];
  if (current === target) return { ok: true, status: target, replay: true };
  if (canTransition(current, target)) return { ok: true, status: target, replay: false };
  return { ok: false, code: "invalid_transition", message: DONE_MESSAGES[current] };
}

// --- Modes and periods ---------------------------------------------------------------------------

/**
 * How a tier is enrolled in: month-end tiers pick a start month (this month or next), a single
 * session of a program (a trial) picks one of the program's upcoming sessions, and everything else
 * picks a start date.
 */
export type EnrollmentMode = "month" | "session" | "date";

export function enrollmentMode(tier: {
  validityMode: ValidityMode;
  credits: number;
  programId: string | null;
}): EnrollmentMode {
  if (tier.validityMode === "month_end") return "month";
  if (tier.credits === 1 && tier.programId) return "session";
  return "date";
}

export interface MonthChoice {
  month: string;
  startsOn: string;
  expiresOn: string;
  /** This month (else next month). */
  current: boolean;
}

/** The months a month-end tier can start in (this month and next), each with its expiry. */
export function monthChoices(today: string): MonthChoice[] {
  return startMonthChoices(today).map((month, i) => ({
    month,
    startsOn: firstDayOf(month),
    expiresOn: lastDayOf(month),
    current: i === 0,
  }));
}

/** Days left in the month (0 on its last day). */
export function daysLeftInMonth(today: string): number {
  return daysBetween(today, lastDayOf(monthOf(today)));
}

/** The start month the wizard suggests: this month, or next month in the month's last ten days. */
export function suggestedStartMonth(today: string): string {
  return daysLeftInMonth(today) < 10 ? addMonths(monthOf(today), 1) : monthOf(today);
}

/** The last week of the month: when the academy starts chasing renewals. */
export function isLastWeekOfMonth(today: string): boolean {
  return daysLeftInMonth(today) < 7;
}

/** How far ahead a start date can be. */
export const START_DATE_MAX_DAYS = 90;

/** How far ahead the sessions of a trial can be picked. */
export const SESSION_WINDOW_DAYS = 42;

export type PeriodInput = {
  startMonth?: string | null;
  lessonId?: string | null;
  startDate?: string | null;
};

export type EnrollmentPeriod =
  | { mode: "month"; startMonth: string }
  | { mode: "session"; lessonId: string }
  | { mode: "date"; startDate: string };

export type PeriodCheck =
  | { ok: true; period: EnrollmentPeriod }
  | { ok: false; field: "startMonth" | "lessonId" | "startDate"; message: string };

/**
 * The period a request asks for, checked against the tier's mode and the academy's today. A
 * session's own checks (it belongs to the program, is upcoming, has room) are the server's.
 */
export function checkPeriod(mode: EnrollmentMode, input: PeriodInput, today: string): PeriodCheck {
  if (mode === "month") {
    const m = input.startMonth ?? "";
    if (!MONTH_RE.test(m) || !startMonthChoices(today).includes(m)) {
      return {
        ok: false,
        field: "startMonth",
        message: "Pick this month or next month.",
      };
    }
    return { ok: true, period: { mode, startMonth: m } };
  }
  if (mode === "session") {
    if (!input.lessonId) {
      return { ok: false, field: "lessonId", message: "Pick a session." };
    }
    return { ok: true, period: { mode, lessonId: input.lessonId } };
  }
  const d = input.startDate ?? "";
  if (!DATE_RE.test(d) || compareDates(d, today) < 0) {
    return { ok: false, field: "startDate", message: "Pick a start date from today on." };
  }
  if (compareDates(d, addDays(today, START_DATE_MAX_DAYS)) > 0) {
    return {
      ok: false,
      field: "startDate",
      message: `Pick a start date in the next ${START_DATE_MAX_DAYS} days.`,
    };
  }
  return { ok: true, period: { mode, startDate: d } };
}

/** One key per period, so requests for the same student, tier, and period can be matched. */
export function periodKey(r: { startMonth: string | null; lessonId: string | null }): string {
  if (r.startMonth) return `month:${r.startMonth}`;
  if (r.lessonId) return `session:${r.lessonId}`;
  return "date";
}

export interface RequestFacts {
  id: string;
  clientId: string;
  packageId: string | null;
  startMonth: string | null;
  lessonId: string | null;
  status: EnrollmentStatus;
}

/**
 * A request this one would repeat: an open one (requested or waitlisted) for the same student,
 * tier, and period, or an approved one for the same month or session (they're enrolled already).
 * A tier enrolled by start date has one open request at a time.
 */
export function findDuplicate(
  existing: readonly RequestFacts[],
  candidate: Pick<RequestFacts, "clientId" | "packageId" | "startMonth" | "lessonId"> & {
    id?: string;
  },
): { kind: "open" | "approved"; request: RequestFacts } | null {
  const key = periodKey(candidate);
  for (const r of existing) {
    if (r.id === candidate.id) continue;
    if (r.clientId !== candidate.clientId || r.packageId !== candidate.packageId) continue;
    if (periodKey(r) !== key) continue;
    if (isOpenEnrollment(r.status)) return { kind: "open", request: r };
    if (r.status === "approved" && key !== "date") return { kind: "approved", request: r };
  }
  return null;
}

// --- Who's training --------------------------------------------------------------------------

export type WhoCode =
  | "ask_guardian"
  | "minor_self"
  | "adult_enrolls"
  | "needs_birth_date"
  | "not_a_minor"
  | "bad_birth_date";

export type WhoCheck =
  | { ok: true; relation: FamilyRelation }
  | { ok: false; code: WhoCode; message: string };

/** Oldest age a birth date may give (a typo guard). */
const MAX_AGE = 100;

export const ASK_GUARDIAN_MESSAGE =
  "Ask your parent or guardian to enroll you. Students under 18 are enrolled by a parent or guardian.";

function birthDateProblem(birthDate: string, today: string): string | null {
  if (!DATE_RE.test(birthDate) || compareDates(birthDate, today) > 0) {
    return "Check the birth date: it can't be in the future.";
  }
  if (ageOn(birthDate, today) > MAX_AGE) return "Check the birth date.";
  return null;
}

/**
 * Someone with their own login who is a minor (a teen linked to a parent) can't enroll anyone:
 * their parent does.
 */
export function isTeenLogin(
  self: { birthDate: string | null; isJunior: boolean } | null,
  today: string,
): boolean {
  return Boolean(self && isMinor({ ...self, today }));
}

/** "Me", as a student already on the academy's books (the caller's own link): 18 and over. */
export function checkSelfEnrollment(input: {
  birthDate: string | null;
  isJunior: boolean;
  today: string;
}): WhoCheck {
  if (isMinor(input)) return { ok: false, code: "minor_self", message: ASK_GUARDIAN_MESSAGE };
  return { ok: true, relation: "self" };
}

/** "Me", new to the academy: the birth date shows they're 18 or older. */
export function checkNewSelf(input: { birthDate: string | null; today: string }): WhoCheck {
  if (!input.birthDate) {
    return {
      ok: false,
      code: "needs_birth_date",
      message: "Add your birth date: the academy checks ages.",
    };
  }
  const problem = birthDateProblem(input.birthDate, input.today);
  if (problem) return { ok: false, code: "bad_birth_date", message: problem };
  if (ageOn(input.birthDate, input.today) < ADULT_AGE) {
    return { ok: false, code: "minor_self", message: ASK_GUARDIAN_MESSAGE };
  }
  return { ok: true, relation: "self" };
}

/** "My child": a student the caller is a parent or guardian of, still under 18. */
export function checkChildEnrollment(input: {
  birthDate: string | null;
  isJunior: boolean;
  today: string;
  firstName: string;
}): WhoCheck {
  if (isMinor(input)) return { ok: true, relation: "guardian" };
  const name = input.firstName || "This student";
  return {
    ok: false,
    code: "adult_enrolls",
    message: `${name} is 18 or older, so ${name} enrolls on their own account.`,
  };
}

/** "Add a child": a birth date showing they're under 18. */
export function checkNewChild(input: { birthDate: string | null; today: string }): WhoCheck {
  if (!input.birthDate) {
    return {
      ok: false,
      code: "needs_birth_date",
      message: "Add your child's birth date: the academy checks ages.",
    };
  }
  const problem = birthDateProblem(input.birthDate, input.today);
  if (problem) return { ok: false, code: "bad_birth_date", message: problem };
  if (ageOn(input.birthDate, input.today) >= ADULT_AGE) {
    return {
      ok: false,
      code: "not_a_minor",
      message: "Students 18 and over enroll themselves, on their own account.",
    };
  }
  return { ok: true, relation: "guardian" };
}

/**
 * A note when a student's age is outside the program's ages (shown, never a refusal), worded for
 * the family filling in the form or for the staff deciding.
 */
export function programAgeNote(
  program: { name: string; ageMin: number | null; ageMax: number | null },
  birthDate: string | null,
  today: string,
  reader: "family" | "staff" = "family",
): string | null {
  if (!birthDate || (program.ageMin === null && program.ageMax === null)) return null;
  const age = ageOn(birthDate, today);
  const range =
    program.ageMin !== null && program.ageMax !== null
      ? `ages ${program.ageMin}–${program.ageMax}`
      : program.ageMin !== null
        ? `ages ${program.ageMin} and up`
        : `up to age ${program.ageMax}`;
  if (
    (program.ageMin !== null && age < program.ageMin) ||
    (program.ageMax !== null && age > program.ageMax)
  ) {
    return `${program.name} is for ${range}, and this student is ${age}. ${
      reader === "staff" ? "You can still approve." : "The academy will check before approving."
    }`;
  }
  return null;
}

// --- Capacity --------------------------------------------------------------------------------

export interface CapacityFacts {
  /** null = no limit. */
  capacity: number | null;
  /** Members of the program, or players booked on the session, now. */
  taken: number;
  /** The student is in already (a renewal, or booked on that session). */
  alreadyIn: boolean;
}

export interface CapacityState {
  capacity: number | null;
  taken: number;
  /** Places left now (null without a limit). */
  left: number | null;
  full: boolean;
  /** Approving would take it over its limit. */
  over: boolean;
}

export function capacityState(f: CapacityFacts): CapacityState {
  const limited = f.capacity !== null && f.capacity > 0;
  return {
    capacity: limited ? f.capacity : null,
    taken: f.taken,
    left: limited ? Math.max(0, (f.capacity as number) - f.taken) : null,
    full: limited && f.taken >= (f.capacity as number),
    over: limited && !f.alreadyIn && f.taken + 1 > (f.capacity as number),
  };
}

/** Seats left on a session (its own capacity, else its program's); null = no limit. */
export function seatsLeft(capacity: number | null | undefined, booked: number): number | null {
  return capacity && capacity > 0 ? Math.max(0, capacity - booked) : null;
}

// --- Renewal ---------------------------------------------------------------------------------

export interface RenewalPackageFacts {
  id: string;
  /** The tier it was sold from. */
  packageId: string | null;
  startMonth: string | null;
  status: string;
  purchasedOn: string;
  enrollmentId: string | null;
}

export interface RenewalTierFacts {
  id: string;
  active: boolean;
  validityMode: ValidityMode;
}

export interface RenewalOffer {
  /** The tier to renew. */
  packageId: string;
  /** The month-end package ending this month. */
  fromClientPackageId: string;
  /** The request that package came from, if any (its answers are copied). */
  enrollmentId: string | null;
  startMonth: string;
  startsOn: string;
  expiresOn: string;
}

/**
 * "Renew for next month": a student whose month-end package runs for this month, of a tier still
 * on sale, with nothing for next month yet (no package starting then, and no open or approved
 * request for it). Offered all month; the academy chases the ones left in the month's last week.
 */
export function renewalFor(input: {
  today: string;
  packages: readonly RenewalPackageFacts[];
  requests: readonly { startMonth: string | null; status: EnrollmentStatus }[];
  tiers: ReadonlyMap<string, RenewalTierFacts>;
}): RenewalOffer | null {
  const thisMonth = monthOf(input.today);
  const next = addMonths(thisMonth, 1);
  const live = input.packages.filter((p) => p.status !== "void");
  if (live.some((p) => p.startMonth === next)) return null;
  if (
    input.requests.some(
      (r) => r.startMonth === next && (isOpenEnrollment(r.status) || r.status === "approved"),
    )
  ) {
    return null;
  }
  const current = live
    .filter((p) => p.startMonth === thisMonth && p.packageId)
    .sort((a, b) => b.purchasedOn.localeCompare(a.purchasedOn))
    .find((p) => {
      const tier = input.tiers.get(p.packageId as string);
      return tier?.active && tier.validityMode === "month_end";
    });
  if (!current?.packageId) return null;
  return {
    packageId: current.packageId,
    fromClientPackageId: current.id,
    enrollmentId: current.enrollmentId,
    startMonth: next,
    startsOn: firstDayOf(next),
    expiresOn: lastDayOf(next),
  };
}

/**
 * The reminder staff paste into Messenger, Viber, or a text for a student who hasn't renewed: the
 * link opens the family portal, where renewing is one tap.
 */
export function renewalReminderMessage(input: {
  academyName: string;
  studentFirstName: string;
  tierName: string;
  /** Already formatted for the reader, e.g. "Nov 30". */
  endsOn: string;
  /** e.g. "December". */
  nextMonth: string;
  link: string;
}): string {
  return [
    `Hi from ${input.academyName}. ${input.studentFirstName}'s ${input.tierName} ends on ${input.endsOn}.`,
    `To keep training in ${input.nextMonth}, open ${input.link} and tap “Renew for next month”.`,
    "Thank you.",
  ].join("\n");
}

// --- Answers -----------------------------------------------------------------------------------

/** The self-rating scale families pick from (DUPR-style), with "Not sure" beside it. */
export const SELF_RATINGS = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5] as const;

/** Plain-language hints for each level of the self-rating scale. */
export function selfRatingHint(value: number): string {
  if (value < 1.5) return "New to the game: learning to serve and keep score";
  if (value < 2) return "Can return some balls; rallies are still short";
  if (value < 2.5) return "Can keep a short rally going and knows the basic rules";
  if (value < 3) return "Rallies with some consistency; learning the kitchen and the third shot";
  if (value < 3.5) return "Dinks and drives with control; knows where to stand";
  if (value < 4) return "Consistent serves and returns; uses drops and resets in games";
  if (value < 4.5) return "Controls pace and placement; plays in tournaments";
  if (value < 5) return "Strong tournament player with few unforced errors";
  if (value < 5.5) return "Top amateur: wins at the highest tournament levels";
  return "Professional level";
}

export function isSelfRating(value: number): boolean {
  return (SELF_RATINGS as readonly number[]).includes(value);
}

/** Training shirt sizes: kids' then adults'. Stored as the label families picked. */
export const UNIFORM_SIZES = {
  kids: ["Kids XS", "Kids S", "Kids M", "Kids L", "Kids XL"],
  adults: ["Adult XS", "Adult S", "Adult M", "Adult L", "Adult XL", "Adult 2XL", "Adult 3XL"],
} as const;

/** Rough ages for the kids' sizes, shown beside them. */
export const KIDS_SIZE_AGES: Record<(typeof UNIFORM_SIZES.kids)[number], string> = {
  "Kids XS": "about 4–5",
  "Kids S": "about 6–7",
  "Kids M": "about 8–9",
  "Kids L": "about 10–11",
  "Kids XL": "about 12–13",
};

export const ALL_UNIFORM_SIZES: readonly string[] = [
  ...UNIFORM_SIZES.kids,
  ...UNIFORM_SIZES.adults,
];

/** Most authorized pickup people a family adds when enrolling. */
export const MAX_PICKUPS = 6;
