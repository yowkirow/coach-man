// Email: one message to one person through Cloudflare Email Sending (the `EMAIL` binding), or into
// the test sink, and who gets which email. What an email says lives in src/shared/email.ts.
// Invites send in the request, so the answer can say whether the email went; enrollment and
// payment updates to families and staff alerts run after the response (lib/defer.ts), apart from
// the pushes (email never waits on push being set up, or on anyone having a device), each once
// per person and thing (notification_log, as `email_<kind>`).

import { and, eq } from "drizzle-orm";
import type { FamilyRelation } from "../../shared/domain";
import {
  type EmailDraft,
  type EmailKind,
  emailFailureReason,
  enrollmentDecisionEmail,
  enrollmentReceivedEmail,
  familyInviteEmail,
  fromNameOf,
  isDeliverableEmail,
  oneLine,
  proofDecisionEmail,
  renderEmail,
  staffEnrollmentRequestEmail,
  staffInviteEmail,
  staffProofEmail,
} from "../../shared/email";
import { uuidv7 } from "../../shared/ids";
import { linkRecipients, NOTICE_AUDIENCE } from "../../shared/notifications";
import type { StaffRole } from "../../shared/roles";
import { dateLabel, dayLabel, localDate, monthLabel } from "../../shared/time";
import type { Db } from "../db/client";
import {
  academyProfile,
  emailSink,
  organization,
  paymentSubmission,
  user,
  workspaceSettings,
} from "../db/schema";
import { isEmailSinkEnabled } from "../lib/email-sink";
import { publicImageUrl } from "../lib/page-meta";
import { inList, unique } from "../lib/sql";
import { appOrigin } from "../routes/academy";
import { isRenewal } from "./enrollment-core";
import {
  decidedRequest,
  type LinkedStudent,
  openRequest,
  pendingProof,
  staffAlertUsers,
  studentLinks,
} from "./family-push";
import { claimLog, logKey } from "./push-delivery";

// --- Delivery ----------------------------------------------------------------------------------

export interface OutgoingEmail {
  to: string;
  kind: EmailKind;
  workspaceId: string | null;
  /** "<Academy> via CoachMan" (fromNameOf). */
  fromName: string;
  replyTo: string | null;
  subject: string;
  text: string;
  html: string;
}

/** Sent (or recorded in the sink), or why not: Cloudflare's `E_…` code, or one of ours. */
export type EmailResult = { ok: true; sink: boolean } | { ok: false; code: string };

const normalize = (address: string) => address.trim().toLowerCase();

function codeOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && code ? code : "E_UNKNOWN";
}

/**
 * Sends one email to one address, from EMAIL_FROM. With the test sink on (never in production) it
 * is recorded instead. Never throws: an address CoachMan mustn't email (`undeliverable`), a
 * missing binding (`not_configured`), or the service's refusal comes back as `{ ok: false, code }`,
 * logged with the kind and code, never the address or the text.
 */
export async function sendEmail(db: Db, env: Env, message: OutgoingEmail): Promise<EmailResult> {
  try {
    if (!isDeliverableEmail(message.to)) return { ok: false, code: "undeliverable" };
    const to = normalize(message.to);
    const subject = oneLine(message.subject);
    if (isEmailSinkEnabled(env)) {
      await db.insert(emailSink).values({
        id: uuidv7(),
        workspaceId: message.workspaceId,
        toEmail: to,
        kind: message.kind,
        subject,
        text: message.text,
        html: message.html,
        fromName: message.fromName,
        replyTo: message.replyTo,
      });
      return { ok: true, sink: true };
    }
    const binding = env.EMAIL as SendEmail | undefined;
    if (!binding || !env.EMAIL_FROM) {
      console.error(`Email not sent (${message.kind}): not_configured`);
      return { ok: false, code: "not_configured" };
    }
    await binding.send({
      to,
      from: { email: env.EMAIL_FROM, name: message.fromName },
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      subject,
      text: message.text,
      html: message.html,
    });
    return { ok: true, sink: false };
  } catch (err) {
    const code = codeOf(err);
    console.error(`Email not sent (${message.kind}): ${code}`);
    return { ok: false, code };
  }
}

/**
 * What an academy's emails need: its name and logo, its time zone and locale, and where replies go.
 */
interface AcademyMail {
  workspaceId: string;
  name: string;
  timezone: string;
  locale: string;
  /** The contact email on its profile, when set: family emails' Reply-To. */
  contactEmail: string | null;
  /** Its logo (the public image its website shows) as an absolute link, or null. */
  logoUrl: string | null;
}

async function academyMail(db: Db, env: Env, workspaceId: string): Promise<AcademyMail> {
  const [row] = await db
    .select({
      name: organization.name,
      timezone: workspaceSettings.timezone,
      locale: workspaceSettings.locale,
      contactEmail: academyProfile.contactEmail,
      logoKey: academyProfile.logoKey,
    })
    .from(organization)
    .leftJoin(workspaceSettings, eq(workspaceSettings.workspaceId, organization.id))
    .leftJoin(academyProfile, eq(academyProfile.workspaceId, organization.id))
    .where(eq(organization.id, workspaceId))
    .limit(1);
  const contact = row?.contactEmail;
  return {
    workspaceId,
    name: row?.name ?? "",
    timezone: row?.timezone ?? "UTC",
    locale: row?.locale ?? "en-US",
    contactEmail: isDeliverableEmail(contact) ? normalize(contact) : null,
    logoUrl: row?.logoKey ? publicImageUrl(appOrigin(env), row.logoKey) : null,
  };
}

function compose(
  academy: AcademyMail,
  kind: EmailKind,
  to: string,
  replyTo: string | null,
  draft: EmailDraft,
): OutgoingEmail {
  const { html, text } = renderEmail({ ...draft, logoUrl: academy.logoUrl });
  return {
    to,
    kind,
    workspaceId: academy.workspaceId,
    fromName: fromNameOf(academy.name),
    replyTo,
    subject: draft.subject,
    text,
    html,
  };
}

/** Each person's address, for those CoachMan may email (passkey-only accounts have none). */
async function addressesOf(db: Db, userIds: readonly string[]): Promise<Map<string, string>> {
  const ids = unique(userIds);
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(inList(user.id, ids));
  const out = new Map<string, string>();
  for (const r of rows) if (isDeliverableEmail(r.email)) out.set(r.id, normalize(r.email));
  return out;
}

/**
 * One email to each of these people, once per person, kind, and thing: `email_<kind>` rows are
 * claimed in notification_log (with the push's key) before sending, so a replay, a double click,
 * or a retry never sends twice. Family emails' replies go to the academy's contact email, when it
 * has one. Returns how many went.
 */
async function emailOnce(
  db: Db,
  env: Env,
  input: {
    academy: AcademyMail;
    kind: EmailKind;
    refKey: string;
    userIds: readonly string[];
    replyToAcademy: boolean;
    draft: (userId: string) => EmailDraft | null;
  },
): Promise<number> {
  const addresses = await addressesOf(db, input.userIds);
  if (!addresses.size) return 0;
  const entries = [...addresses.keys()].map((userId) => ({
    userId,
    workspaceId: input.academy.workspaceId,
    kind: `email_${input.kind}`,
    refKey: input.refKey,
  }));
  const claimed = await claimLog(db, entries, Date.now());
  const replyTo = input.replyToAcademy ? input.academy.contactEmail : null;
  let sent = 0;
  for (const entry of entries) {
    if (!claimed.has(logKey(entry))) continue;
    const draft = input.draft(entry.userId);
    const to = addresses.get(entry.userId);
    if (!draft || !to) continue;
    const result = await sendEmail(db, env, compose(input.academy, input.kind, to, replyTo, draft));
    if (result.ok) sent++;
  }
  return sent;
}

// --- Invites (in the request) ------------------------------------------------------------------

/** What an invite's answer says about its email. */
export interface InviteEmailOutcome {
  /** The address it went to (or the sink recorded), or null. */
  emailedTo: string | null;
  /** Why it didn't go, as a short sentence, or null. */
  emailError: string | null;
}

function outcomeOf(to: string, result: EmailResult): InviteEmailOutcome {
  return result.ok
    ? { emailedTo: normalize(to), emailError: null }
    : { emailedTo: null, emailError: emailFailureReason(result.code) };
}

/** An invite's email, sent in the request: whatever goes wrong comes back as its reason. */
async function inviteEmail(
  kind: EmailKind,
  to: string,
  send: () => Promise<EmailResult>,
): Promise<InviteEmailOutcome> {
  let result: EmailResult;
  try {
    result = await send();
  } catch (err) {
    result = { ok: false, code: codeOf(err) };
    console.error(`Email not sent (${kind}): ${result.code}`);
  }
  return outcomeOf(to, result);
}

/** The day an invite link stops working, as the academy writes it ("Tue, Nov 17"). */
const expiresText = (academy: AcademyMail, expiresAt: number) =>
  dayLabel(localDate(expiresAt, academy.timezone), academy.locale);

/** A new staff invite, to the invited address. Replies reach whoever invited them. */
export function emailStaffInvite(
  db: Db,
  env: Env,
  input: {
    workspaceId: string;
    /** Who invited them: their name as the team knows it, and the address replies reach. */
    inviter: { name: string; email: string } | null;
    to: string;
    role: StaffRole;
    link: string;
    expiresAt: number;
  },
): Promise<InviteEmailOutcome> {
  return inviteEmail("staff_invite", input.to, async () => {
    const academy = await academyMail(db, env, input.workspaceId);
    const replyTo =
      input.inviter && isDeliverableEmail(input.inviter.email)
        ? normalize(input.inviter.email)
        : null;
    const draft = staffInviteEmail({
      academy: academy.name,
      inviter: input.inviter?.name ?? "",
      role: input.role,
      email: input.to,
      link: input.link,
      expires: expiresText(academy, input.expiresAt),
    });
    return sendEmail(db, env, compose(academy, "staff_invite", input.to, replyTo, draft));
  });
}

/** A new family invite, to the address staff gave. Replies reach the academy. */
export function emailFamilyInvite(
  db: Db,
  env: Env,
  input: {
    workspaceId: string;
    to: string;
    firstName: string;
    relation: FamilyRelation;
    link: string;
    expiresAt: number;
  },
): Promise<InviteEmailOutcome> {
  return inviteEmail("family_invite", input.to, async () => {
    const academy = await academyMail(db, env, input.workspaceId);
    const replyTo = academy.contactEmail;
    const draft = familyInviteEmail({
      academy: academy.name,
      firstName: input.firstName,
      relation: input.relation,
      link: input.link,
      expires: expiresText(academy, input.expiresAt),
    });
    return sendEmail(db, env, compose(academy, "family_invite", input.to, replyTo, draft));
  });
}

// --- Family updates (after the response) -------------------------------------------------------

const studentOf = (link: Pick<LinkedStudent, "firstName" | "relation">) => ({
  firstName: link.firstName,
  self: link.relation === "self",
});

/** "We got your request": to whoever sent a new request or a renewal. */
export async function emailEnrollmentReceived(
  db: Db,
  env: Env,
  input: { workspaceId: string; requestId: string },
): Promise<void> {
  const req = await openRequest(db, input.workspaceId, input.requestId);
  if (!req) return;
  const academy = await academyMail(db, env, input.workspaceId);
  const { startMonth, answers } = req.r;
  const starts = startMonth
    ? monthLabel(startMonth, academy.locale)
    : answers.startDate
      ? dateLabel(answers.startDate, academy.locale)
      : null;
  await emailOnce(db, env, {
    academy,
    kind: "enrollment_received",
    refKey: req.r.id,
    userIds: [req.r.requestedBy],
    replyToAcademy: true,
    draft: () =>
      enrollmentReceivedEmail({
        academy: academy.name,
        origin: appOrigin(env),
        clientId: req.r.clientId,
        student: { firstName: req.firstName, self: answers.relation === "self" },
        tierName: req.tierName ?? "a package",
        starts,
        renewal: isRenewal(req.r),
      }),
  });
}

/** An enrollment request approved, waitlisted, or declined: everyone linked, never the actor. */
export async function emailEnrollmentDecision(
  db: Db,
  env: Env,
  input: { workspaceId: string; requestId: string; actorUserId: string | null },
  now = Date.now(),
): Promise<void> {
  const decided = await decidedRequest(db, input.workspaceId, input.requestId);
  if (!decided) return;
  const { request, status, amountDue } = decided;
  const [academy, all] = await Promise.all([
    academyMail(db, env, input.workspaceId),
    studentLinks(db, [request.clientId], now),
  ]);
  const links = all.filter((l) => l.workspaceId === input.workspaceId);
  await emailOnce(db, env, {
    academy,
    kind: "enrollment_decision",
    refKey: `${request.id}:${status}`,
    userIds: linkRecipients(links, {
      audience: NOTICE_AUDIENCE.enrollment_decision,
      except: [input.actorUserId],
    }),
    replyToAcademy: true,
    draft: (userId) => {
      const link = links.find((l) => l.userId === userId);
      if (!link) return null;
      return enrollmentDecisionEmail({
        academy: academy.name,
        origin: appOrigin(env),
        requestId: request.id,
        clientId: request.clientId,
        student: studentOf(link),
        status,
        tierName: decided.tierName ?? "the package",
        starts: request.startMonth ? monthLabel(request.startMonth, academy.locale) : null,
        amountDue,
      });
    },
  });
}

/** A payment proof confirmed or not accepted: the payers and whoever sent it, never the actor. */
export async function emailProofDecision(
  db: Db,
  env: Env,
  input: { workspaceId: string; proofId: string; actorUserId: string | null },
  now = Date.now(),
): Promise<void> {
  const proof = await db.query.paymentSubmission.findFirst({
    where: and(
      eq(paymentSubmission.id, input.proofId),
      eq(paymentSubmission.workspaceId, input.workspaceId),
    ),
  });
  if (!proof || (proof.status !== "confirmed" && proof.status !== "rejected")) return;
  const confirmed = proof.status === "confirmed";
  const kind = confirmed ? "proof_confirmed" : "proof_rejected";
  const [academy, all] = await Promise.all([
    academyMail(db, env, input.workspaceId),
    studentLinks(db, [proof.clientId], now),
  ]);
  const links = all.filter((l) => l.workspaceId === input.workspaceId);
  await emailOnce(db, env, {
    academy,
    kind,
    // Confirming again after a void records a new payment: worth a new email, as with the push.
    refKey: confirmed ? `${proof.id}:${proof.paymentId ?? ""}` : proof.id,
    userIds: linkRecipients(links, {
      audience: NOTICE_AUDIENCE[kind],
      also: [proof.submittedBy],
      except: [input.actorUserId],
    }),
    replyToAcademy: true,
    draft: (userId) => {
      const link = links.find((l) => l.userId === userId);
      if (!link) return null;
      return proofDecisionEmail({
        academy: academy.name,
        origin: appOrigin(env),
        clientId: proof.clientId,
        student: studentOf(link),
        confirmed,
        screenshot: Boolean(proof.proofKey),
      });
    },
  });
}

// --- Staff alerts (owners, admins, and the front desk) -----------------------------------------

/** A new enrollment request (or renewal) to review: roles with `enrollment`, alerts on. */
export async function emailStaffEnrollmentRequest(
  db: Db,
  env: Env,
  input: { workspaceId: string; requestId: string; actorUserId: string | null },
): Promise<void> {
  const req = await openRequest(db, input.workspaceId, input.requestId);
  if (!req) return;
  const [academy, users] = await Promise.all([
    academyMail(db, env, input.workspaceId),
    staffAlertUsers(db, input.workspaceId, ["enrollment"], input.actorUserId),
  ]);
  await emailOnce(db, env, {
    academy,
    kind: "staff_enrollment_request",
    refKey: req.r.id,
    userIds: users,
    replyToAcademy: false,
    draft: () =>
      staffEnrollmentRequestEmail({
        academy: academy.name,
        origin: appOrigin(env),
        requestId: req.r.id,
        studentFirstName: req.firstName,
        tierName: req.tierName ?? "a package",
        renewal: isRenewal(req.r),
      }),
  });
}

/** A new payment proof to review: roles that confirm it (`money` too), alerts on. */
export async function emailStaffProof(
  db: Db,
  env: Env,
  input: { workspaceId: string; proofId: string; actorUserId: string | null },
): Promise<void> {
  const proof = await pendingProof(db, input.workspaceId, input.proofId);
  if (!proof) return;
  const [academy, users] = await Promise.all([
    academyMail(db, env, input.workspaceId),
    staffAlertUsers(db, input.workspaceId, ["enrollment", "money"], input.actorUserId),
  ]);
  await emailOnce(db, env, {
    academy,
    kind: "staff_proof",
    refKey: proof.p.id,
    userIds: users,
    replyToAcademy: false,
    draft: () =>
      staffProofEmail({
        academy: academy.name,
        origin: appOrigin(env),
        studentFirstName: proof.firstName,
      }),
  });
}
