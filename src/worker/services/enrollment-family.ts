import { and, asc, count, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type {
  EnrollmentContextDto,
  EnrollmentSubmittedDto,
  EnrollStudentChoiceDto,
  PortalConsentDocumentDto,
  PortalEnrollAcademyDto,
  PortalEnrollmentDto,
  PortalRenewalDto,
} from "../../shared/api-types";
import { consentApplies, consentStatus } from "../../shared/consents";
import {
  type EnrollmentAnswers,
  type FamilyRelation,
  isPlaceholderEmail,
} from "../../shared/domain";
import {
  ASK_GUARDIAN_MESSAGE,
  checkChildEnrollment,
  checkNewChild,
  checkNewSelf,
  checkPeriod,
  checkSelfEnrollment,
  enrollmentMode,
  findDuplicate,
  nextStatus,
  renewalFor,
  SESSION_WINDOW_DAYS,
  type WhoCheck,
} from "../../shared/enrollment";
import { checkFamilyAccess, isMinor } from "../../shared/family";
import { uuidv7 } from "../../shared/ids";
import type { EnrollmentSubmitInput } from "../../shared/schemas";
import { dateLabel, localDate, monthLabel, todayIn } from "../../shared/time";
import { addMonths, monthOf } from "../../shared/validity";
import type { Db } from "../db/client";
import {
  academyProfile,
  account,
  attendance,
  auditLog,
  authorizedPickup,
  client,
  clientAccess,
  clientPackage,
  consentDocument,
  enrollmentRequest,
  lesson,
  organization,
  packageTemplate,
  passkey,
  workspaceSettings,
} from "../db/schema";
import type { PortalLink } from "../lib/portal-scope";
import { inList, unique } from "../lib/sql";
import { portalConsentDocuments, signatureStatements, signaturesOf } from "./consents";
import { runBatch } from "./credits";
import {
  type ClientRow,
  enrollableTier,
  familyRequestRows,
  paymentsFor,
  type RequestRow,
  refuse,
  type TierRow,
  toPortalEnrollment,
} from "./enrollment-core";
import { proofsForRequests } from "./payment-proofs";
import { findListedAcademy, type ListedAcademy, loadPublicAcademy } from "./public-academy";

// The family side of enrollment (WS4b): who the signed-in person can enroll, sending a request
// from the wizard, withdrawing it, and renewing a month-end package for next month.

/** Who is acting, as the portal knows them. */
export interface FamilyActor {
  userId: string;
  name: string;
  email: string;
  ip: string | null;
  userAgent: string | null;
}

/** How long decided requests stay on the family's home page. */
export const DECIDED_SHOWN_MS = 60 * 24 * 60 * 60 * 1000;

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] ?? "";
const lastNameOf = (name: string) => name.trim().split(/\s+/).slice(1).join(" ");

/** The caller's active links in one academy, with the students' rows. */
async function linksIn(db: Db, userId: string, workspaceId: string) {
  return db
    .select({ access: clientAccess, c: client })
    .from(clientAccess)
    .innerJoin(
      client,
      and(eq(client.id, clientAccess.clientId), eq(client.workspaceId, clientAccess.workspaceId)),
    )
    .where(
      and(
        eq(clientAccess.userId, userId),
        eq(clientAccess.workspaceId, workspaceId),
        isNull(clientAccess.revokedAt),
      ),
    )
    .orderBy(asc(client.firstName), asc(client.lastName));
}

/** Active required consent documents of an academy (what enrolling asks families to sign). */
export function requiredDocuments(db: Db, workspaceId: string) {
  return db
    .select()
    .from(consentDocument)
    .where(
      and(
        eq(consentDocument.workspaceId, workspaceId),
        eq(consentDocument.active, true),
        eq(consentDocument.required, true),
      ),
    )
    .orderBy(asc(consentDocument.createdAt));
}

/** Whether a passkey-only account can sign back in (a passkey, or Google linked). */
async function signInFacts(db: Db, userId: string) {
  const [keys, google] = await Promise.all([
    db.select({ n: count() }).from(passkey).where(eq(passkey.userId, userId)),
    db.query.account.findFirst({
      where: and(eq(account.userId, userId), eq(account.providerId, "google")),
      columns: { id: true },
    }),
  ]);
  return { hasPasskey: (keys[0]?.n ?? 0) > 0, hasGoogle: Boolean(google) };
}

/** Whether this person may enroll (or renew) a student they're linked to, by the age rules. */
function linkCheck(relation: FamilyRelation, c: ClientRow, today: string): WhoCheck {
  return relation === "self"
    ? checkSelfEnrollment({ birthDate: c.birthDate, isJunior: c.isJunior, today })
    : checkChildEnrollment({
        birthDate: c.birthDate,
        isJunior: c.isJunior,
        today,
        firstName: c.firstName,
      });
}

const allowedOf = (check: WhoCheck): EnrollStudentChoiceDto["allowed"] =>
  check.ok ? { ok: true } : { ok: false, code: check.code, message: check.message };

/**
 * GET /api/portal/enrollment-context?slug=: the students the signed-in person can choose in the
 * wizard at a listed academy (their own record, their children), which consents each has signed,
 * and what they already asked for. Null when the academy page isn't public.
 */
export async function enrollmentContext(
  db: Db,
  actor: Pick<FamilyActor, "userId" | "name" | "email">,
  slug: string,
): Promise<EnrollmentContextDto | null> {
  const academy = await findListedAcademy(db, slug);
  if (!academy) return null;
  const today = todayIn(academy.timezone);
  const [links, docs, facts] = await Promise.all([
    linksIn(db, actor.userId, academy.workspaceId),
    requiredDocuments(db, academy.workspaceId),
    signInFacts(db, actor.userId),
  ]);
  const ids = links.map((l) => l.c.id);
  const [signatures, requests] = await Promise.all([
    signaturesOf(db, academy.workspaceId, ids),
    ids.length
      ? db
          .select({
            clientId: enrollmentRequest.clientId,
            packageId: enrollmentRequest.packageId,
            startMonth: enrollmentRequest.startMonth,
            lessonId: enrollmentRequest.lessonId,
            status: enrollmentRequest.status,
          })
          .from(enrollmentRequest)
          .where(
            and(
              eq(enrollmentRequest.workspaceId, academy.workspaceId),
              inList(enrollmentRequest.clientId, ids),
              inArray(enrollmentRequest.status, ["requested", "waitlisted", "approved"]),
            ),
          )
      : Promise.resolve([]),
  ]);
  const choice = (l: (typeof links)[number]): EnrollStudentChoiceDto => {
    const c = l.c;
    const minor = isMinor({ birthDate: c.birthDate, isJunior: c.isJunior, today });
    const mine = signatures.filter((s) => s.clientId === c.id);
    return {
      clientId: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      birthDate: c.birthDate,
      minor,
      relation: l.access.relation,
      allowed: allowedOf(linkCheck(l.access.relation, c, today)),
      signedDocumentIds: docs
        .filter(
          (d) => consentApplies(d, minor) && consentStatus(d, mine, minor).status === "signed",
        )
        .map((d) => d.id),
      details: {
        phone: l.access.relation === "self" ? c.phone : c.guardianPhone,
        medicalNotes: c.medicalNotes,
        emergencyName: c.emergencyName,
        emergencyPhone: c.emergencyPhone,
        shirtSize: c.shirtSize,
      },
    };
  };
  const selfLink = links.find((l) => l.access.relation === "self");
  const self = selfLink ? choice(selfLink) : null;
  return {
    workspaceId: academy.workspaceId,
    slug: academy.slug,
    academyName: academy.name,
    enrollmentOpen: academy.enrollmentOpen,
    today,
    account: {
      name: actor.name,
      emailIsPlaceholder: isPlaceholderEmail(actor.email),
      hasPasskey: facts.hasPasskey,
      hasGoogle: facts.hasGoogle,
    },
    // A teen's own login: their parent enrolls them (and anyone else).
    blocked: self?.minor ? { code: "ask_guardian", message: ASK_GUARDIAN_MESSAGE } : null,
    self,
    children: links.filter((l) => l.access.relation === "guardian").map(choice),
    requests: requests.map((r) => ({ ...r, status: r.status })),
  };
}

type DocumentRow = typeof consentDocument.$inferSelect;
type SignatureIn = { documentId: string; version: number; signerName: string };

/** Builds (does not run) an audit insert for something the family did. */
function familyAuditEntry(
  db: Db,
  input: {
    workspaceId: string;
    userId: string;
    action: string;
    entity: string;
    entityId: string;
    data: Record<string, unknown>;
  },
) {
  return db.insert(auditLog).values({ id: uuidv7(), ...input });
}

/**
 * The consents a request must carry: required, active documents that apply to the student (minors'
 * documents only for under-18s) and that they haven't signed in their current version.
 */
async function consentsToSign(
  db: Db,
  workspaceId: string,
  studentId: string | null,
  minor: boolean,
): Promise<DocumentRow[]> {
  const [docs, signatures] = await Promise.all([
    requiredDocuments(db, workspaceId),
    studentId ? signaturesOf(db, workspaceId, [studentId]) : Promise.resolve([]),
  ]);
  return docs.filter(
    (d) => consentApplies(d, minor) && consentStatus(d, signatures, minor).status !== "signed",
  );
}

/** Every document still to sign must come signed, for the version the family read. */
function matchSignatures(needed: readonly DocumentRow[], given: readonly SignatureIn[]) {
  return needed.map((doc) => {
    const s = given.find((g) => g.documentId === doc.id);
    if (!s) {
      throw refuse(409, "consents_required", `Read and sign “${doc.title}” first.`, {
        documentId: doc.id,
      });
    }
    if (s.version !== doc.version) {
      throw refuse(
        409,
        "consent_changed",
        `“${doc.title}” changed since you opened it. Read the current version, then sign again.`,
        { documentId: doc.id },
      );
    }
    return { doc, signerName: s.signerName };
  });
}

/** A refusal of "who's training": a field error for a bad birth date, else 403 with its code. */
function whoRefusal(check: Extract<WhoCheck, { ok: false }>) {
  if (check.code === "needs_birth_date" || check.code === "bad_birth_date") {
    return refuse(400, "bad_request", check.message, {
      fields: { "who.birthDate": check.message },
    });
  }
  return refuse(403, check.code, check.message);
}

/** A session of the program the family can still book: upcoming, scheduled, with room. */
async function pickableSession(
  db: Db,
  workspaceId: string,
  program: { id: string; capacity: number | null },
  lessonId: string,
  now: number,
) {
  const row = await db.query.lesson.findFirst({
    where: and(eq(lesson.id, lessonId), eq(lesson.workspaceId, workspaceId)),
  });
  const latest = now + (SESSION_WINDOW_DAYS + 7) * 86_400_000;
  if (
    !row ||
    row.groupId !== program.id ||
    row.status !== "scheduled" ||
    row.startsAt <= now ||
    row.startsAt > latest
  ) {
    throw refuse(
      409,
      "session_unavailable",
      "That session can't be booked any more. Pick another one.",
      { field: "lessonId" },
    );
  }
  const [booked] = await db
    .select({ n: count() })
    .from(attendance)
    .where(
      and(
        eq(attendance.lessonId, row.id),
        notInArray(attendance.status, ["excused", "late_cancel"]),
      ),
    );
  const capacity = row.capacity ?? program.capacity;
  if (capacity && (booked?.n ?? 0) >= capacity) {
    throw refuse(409, "session_full", "That session is full. Pick another one.", {
      field: "lessonId",
    });
  }
  return row;
}

/** "December 2026", "Nov 12, 2026": the period a duplicate is about. */
function periodWords(
  r: { startMonth: string | null; lessonStartsAt: number | null },
  academy: Pick<ListedAcademy, "locale" | "timezone">,
): string {
  if (r.startMonth) return monthLabel(r.startMonth, academy.locale);
  if (r.lessonStartsAt !== null) {
    return dateLabel(localDate(r.lessonStartsAt, academy.timezone), academy.locale);
  }
  return "";
}

/** The answer to a sent request: the family's view of it. */
async function submitted(
  db: Db,
  actor: Pick<FamilyActor, "userId">,
  row: RequestRow,
  replay: boolean,
): Promise<EnrollmentSubmittedDto> {
  const [found] = await familyRequestRows(db, [
    { clientId: row.clientId, workspaceId: row.workspaceId },
  ]).then((rows) => rows.filter((r) => r.r.id === row.id));
  const tz = await db.query.workspaceSettings.findFirst({
    where: eq(workspaceSettings.workspaceId, row.workspaceId),
    columns: { timezone: true },
  });
  if (!found) throw refuse(404, "not_found", "Request not found.");
  const relation = (row.answers?.relation as FamilyRelation | undefined) ?? "guardian";
  return {
    request: toPortalEnrollment(found, {
      viewerUserId: actor.userId,
      relation,
      today: todayIn(tz?.timezone ?? "UTC"),
      payments: new Map(),
    }),
    clientId: row.clientId,
    newStudent: row.answers?.newStudent === true,
    replay,
  };
}

/**
 * POST /api/portal/enrollments: sends a request from the wizard. New students (the caller, or a
 * child) are created as `lead` clients with the caller's access (age rules checked again by
 * `checkFamilyAccess`); existing ones are reused. The request, its consent signatures (with its
 * id), the student, the access link, pickups, and the audit entries are written in one batch.
 */
export async function submitEnrollment(
  db: Db,
  actor: FamilyActor,
  input: EnrollmentSubmitInput,
): Promise<EnrollmentSubmittedDto> {
  const academy = await findListedAcademy(db, input.slug);
  if (!academy) throw refuse(404, "not_found", "This academy's page isn't available.");
  const ws = academy.workspaceId;

  // A send the app retried (same id): answer with the request it already made.
  if (input.id) {
    const existing = await db.query.enrollmentRequest.findFirst({
      where: eq(enrollmentRequest.id, input.id),
    });
    if (existing) {
      if (existing.requestedBy !== actor.userId || existing.workspaceId !== ws) {
        throw refuse(409, "conflict", "That request can't be sent again. Start over.");
      }
      return submitted(db, actor, existing, true);
    }
  }

  const found = await enrollableTier(db, ws, input.packageId);
  if (!found) {
    throw refuse(404, "not_found", "This package isn't offered on the academy page any more.");
  }
  const { tier, program } = found;
  const now = Date.now();
  const today = todayIn(academy.timezone);
  const mode = enrollmentMode(tier);
  const period = checkPeriod(mode, input, today);
  if (!period.ok) {
    throw refuse(400, "bad_request", period.message, {
      fields: { [period.field]: period.message },
    });
  }

  // A passkey-only account needs its way back in before it can follow a request.
  if (isPlaceholderEmail(actor.email)) {
    const facts = await signInFacts(db, actor.userId);
    if (!facts.hasPasskey && !facts.hasGoogle) {
      throw refuse(
        409,
        "passkey_required",
        "Add a passkey to this account first, so you can sign back in to follow your request.",
      );
    }
  }

  const links = await linksIn(db, actor.userId, ws);
  const selfLink = links.find((l) => l.access.relation === "self");
  if (
    selfLink &&
    isMinor({ birthDate: selfLink.c.birthDate, isJunior: selfLink.c.isJunior, today })
  ) {
    throw refuse(403, "ask_guardian", ASK_GUARDIAN_MESSAGE);
  }

  // Who's training: an existing student the caller is linked to, or a new one.
  let student: ClientRow | null = null;
  let fresh: { firstName: string; lastName: string; birthDate: string; minor: boolean } | null =
    null;
  let relation: FamilyRelation;
  const who = input.who;
  if (who.kind === "self") {
    relation = "self";
    if (selfLink) {
      const check = checkSelfEnrollment({ ...selfLink.c, today });
      if (!check.ok) throw whoRefusal(check);
      student = selfLink.c;
    } else {
      const check = checkNewSelf({ birthDate: who.birthDate ?? null, today });
      if (!check.ok) throw whoRefusal(check);
      const firstName = who.firstName?.trim() || firstNameOf(actor.name);
      if (!firstName) {
        throw refuse(400, "bad_request", "Add your first name.", {
          fields: { "who.firstName": "Add your first name." },
        });
      }
      fresh = {
        firstName,
        lastName: who.lastName?.trim() ?? lastNameOf(actor.name),
        birthDate: who.birthDate as string,
        minor: false,
      };
    }
  } else if (who.kind === "child") {
    relation = "guardian";
    const link = links.find((l) => l.c.id === who.clientId && l.access.relation === "guardian");
    if (!link) throw refuse(404, "not_found", "Student not found.");
    const check = checkChildEnrollment({ ...link.c, today });
    if (!check.ok) throw whoRefusal(check);
    student = link.c;
  } else {
    relation = "guardian";
    const check = checkNewChild({ birthDate: who.birthDate, today });
    if (!check.ok) throw whoRefusal(check);
    fresh = {
      firstName: who.firstName,
      lastName: who.lastName,
      birthDate: who.birthDate,
      minor: true,
    };
  }
  if (fresh) {
    if (!academy.enrollmentOpen) {
      throw refuse(
        409,
        "enrollment_closed",
        `${academy.name} isn't taking new students right now. Current students can still enroll and renew.`,
      );
    }
    // The same age rules as an invite link, for the access this request grants.
    const access = checkFamilyAccess({
      relation,
      birthDate: fresh.birthDate,
      isJunior: fresh.minor,
      today,
      hasGuardian: false,
    });
    if (!access.ok) throw refuse(409, access.code, access.message);
  }
  const minor = fresh
    ? fresh.minor
    : isMinor({
        birthDate: (student as ClientRow).birthDate,
        isJunior: (student as ClientRow).isJunior,
        today,
      });

  if (period.period.mode === "session" && program) {
    await pickableSession(db, ws, program, period.period.lessonId, now);
  }

  // What the tier asks for.
  const a = input.answers;
  const fields: Record<string, string> = {};
  if (tier.includesUniform && !a.shirtSize) fields["answers.shirtSize"] = "Pick a shirt size.";
  if (tier.asksSelfRating && typeof a.selfRating !== "number" && !a.selfRatingUnsure) {
    fields["answers.selfRating"] = "Pick a level, or “Not sure”.";
  }
  if (Object.keys(fields).length) {
    throw refuse(400, "bad_request", "Some answers are missing.", { fields });
  }

  const startMonth = period.period.mode === "month" ? period.period.startMonth : null;
  const lessonId = period.period.mode === "session" ? period.period.lessonId : null;

  // The same student, tier, and period asked for (or enrolled) already.
  if (student) {
    const mine = await db
      .select({
        id: enrollmentRequest.id,
        clientId: enrollmentRequest.clientId,
        packageId: enrollmentRequest.packageId,
        startMonth: enrollmentRequest.startMonth,
        lessonId: enrollmentRequest.lessonId,
        status: enrollmentRequest.status,
        lessonStartsAt: lesson.startsAt,
      })
      .from(enrollmentRequest)
      .leftJoin(lesson, eq(lesson.id, enrollmentRequest.lessonId))
      .where(
        and(eq(enrollmentRequest.workspaceId, ws), eq(enrollmentRequest.clientId, student.id)),
      );
    const dup = findDuplicate(mine, {
      clientId: student.id,
      packageId: tier.id,
      startMonth,
      lessonId,
    });
    if (dup) {
      const original = mine.find((m) => m.id === dup.request.id);
      const when = original ? periodWords(original, academy) : "";
      const what = `${tier.name}${when ? ` for ${when}` : ""}`;
      throw dup.kind === "open"
        ? refuse(
            409,
            "duplicate_request",
            `${student.firstName} already has a request for ${what}. It's waiting for the academy.`,
            { requestId: dup.request.id },
          )
        : refuse(409, "already_enrolled", `${student.firstName} is already enrolled in ${what}.`, {
            requestId: dup.request.id,
          });
    }
  }

  const signing = matchSignatures(
    await consentsToSign(db, ws, student?.id ?? null, minor),
    input.signatures,
  );

  const requestId = input.id ?? uuidv7();
  const clientId = student?.id ?? uuidv7();
  const realEmail = isPlaceholderEmail(actor.email) ? (a.email ?? null) : actor.email;
  const pickups = minor ? a.pickups : [];
  const answers: EnrollmentAnswers = {
    phone: a.phone,
    email: a.email ?? null,
    selfRating: typeof a.selfRating === "number" ? a.selfRating : null,
    selfRatingUnsure: Boolean(a.selfRatingUnsure) && typeof a.selfRating !== "number",
    shirtSize: a.shirtSize ?? null,
    medicalNotes: a.medicalNotes ?? null,
    emergencyName: a.emergencyName,
    emergencyPhone: a.emergencyPhone,
    notes: a.notes ?? null,
    pickups: pickups.map((p) => ({
      name: p.name,
      relationship: p.relationship ?? null,
      phone: p.phone ?? null,
    })),
    startDate: period.period.mode === "date" ? period.period.startDate : null,
    who: who.kind,
    relation,
    newStudent: Boolean(fresh),
  };

  const statements: unknown[] = [];
  if (fresh) {
    statements.push(
      db.insert(client).values({
        id: clientId,
        workspaceId: ws,
        firstName: fresh.firstName,
        lastName: fresh.lastName,
        birthDate: fresh.birthDate,
        isJunior: fresh.minor,
        phone: relation === "self" ? a.phone : null,
        email: relation === "self" ? realEmail : null,
        guardianName: relation === "guardian" ? actor.name : null,
        guardianPhone: relation === "guardian" ? a.phone : null,
        guardianEmail: relation === "guardian" ? realEmail : null,
        emergencyName: a.emergencyName,
        emergencyPhone: a.emergencyPhone,
        medicalNotes: a.medicalNotes ?? null,
        shirtSize: a.shirtSize ?? null,
        status: "lead",
        source: "Enrollment",
        tags: [],
        joinedOn: null,
      }),
    );
    const accessId = uuidv7();
    statements.push(
      db.insert(clientAccess).values({
        id: accessId,
        workspaceId: ws,
        clientId,
        userId: actor.userId,
        relation,
        grantedBy: actor.userId,
      }),
      familyAuditEntry(db, {
        workspaceId: ws,
        userId: actor.userId,
        action: "grant",
        entity: "client_access",
        entityId: accessId,
        data: { clientId, relation, by: "enrollment", enrollmentId: requestId },
      }),
    );
  }
  statements.push(
    db.insert(enrollmentRequest).values({
      id: requestId,
      workspaceId: ws,
      clientId,
      requestedBy: actor.userId,
      packageId: tier.id,
      programId: tier.programId,
      startMonth,
      lessonId,
      answers,
      status: "requested",
    }),
  );
  for (const s of signing) {
    statements.push(
      ...signatureStatements(db, {
        workspaceId: ws,
        document: s.doc,
        clientId,
        signedByUserId: actor.userId,
        signerName: s.signerName,
        relation: relation === "guardian" ? "guardian" : "self",
        ipAddress: actor.ip,
        userAgent: actor.userAgent,
        enrollmentId: requestId,
      }).statements,
    );
  }
  if (pickups.length) {
    const known = student
      ? await db
          .select({ name: authorizedPickup.name, phone: authorizedPickup.phone })
          .from(authorizedPickup)
          .where(eq(authorizedPickup.clientId, student.id))
      : [];
    const key = (p: { name: string; phone?: string | null }) =>
      `${p.name.trim().toLowerCase()}|${(p.phone ?? "").replace(/\D/g, "")}`;
    const seen = new Set(known.map(key));
    for (const p of pickups) {
      if (seen.has(key(p))) continue;
      seen.add(key(p));
      statements.push(
        db.insert(authorizedPickup).values({
          id: uuidv7(),
          workspaceId: ws,
          clientId,
          name: p.name,
          relationship: p.relationship ?? null,
          phone: p.phone ?? null,
          createdBy: actor.userId,
        }),
      );
    }
  }
  statements.push(
    familyAuditEntry(db, {
      workspaceId: ws,
      userId: actor.userId,
      action: "request",
      entity: "enrollment_request",
      entityId: requestId,
      data: {
        clientId,
        packageId: tier.id,
        mode,
        ...(startMonth ? { startMonth } : {}),
        ...(lessonId ? { lessonId } : {}),
        ...(answers.startDate ? { startDate: answers.startDate } : {}),
        newStudent: Boolean(fresh),
        relation,
        consents: signing.length,
      },
    }),
  );
  await runBatch({ db }, statements);
  const row = await db.query.enrollmentRequest.findFirst({
    where: eq(enrollmentRequest.id, requestId),
  });
  if (!row) throw refuse(404, "not_found", "Request not found.");
  return submitted(db, actor, row, false);
}

/** Each academy's time zone (for its "today"). */
async function timezonesOf(db: Db, workspaceIds: readonly string[]) {
  const rows = workspaceIds.length
    ? await db
        .select({ id: workspaceSettings.workspaceId, timezone: workspaceSettings.timezone })
        .from(workspaceSettings)
        .where(inList(workspaceSettings.workspaceId, workspaceIds))
    : [];
  return new Map(rows.map((r) => [r.id, r.timezone]));
}

/**
 * The family's requests: open ones and ones decided in the last 60 days (home), or every recent
 * one (`all`, a student's page), each with what's owed once approved.
 */
export async function familyEnrollments(
  db: Db,
  viewerUserId: string,
  links: readonly PortalLink[],
  opts: { all?: boolean } = {},
): Promise<PortalEnrollmentDto[]> {
  const rows = await familyRequestRows(
    db,
    links,
    opts.all ? { limit: 50 } : { since: Date.now() - DECIDED_SHOWN_MS },
  );
  const workspaces = unique(rows.map((r) => r.r.workspaceId));
  const [zones, proofs] = await Promise.all([
    timezonesOf(db, workspaces),
    proofsForRequests(
      db,
      viewerUserId,
      links,
      rows.filter((r) => r.r.status === "approved").map((r) => r.r.id),
    ),
  ]);
  const out: PortalEnrollmentDto[] = [];
  for (const ws of workspaces) {
    const mine = rows.filter((r) => r.r.workspaceId === ws);
    const payments = await paymentsFor(
      db,
      ws,
      mine.map((r) => r.r.chargeId),
    );
    const today = todayIn(zones.get(ws) ?? "UTC");
    for (const row of mine) {
      const link = links.find((l) => l.clientId === row.r.clientId && l.workspaceId === ws);
      if (!link) continue;
      const dto = toPortalEnrollment(row, {
        viewerUserId,
        relation: link.relation,
        today,
        payments,
      });
      out.push(row.r.status === "approved" ? { ...dto, proofs: proofs.get(row.r.id) ?? [] } : dto);
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * The family withdraws a request that's still requested or waitlisted: the person who sent it,
 * a parent, or the student as an adult. Other people's requests answer 404.
 */
export async function cancelEnrollment(
  db: Db,
  actor: Pick<FamilyActor, "userId">,
  links: readonly PortalLink[],
  id: string,
): Promise<PortalEnrollmentDto> {
  const row = await db.query.enrollmentRequest.findFirst({ where: eq(enrollmentRequest.id, id) });
  const link =
    row && links.find((l) => l.clientId === row.clientId && l.workspaceId === row.workspaceId);
  if (!row || !link) throw refuse(404, "not_found", "Request not found.");
  const student = await db.query.client.findFirst({
    where: and(eq(client.id, row.clientId), eq(client.workspaceId, row.workspaceId)),
  });
  const zone = (await timezonesOf(db, [row.workspaceId])).get(row.workspaceId) ?? "UTC";
  const today = todayIn(zone);
  const minor = student ? isMinor({ ...student, today }) : false;
  const mayAct =
    row.requestedBy === actor.userId ||
    link.relation === "guardian" ||
    (link.relation === "self" && !minor);
  if (!mayAct) {
    throw refuse(403, "ask_guardian", "Your parent or guardian manages this request.");
  }
  const step = nextStatus(row.status, "cancel", "family");
  if (!step.ok) throw refuse(409, step.code, step.message);
  if (!step.replay) {
    const now = Date.now();
    const updated = await db
      .update(enrollmentRequest)
      .set({ status: "cancelled", decidedBy: actor.userId, decidedAt: now })
      .where(
        and(
          eq(enrollmentRequest.id, row.id),
          inArray(enrollmentRequest.status, ["requested", "waitlisted"]),
        ),
      )
      .returning({ id: enrollmentRequest.id });
    if (!updated.length) {
      const now2 = await db.query.enrollmentRequest.findFirst({
        where: eq(enrollmentRequest.id, row.id),
      });
      if (now2?.status !== "cancelled") {
        throw refuse(409, "invalid_transition", "The academy decided this request just now.");
      }
    } else {
      await familyAuditEntry(db, {
        workspaceId: row.workspaceId,
        userId: actor.userId,
        action: "cancel",
        entity: "enrollment_request",
        entityId: row.id,
        data: { clientId: row.clientId, by: "family" },
      });
    }
  }
  const [found] = (await familyEnrollments(db, actor.userId, [link], { all: true })).filter(
    (r) => r.id === row.id,
  );
  if (!found) throw refuse(404, "not_found", "Request not found.");
  return found;
}

interface RenewalFacts {
  packages: {
    id: string;
    clientId: string;
    packageId: string | null;
    startMonth: string | null;
    status: string;
    purchasedOn: string;
    enrollmentId: string | null;
  }[];
  requests: { clientId: string; startMonth: string | null; status: RequestRow["status"] }[];
  tiers: Map<string, TierRow>;
}

/** Month-end packages of this month and next, requests for next month, and their tiers. */
export async function renewalFacts(
  db: Db,
  workspaceId: string,
  clientIds: readonly string[] | null,
  today: string,
): Promise<RenewalFacts> {
  const thisMonth = monthOf(today);
  const next = addMonths(thisMonth, 1);
  const [packages, requests] = await Promise.all([
    db
      .select({
        id: clientPackage.id,
        clientId: clientPackage.clientId,
        packageId: clientPackage.packageId,
        startMonth: clientPackage.startMonth,
        status: clientPackage.status,
        purchasedOn: clientPackage.purchasedOn,
        enrollmentId: clientPackage.enrollmentId,
      })
      .from(clientPackage)
      .where(
        and(
          eq(clientPackage.workspaceId, workspaceId),
          clientIds ? inList(clientPackage.clientId, clientIds) : undefined,
          inArray(clientPackage.startMonth, [thisMonth, next]),
        ),
      ),
    db
      .select({
        clientId: enrollmentRequest.clientId,
        startMonth: enrollmentRequest.startMonth,
        status: enrollmentRequest.status,
      })
      .from(enrollmentRequest)
      .where(
        and(
          eq(enrollmentRequest.workspaceId, workspaceId),
          clientIds ? inList(enrollmentRequest.clientId, clientIds) : undefined,
          eq(enrollmentRequest.startMonth, next),
        ),
      ),
  ]);
  const tierIds = unique(packages.map((p) => p.packageId).filter((id): id is string => !!id));
  const tiers = tierIds.length
    ? await db
        .select()
        .from(packageTemplate)
        .where(
          and(eq(packageTemplate.workspaceId, workspaceId), inList(packageTemplate.id, tierIds)),
        )
    : [];
  return { packages, requests, tiers: new Map(tiers.map((t) => [t.id, t])) };
}

/** The renewal one student can make now (see renewalFor), from facts already loaded. */
export function renewalOf(facts: RenewalFacts, clientId: string, today: string) {
  const offer = renewalFor({
    today,
    packages: facts.packages.filter((p) => p.clientId === clientId),
    requests: facts.requests.filter((r) => r.clientId === clientId),
    tiers: facts.tiers,
  });
  const tier = offer ? facts.tiers.get(offer.packageId) : undefined;
  return offer && tier ? { offer, tier } : null;
}

/** "Renew for next month" offers for the linked students, with the forms to sign first. */
export async function renewalOffers(
  db: Db,
  links: readonly PortalLink[],
  students: ReadonlyMap<string, ClientRow>,
): Promise<PortalRenewalDto[]> {
  const out: PortalRenewalDto[] = [];
  const workspaces = unique(links.map((l) => l.workspaceId));
  const zones = await timezonesOf(db, workspaces);
  for (const ws of workspaces) {
    const today = todayIn(zones.get(ws) ?? "UTC");
    const mine = links.filter((l) => l.workspaceId === ws);
    const facts = await renewalFacts(
      db,
      ws,
      mine.map((l) => l.clientId),
      today,
    );
    for (const link of mine) {
      const row = students.get(link.clientId);
      const found = row ? renewalOf(facts, link.clientId, today) : null;
      if (!row || !found) continue;
      const consents = await portalConsentDocuments(db, row, today);
      out.push({
        clientId: row.id,
        workspaceId: ws,
        student: { firstName: row.firstName, lastName: row.lastName },
        tierName: found.tier.name,
        packageId: found.tier.id,
        startMonth: found.offer.startMonth,
        expiresOn: found.offer.expiresOn,
        priceMinor: found.tier.priceMinor,
        consents: consents.documents.filter(
          (d: PortalConsentDocumentDto) => d.required && d.status !== "signed",
        ),
        allowed: allowedOf(linkCheck(link.relation, row, today)),
      });
    }
  }
  return out;
}

/**
 * POST /api/portal/students/:clientId/renew: one tap asks for the same tier next month, with the
 * previous request's answers. Allowed while the academy isn't taking new students. Forms that
 * need signing again come with it (signed with the request's id, in the same batch).
 */
export async function renewEnrollment(
  db: Db,
  actor: FamilyActor,
  link: PortalLink,
  input: { id?: string; signatures: SignatureIn[] },
): Promise<EnrollmentSubmittedDto> {
  const ws = link.workspaceId;
  if (input.id) {
    const existing = await db.query.enrollmentRequest.findFirst({
      where: eq(enrollmentRequest.id, input.id),
    });
    if (existing) {
      if (existing.requestedBy !== actor.userId || existing.clientId !== link.clientId) {
        throw refuse(409, "conflict", "That renewal can't be sent again. Start over.");
      }
      return submitted(db, actor, existing, true);
    }
  }
  const row = await db.query.client.findFirst({
    where: and(eq(client.id, link.clientId), eq(client.workspaceId, ws)),
  });
  if (!row) throw refuse(404, "not_found", "Student not found.");
  const today = todayIn((await timezonesOf(db, [ws])).get(ws) ?? "UTC");
  const check = linkCheck(link.relation, row, today);
  if (!check.ok) throw refuse(403, check.code, check.message);
  const found = renewalOf(await renewalFacts(db, ws, [row.id], today), row.id, today);
  if (!found) {
    throw refuse(
      409,
      "nothing_to_renew",
      `${row.firstName} has nothing to renew for next month: it's renewed already, or there's no monthly package this month.`,
    );
  }
  const { offer, tier } = found;
  const minor = isMinor({ ...row, today });
  const signing = matchSignatures(await consentsToSign(db, ws, row.id, minor), input.signatures);

  // The answers of the request the package came from, else the student's last approved one.
  const previous =
    (offer.enrollmentId
      ? await db.query.enrollmentRequest.findFirst({
          where: and(
            eq(enrollmentRequest.id, offer.enrollmentId),
            eq(enrollmentRequest.clientId, row.id),
          ),
        })
      : undefined) ??
    (
      await db
        .select()
        .from(enrollmentRequest)
        .where(
          and(
            eq(enrollmentRequest.workspaceId, ws),
            eq(enrollmentRequest.clientId, row.id),
            eq(enrollmentRequest.packageId, tier.id),
            eq(enrollmentRequest.status, "approved"),
          ),
        )
        .orderBy(sql`${enrollmentRequest.createdAt} desc`)
        .limit(1)
    )[0];
  const {
    startDate: _startDate,
    newStudent: _newStudent,
    renewalOf: _renewalOf,
    ...kept
  } = (previous?.answers ?? {}) as EnrollmentAnswers;
  const answers: EnrollmentAnswers = {
    ...kept,
    who: link.relation === "self" ? "self" : "child",
    relation: link.relation,
    newStudent: false,
    renewalOf: offer.fromClientPackageId,
  };
  const requestId = input.id ?? uuidv7();
  const statements: unknown[] = [
    db.insert(enrollmentRequest).values({
      id: requestId,
      workspaceId: ws,
      clientId: row.id,
      requestedBy: actor.userId,
      packageId: tier.id,
      programId: tier.programId,
      startMonth: offer.startMonth,
      answers,
      status: "requested",
    }),
  ];
  for (const s of signing) {
    statements.push(
      ...signatureStatements(db, {
        workspaceId: ws,
        document: s.doc,
        clientId: row.id,
        signedByUserId: actor.userId,
        signerName: s.signerName,
        relation: minor ? "guardian" : "self",
        ipAddress: actor.ip,
        userAgent: actor.userAgent,
        enrollmentId: requestId,
      }).statements,
    );
  }
  statements.push(
    familyAuditEntry(db, {
      workspaceId: ws,
      userId: actor.userId,
      action: "request",
      entity: "enrollment_request",
      entityId: requestId,
      data: {
        clientId: row.id,
        packageId: tier.id,
        mode: "month",
        startMonth: offer.startMonth,
        renewal: true,
        renewalOf: offer.fromClientPackageId,
        consents: signing.length,
      },
    }),
  );
  await runBatch({ db }, statements);
  const created = await db.query.enrollmentRequest.findFirst({
    where: eq(enrollmentRequest.id, requestId),
  });
  if (!created) throw refuse(404, "not_found", "Request not found.");
  return submitted(db, actor, created, false);
}

/**
 * GET /api/portal/enroll: the academies the person's students train at, with their academy page's
 * programs and tiers (enrolling goes through that page, so only listed academies have them).
 */
export async function enrollAcademies(
  db: Db,
  links: readonly PortalLink[],
): Promise<PortalEnrollAcademyDto[]> {
  const workspaces = unique(links.map((l) => l.workspaceId));
  if (!workspaces.length) return [];
  const rows = await db
    .select({ org: organization, profile: academyProfile })
    .from(organization)
    .leftJoin(academyProfile, eq(academyProfile.workspaceId, organization.id))
    .where(inList(organization.id, workspaces));
  const out: PortalEnrollAcademyDto[] = [];
  for (const ws of workspaces) {
    const r = rows.find((x) => x.org.id === ws);
    if (!r) continue;
    const page = await loadPublicAcademy(db, { workspaceId: ws });
    out.push({
      workspaceId: ws,
      name: r.org.name,
      slug: r.org.slug,
      logoKey: r.profile?.logoKey ?? null,
      listed: Boolean(page?.listed),
      enrollmentOpen: Boolean(r.profile?.enrollmentOpen),
      contactPhone: r.profile?.contactPhone ?? null,
      contactEmail: r.profile?.contactEmail ?? null,
      page: page?.listed ? page.academy : null,
    });
  }
  return out;
}

/** The linked students' rows (each in its own academy), for renewals. */
export async function linkedStudents(db: Db, links: readonly PortalLink[]) {
  const out = new Map<string, ClientRow>();
  if (!links.length) return out;
  const rows = await db
    .select()
    .from(client)
    .where(
      inList(
        client.id,
        links.map((l) => l.clientId),
      ),
    );
  for (const r of rows) {
    if (links.some((l) => l.clientId === r.id && l.workspaceId === r.workspaceId)) out.set(r.id, r);
  }
  return out;
}
