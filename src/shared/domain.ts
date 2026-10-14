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
