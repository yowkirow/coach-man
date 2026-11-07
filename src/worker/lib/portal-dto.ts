// Family-safe DTOs for /api/portal. Every mapper copies the fields families may see, one by one,
// from a database row (never by spreading a row or a staff DTO), so a column added later stays
// out of the portal until someone adds it here on purpose. Rows a family must never see (staff
// or handoff notes, unshared assessments, voided money) map to null.

import type {
  CoachRefDto,
  PickupDto,
  PortalAcademyDto,
  PortalAcademyRefDto,
  PortalAnnouncementDto,
  PortalAssessmentDto,
  PortalChargeDto,
  PortalCoachDto,
  PortalCoachRefDto,
  PortalCommentDto,
  PortalGoalDto,
  PortalPackageDto,
  PortalPaymentDto,
  PortalPaymentProofDto,
  PortalSafetyUpdateDto,
  PortalSessionDto,
  PortalStudentDto,
  PortalStudentRefDto,
} from "../../shared/api-types";
import {
  ACADEMY_SOCIALS,
  type AcademySocial,
  type AttendanceStatus,
  type ClientPackageStatus,
  isAcademySlug,
  LESSON_KIND_LABELS,
} from "../../shared/domain";
import { isFamilyVisible } from "../../shared/notes";
import type {
  academyProfile,
  announcement,
  assessment,
  authorizedPickup,
  client,
  clientCoach,
  goal,
  lesson,
  note,
  paymentSubmission,
  ratingSnapshot,
  workspaceSettings,
} from "../db/schema";
import type { PortalLink } from "./portal-scope";

type ClientRow = typeof client.$inferSelect;
type PickupRow = typeof authorizedPickup.$inferSelect;
type AnnouncementRow = typeof announcement.$inferSelect;
type ProofRow = typeof paymentSubmission.$inferSelect;
type ProfileRow = typeof academyProfile.$inferSelect;
type SettingsRow = typeof workspaceSettings.$inferSelect;
type LessonRow = typeof lesson.$inferSelect;
type NoteRow = typeof note.$inferSelect;
type AssessmentRow = typeof assessment.$inferSelect;
type GoalRow = typeof goal.$inferSelect;
type RatingRow = typeof ratingSnapshot.$inferSelect;
type ClientCoachRow = typeof clientCoach.$inferSelect;

export function toPortalStudentRef(c: ClientRow, link: PortalLink): PortalStudentRefDto {
  return {
    clientId: c.id,
    workspaceId: c.workspaceId,
    firstName: c.firstName,
    lastName: c.lastName,
    photoKey: c.photoKey,
    relation: link.relation,
    isJunior: c.isJunior,
  };
}

/** Profile basics. Never `notes`, `tags`, `source`, or `goals` (the staff's own words). */
/**
 * A student's profile basics for their family. `sharedLevel` is the overall level of the latest
 * assessment shared with the family: the client's own `level` follows every assessment, shared or
 * not, so it never goes out as is.
 */
export function toPortalStudent(
  c: ClientRow,
  link: PortalLink,
  sharedLevel: string | null,
): PortalStudentDto["student"] {
  return {
    ...toPortalStudentRef(c, link),
    birthDate: c.birthDate,
    level: sharedLevel,
    duprRating: c.duprRating,
    dominantHand: c.dominantHand,
    shirtSize: c.shirtSize,
    phone: c.phone,
    email: c.email,
    joinedOn: c.joinedOn,
  };
}

/** Medical and emergency details: only ever called for one of the caller's own students. */
export function toPortalSafety(c: ClientRow): PortalStudentDto["safety"] {
  return {
    medicalNotes: c.medicalNotes,
    emergencyName: c.emergencyName,
    emergencyPhone: c.emergencyPhone,
    guardianName: c.guardianName,
    guardianPhone: c.guardianPhone,
  };
}

/**
 * When the health and emergency details last changed, as the family reads it: whether it was them
 * or the academy, never who on either side (no names or user ids of other family members or
 * staff).
 */
export function toPortalSafetyUpdate(
  c: Pick<ClientRow, "safetyUpdatedAt" | "safetyUpdatedBy" | "safetyUpdatedRelation">,
  viewerUserId: string,
): PortalSafetyUpdateDto | null {
  if (!c.safetyUpdatedAt) return null;
  return {
    at: c.safetyUpdatedAt,
    byYou: Boolean(c.safetyUpdatedBy) && c.safetyUpdatedBy === viewerUserId,
    byAcademy: c.safetyUpdatedRelation === "staff",
  };
}

/** An authorized pickup person (the same for staff and family: never who added them). */
export function toPickupDto(p: PickupRow): PickupDto {
  return {
    id: p.id,
    name: p.name,
    relationship: p.relationship,
    phone: p.phone,
    notes: p.notes,
    photoKey: p.photoKey,
    updatedAt: p.updatedAt,
  };
}

/** A live announcement for a family: what it says and who it's for, never who wrote it. */
export function toPortalAnnouncement(
  a: AnnouncementRow,
  audienceName: string | null,
): PortalAnnouncementDto | null {
  if (a.publishedAt === null) return null;
  return {
    id: a.id,
    workspaceId: a.workspaceId,
    title: a.title,
    body: a.body,
    pinned: a.pinned,
    publishedAt: a.publishedAt,
    audience: a.audience,
    audienceName: a.audience === "all" ? null : audienceName,
    expiresAt: a.expiresAt,
  };
}

type FormatSource = Pick<SettingsRow, "currency" | "timezone" | "locale" | "weekStartsOn">;

export function toPortalAcademyRef(
  org: { id: string; name: string },
  profile: Pick<ProfileRow, "logoKey"> | null | undefined,
  settings: FormatSource | null | undefined,
): PortalAcademyRefDto {
  return {
    workspaceId: org.id,
    name: org.name,
    logoKey: profile?.logoKey ?? null,
    currency: settings?.currency ?? "USD",
    timezone: settings?.timezone ?? "UTC",
    locale: settings?.locale ?? "en-US",
    weekStartsOn: settings?.weekStartsOn ?? 1,
  };
}

export function toPortalAcademy(
  org: { id: string; name: string; slug: string },
  profile: ProfileRow | null | undefined,
  settings: (FormatSource & Pick<SettingsRow, "paymentMethods">) | null | undefined,
  appOrigin: string,
): PortalAcademyDto {
  const socials: Partial<Record<AcademySocial, string>> = {};
  for (const key of ACADEMY_SOCIALS) {
    const value = profile?.socials?.[key];
    if (value) socials[key] = value;
  }
  return {
    ...toPortalAcademyRef(org, profile, settings),
    publicUrl: isAcademySlug(org.slug) ? `${appOrigin}/a/${org.slug}` : null,
    tagline: profile?.tagline ?? null,
    about: profile?.about ?? null,
    contactPhone: profile?.contactPhone ?? null,
    contactEmail: profile?.contactEmail ?? null,
    address: profile?.address ?? null,
    mapUrl: profile?.mapUrl ?? null,
    socials,
    policies: profile?.policies ?? null,
    paymentInstructions: profile?.paymentInstructions ?? null,
    paymentQrKey: profile?.paymentQrKey ?? null,
    paymentMethods: [...(settings?.paymentMethods ?? [])],
  };
}

/** A coach by name and photo only (no user id, email, or phone). */
export function toPortalCoachRef(
  ref: Pick<CoachRefDto, "name" | "photoKey"> | null | undefined,
): PortalCoachRefDto | null {
  return ref ? { name: ref.name, photoKey: ref.photoKey } : null;
}

/** What a coach's profile shows families: bio and the rest only when their profile is public. */
export interface CoachProfileFacts {
  name: string;
  title: string | null;
  photoKey: string | null;
  bio: string | null;
  certifications: string[];
  specialties: string[];
  languages: string[];
  yearsCoaching: number | null;
  isPublic: boolean;
}

export function toPortalCoach(row: ClientCoachRow, coach: CoachProfileFacts): PortalCoachDto {
  const open = coach.isPublic;
  return {
    id: row.id,
    role: row.role,
    since: row.startedOn,
    name: coach.name,
    photoKey: coach.photoKey,
    title: coach.title,
    bio: open ? coach.bio : null,
    certifications: open ? [...coach.certifications] : [],
    specialties: open ? [...coach.specialties] : [],
    languages: open ? [...coach.languages] : [],
    yearsCoaching: open ? coach.yearsCoaching : null,
  };
}

/** A session's name for families: its own title, its program or event, else its kind. */
export function portalSessionTitle(
  l: Pick<LessonRow, "title" | "kind">,
  groupName: string | null | undefined,
  eventName: string | null | undefined,
): string {
  return l.title?.trim() || groupName || eventName || LESSON_KIND_LABELS[l.kind];
}

export interface SessionRow {
  lesson: LessonRow;
  venueName: string | null;
  venueAddress: string | null;
  groupName: string | null;
  eventName: string | null;
  attendance: AttendanceStatus | null;
}

/** Never the session's notes, cancel reason, price, roster, or other players' names. */
export function toPortalSession(r: SessionRow, coach: PortalCoachRefDto | null): PortalSessionDto {
  return {
    id: r.lesson.id,
    title: portalSessionTitle(r.lesson, r.groupName, r.eventName),
    kind: r.lesson.kind,
    startsAt: r.lesson.startsAt,
    endsAt: r.lesson.endsAt,
    status: r.lesson.status,
    attendance: r.attendance,
    venue: r.venueName ? { name: r.venueName, address: r.venueAddress } : null,
    court: r.lesson.court,
    coach,
  };
}

/** A shared coach comment, or null for anything coaches keep to themselves. */
export function toPortalComment(
  n: NoteRow,
  author: PortalCoachRefDto | null,
  session: { title: string; startsAt: number } | null,
): PortalCommentDto | null {
  if (!n.clientId || !isFamilyVisible(n)) return null;
  return {
    id: n.id,
    clientId: n.clientId,
    body: n.body,
    createdAt: n.createdAt,
    editedAt: n.editedAt,
    author,
    session,
  };
}

/** A shared assessment with its scores, or null when the coach held it back. */
export function toPortalAssessment(
  a: AssessmentRow,
  scores: { skillId: string; score: number; note: string | null }[],
  author: PortalCoachRefDto | null,
): PortalAssessmentDto | null {
  if (!a.sharedWithFamily) return null;
  return {
    id: a.id,
    assessedOn: a.assessedOn,
    overallLevel: a.overallLevel,
    notes: a.notes,
    scores: scores.map((s) => ({ skillId: s.skillId, score: s.score, note: s.note })),
    author,
  };
}

export function toPortalGoal(g: GoalRow, author: PortalCoachRefDto | null): PortalGoalDto {
  return {
    id: g.id,
    title: g.title,
    detail: g.detail,
    targetDate: g.targetDate,
    status: g.status,
    achievedOn: g.achievedOn,
    author,
  };
}

export function toPortalRating(r: RatingRow) {
  return { id: r.id, source: r.source, value: r.value, recordedOn: r.recordedOn };
}

/** A sold package: name, credits, dates, status. Never its price note or internal notes. */
export function toPortalPackage(
  p: {
    id: string;
    name: string;
    creditsTotal: number;
    remaining: number;
    purchasedOn: string;
    expiresOn: string | null;
    status: string;
  },
  today: string,
): PortalPackageDto | null {
  if (p.status === "void") return null;
  const status = (
    p.status === "active" && p.expiresOn && p.expiresOn < today ? "expired" : p.status
  ) as ClientPackageStatus;
  return {
    id: p.id,
    name: p.name,
    creditsTotal: p.creditsTotal,
    remaining: Math.max(0, p.remaining),
    purchasedOn: p.purchasedOn,
    expiresOn: p.expiresOn,
    status,
  };
}

/** A charge on the student's account; voided ones are left out. */
export function toPortalCharge(c: {
  id: string;
  kind: PortalChargeDto["kind"];
  description: string;
  amountMinor: number;
  paidMinor: number;
  occurredOn: string;
  voidedAt: number | null;
}): PortalChargeDto | null {
  if (c.voidedAt !== null) return null;
  return {
    id: c.id,
    kind: c.kind,
    description: c.description,
    amountMinor: c.amountMinor,
    paidMinor: c.paidMinor,
    occurredOn: c.occurredOn,
  };
}

/** A payment the academy recorded; voided ones and staff notes are left out. */
export function toPortalPayment(p: {
  id: string;
  amountMinor: number;
  method: string;
  paidOn: string;
  reference: string | null;
  voidedAt: number | null;
}): PortalPaymentDto | null {
  if (p.voidedAt !== null) return null;
  return {
    id: p.id,
    amountMinor: p.amountMinor,
    method: p.method,
    paidOn: p.paidOn,
    reference: p.reference,
  };
}

/**
 * A payment proof as the family sees it: what they sent, where it stands, the academy's reason
 * when it wasn't accepted, and what the academy recorded when it confirmed. Never who reviewed it
 * (no staff ids, names, or emails) or the payment's internal note.
 */
export function toPortalProof(
  s: ProofRow,
  ctx: {
    viewerUserId: string;
    /** The name of the family member who sent it. */
    sentByName: string;
    /** The payment confirming it recorded, if any. */
    payment: { amountMinor: number; paidOn: string; voidedAt: number | null } | null;
    /** A newer proof sends this one again. */
    resubmitted: boolean;
  },
): PortalPaymentProofDto {
  const decided = s.status === "confirmed" || s.status === "rejected" || s.status === "voided";
  const live = s.status === "confirmed" && ctx.payment && ctx.payment.voidedAt === null;
  return {
    id: s.id,
    clientId: s.clientId,
    workspaceId: s.workspaceId,
    enrollmentId: s.enrollmentId,
    amountMinor: s.amountMinor,
    method: s.method,
    reference: s.reference,
    paidOn: s.paidOn,
    note: s.note,
    proofKey: s.proofKey,
    status: s.status,
    createdAt: s.createdAt,
    decidedAt: decided ? s.reviewedAt : null,
    rejectReason: s.status === "rejected" ? s.rejectReason : null,
    recorded:
      live && ctx.payment
        ? { amountMinor: ctx.payment.amountMinor, paidOn: ctx.payment.paidOn }
        : null,
    sentBy: { name: ctx.sentByName, you: s.submittedBy === ctx.viewerUserId },
    canWithdraw: s.status === "pending" && s.submittedBy === ctx.viewerUserId,
    resubmitOf: s.resubmitOf,
    resubmitted: ctx.resubmitted,
  };
}
