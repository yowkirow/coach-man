// Transactional email: what CoachMan's emails say and how they look, and which addresses it may
// write to. Pure (no DOM), so the Worker renders them (src/worker/services/email.ts) and the unit
// tests read them.
//
// Privacy, as with pushes: first names only; never amounts, the academy's reasons for declining a
// request or not accepting a payment proof, or health details. An email says what happened and
// links to CoachMan for the rest.

import { type FamilyRelation, isPlaceholderEmail } from "./domain";
import { FAMILY_SIGN_IN, familyInviteWhat } from "./family";
import { firstNameOf } from "./notifications";
import { STAFF_ROLE_NOUNS, type StaffRole } from "./roles";

export const EMAIL_KINDS = [
  "staff_invite",
  "family_invite",
  "enrollment_received",
  "enrollment_decision",
  "proof_confirmed",
  "proof_rejected",
  "staff_enrollment_request",
  "staff_proof",
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

// --- Addresses ---------------------------------------------------------------------------------

/** One address: no spaces, lists, or display names, and a dotted domain. */
const ADDRESS_RE = /^[^\s@,;:<>()[\]\\"]+@(?:[^\s@,;:<>()[\]\\".]+\.)+[^\s@,;:<>()[\]\\".]+$/;

/**
 * An address CoachMan may email: one well-formed address, never a passkey-only account's
 * placeholder or anything else at a `.invalid` domain.
 */
export function isDeliverableEmail(address: string | null | undefined): address is string {
  const a = (address ?? "").trim().toLowerCase();
  if (!a || a.length > 254 || !ADDRESS_RE.test(a)) return false;
  return !isPlaceholderEmail(a) && !a.endsWith(".invalid");
}

/** Text for a header (a subject, a sender's name): one line, no control characters. */
export const oneLine = (text: string) => text.replace(/[\p{Cc}\s]+/gu, " ").trim();

/** Who an email is from: "<Academy> via CoachMan", or "CoachMan" for an academy without a name. */
export function fromNameOf(academy: string): string {
  const name = oneLine(academy);
  return name ? `${name} via CoachMan` : "CoachMan";
}

// --- Rendering ---------------------------------------------------------------------------------

export interface EmailAction {
  label: string;
  /** An absolute link into CoachMan. */
  url: string;
}

/** What an email says, before it's rendered. */
export interface EmailContent {
  /** The inbox's preview line (hidden in the email itself). */
  preheader?: string;
  heading: string;
  paragraphs: string[];
  /** The one button, with its link written out underneath. */
  action?: EmailAction;
  /** Label and value rows, e.g. ["Package", "Monthly"]. */
  details?: [string, string][];
  /** Small print: who sent it, why this person got it, and whether replies are read. */
  footer: string[];
}

/** An email of one kind, ready to render: what the builders below return. */
export interface EmailDraft extends EmailContent {
  subject: string;
}

const INK = "#111111";
const INK_2 = "#5f6066";
const LINE = "#e4e4e7";
const LIME = "#daee63";
// DESIGN.md's type stack without its web font, which email apps don't load.
const FONT = "font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Text made safe for HTML, attribute values included. */
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);

const row = (style: string, content: string) => `<tr><td style="${style}">${content}</td></tr>`;

function detailsTable(details: readonly [string, string][]): string {
  const cell = `padding:10px 0;border-top:1px solid ${LINE};vertical-align:top;${FONT}`;
  const rows = details
    .map(
      ([label, value]) =>
        `<tr><td width="38%" style="${cell}padding-right:16px;font-size:14px;line-height:22px;color:${INK_2};">${escapeHtml(label)}</td><td style="${cell}font-size:16px;line-height:22px;color:${INK};">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid ${LINE};">${rows}</table>`;
}

/** The Ball Lime button: padding on the cell, so Outlook draws it as well as Gmail does. */
function button(action: EmailAction): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${LIME}" style="background-color:${LIME};border-radius:999px;padding:14px 28px;"><a href="${escapeHtml(action.url)}" target="_blank" style="${FONT}font-size:16px;line-height:20px;font-weight:500;color:${INK};text-decoration:none;display:inline-block;">${escapeHtml(action.label)}</a></td></tr></table>`;
}

function renderHtml(input: EmailContent): string {
  const text = `${FONT}font-size:16px;line-height:24px;color:${INK};`;
  const rows = [
    row(
      `${FONT}font-size:15px;line-height:20px;font-weight:700;color:${INK};padding:0 0 28px;`,
      "CoachMan",
    ),
    row(
      `${FONT}font-size:24px;line-height:29px;font-weight:300;letter-spacing:-0.01em;color:${INK};padding:0 0 16px;`,
      escapeHtml(input.heading),
    ),
    ...input.paragraphs.map((p) => row(`${text}padding:0 0 16px;`, escapeHtml(p))),
  ];
  if (input.details?.length) rows.push(row("padding:8px 0 24px;", detailsTable(input.details)));
  if (input.action) {
    const url = escapeHtml(input.action.url);
    rows.push(
      row("padding:8px 0 16px;", button(input.action)),
      row(
        `${FONT}font-size:14px;line-height:20px;color:${INK_2};padding:0 0 32px;word-break:break-all;`,
        `Or open this link: <a href="${url}" target="_blank" style="color:${INK};text-decoration:underline;">${url}</a>`,
      ),
    );
  }
  rows.push(
    row(
      `${FONT}font-size:13px;line-height:20px;color:${INK_2};padding:20px 0 0;border-top:1px solid ${LINE};`,
      input.footer.map(escapeHtml).join("<br>"),
    ),
  );
  const preheader = input.preheader
    ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(input.preheader)}</div>`
    : "";
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    `<title>${escapeHtml(input.heading)}</title>`,
    "</head>",
    '<body style="margin:0;padding:0;background-color:#ffffff;">',
    preheader,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;">',
    '<tr><td align="center" style="padding:32px 16px;">',
    // Outlook ignores max-width: a fixed-width table holds the column there.
    '<!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">',
    rows.join(""),
    "</table>",
    "<!--[if mso]></td></tr></table><![endif]-->",
    "</td></tr>",
    "</table>",
    "</body>",
    "</html>",
  ].join("\n");
}

function renderText(input: EmailContent): string {
  const blocks = [input.heading, ...input.paragraphs];
  if (input.details?.length) {
    blocks.push(input.details.map(([label, value]) => `${label}: ${value}`).join("\n"));
  }
  if (input.action) blocks.push(`${input.action.label}: ${input.action.url}`);
  blocks.push(input.footer.join("\n"));
  return `${blocks.join("\n\n")}\n`;
}

/**
 * The email's HTML (a 560px column of inline-styled tables, white with ink text, one lime button,
 * no images or tracking) and its plain text, every value escaped in the HTML.
 */
export function renderEmail(input: EmailContent): { html: string; text: string } {
  return { html: renderHtml(input), text: renderText(input) };
}

// --- What each email says ----------------------------------------------------------------------

/** The student an email is about, as its reader knows them. */
export interface EmailStudent {
  firstName: string;
  /** The reader is the student (their own login). */
  self: boolean;
}

const academyName = (name: string) => oneLine(name) || "Your academy";

/** The footer's last line: who a reply reaches, or that replies aren't read. */
export function replyLine(replyName: string | null): string {
  return replyName
    ? `Reply to this email to reach ${replyName}.`
    : "Replies to this address aren't read.";
}

const footerOf = (academy: string, why: string, replyName: string | null) => [
  `Sent by CoachMan for ${academy}.`,
  why,
  replyLine(replyName),
];

/** Why a family member got an update about a student. */
const linkedWhy = (academy: string, s: EmailStudent) =>
  s.self
    ? `You have your own login to ${academy}'s family portal.`
    : `You're linked to ${s.firstName} in ${academy}'s family portal.`;

const staffWhy = (academy: string) =>
  `You're on ${academy}'s team. To stop these, turn off Enrollments & payments in Settings, Notifications.`;

const studentUrl = (origin: string, clientId: string, section: string) =>
  `${origin}/my/${encodeURIComponent(clientId)}/${section}`;

/** A staff invite: who invited them, as what, which Google account to use, and until when. */
export function staffInviteEmail(input: {
  academy: string;
  /** The inviter's name. */
  inviter: string;
  role: StaffRole;
  /** The invited address: the Google account to sign in with. */
  email: string;
  link: string;
  /** When the link stops working, already formatted ("Tue, Nov 17"). */
  expires: string;
  /** Replies reach the inviter (their address is the Reply-To). */
  replies: boolean;
}): EmailDraft {
  const academy = academyName(input.academy);
  const inviter = oneLine(input.inviter) || "Someone";
  const noun = STAFF_ROLE_NOUNS[input.role];
  return {
    subject: `Join ${academy} on CoachMan`,
    preheader: `${inviter} invited you as ${noun}. The link works once, until ${input.expires}.`,
    heading: `Join ${academy} on CoachMan`,
    paragraphs: [
      `${inviter} invited you to join ${academy} on CoachMan as ${noun}.`,
      `Sign in with Google as ${input.email}.`,
      `The link works once, until ${input.expires}.`,
    ],
    action: { label: `Join ${academy}`, url: input.link },
    footer: footerOf(
      academy,
      `${inviter} invited this address to ${academy}'s team.`,
      input.replies ? inviter : null,
    ),
  };
}

/** A family invite: whose training it opens, how to sign in, and until when. */
export function familyInviteEmail(input: {
  academy: string;
  /** The student's first name. */
  firstName: string;
  relation: FamilyRelation;
  link: string;
  /** When the link stops working, already formatted ("Tue, Nov 17"). */
  expires: string;
  /** Replies reach the academy (its contact address is the Reply-To). */
  replies: boolean;
}): EmailDraft {
  const academy = academyName(input.academy);
  const guardian = input.relation === "guardian";
  return {
    subject: `${academy} invited you to its family portal`,
    preheader: guardian
      ? `Follow ${input.firstName}'s training. The link works once, until ${input.expires}.`
      : `See your own training. The link works once, until ${input.expires}.`,
    heading: guardian ? `Follow ${input.firstName}'s training` : "See your own training",
    paragraphs: [
      `${academy} invited you ${familyInviteWhat(input.relation, input.firstName)}`,
      FAMILY_SIGN_IN,
      `The link works once, until ${input.expires}.`,
    ],
    action: { label: "Open the invite", url: input.link },
    footer: footerOf(
      academy,
      `${academy} invited this address to its family portal.`,
      input.replies ? academy : null,
    ),
  };
}

/** "We got your request": to whoever sent an enrollment request or a renewal. */
export function enrollmentReceivedEmail(input: {
  academy: string;
  origin: string;
  clientId: string;
  student: EmailStudent;
  tierName: string;
  /** When it starts, already formatted ("December 2026"), or null (a trial session). */
  starts: string | null;
  renewal: boolean;
  /** Replies reach the academy. */
  replies: boolean;
}): EmailDraft {
  const academy = academyName(input.academy);
  const { firstName, self } = input.student;
  const asked = input.renewal
    ? `You asked to renew ${self ? "your" : `${firstName}'s`} ${input.tierName}${input.starts ? ` for ${input.starts}` : ""}.`
    : `You asked to enroll ${self ? "" : `${firstName} `}in ${input.tierName}${input.starts ? ` from ${input.starts}` : ""}.`;
  const subject = self ? "We got your enrollment request" : `We got your request for ${firstName}`;
  return {
    subject,
    preheader: `${academy} will review it and let you know.`,
    heading: subject,
    paragraphs: [asked, `${academy} will review it and let you know.`],
    action: {
      label: "See your request",
      url: studentUrl(input.origin, input.clientId, "payments"),
    },
    footer: footerOf(
      academy,
      self ? `You sent ${academy} an enrollment request.` : `You asked to enroll ${firstName}.`,
      input.replies ? academy : null,
    ),
  };
}

/**
 * An enrollment request approved, waitlisted, or declined, to everyone linked to the student (the
 * push's wording, never an amount or the academy's reason).
 */
export function enrollmentDecisionEmail(input: {
  academy: string;
  origin: string;
  requestId: string;
  clientId: string;
  student: EmailStudent;
  status: "approved" | "waitlisted" | "declined";
  tierName: string;
  /** The month it starts, already formatted ("December 2026"), or null. */
  starts: string | null;
  /** Something is owed for it (never how much). */
  amountDue: boolean;
  /** Replies reach the academy. */
  replies: boolean;
}): EmailDraft {
  const academy = academyName(input.academy);
  const { firstName, self } = input.student;
  const isWord = self ? "You're" : `${firstName} is`;
  const portal = { label: "Open CoachMan", url: `${input.origin}/my` };
  const footer = footerOf(
    academy,
    linkedWhy(academy, input.student),
    input.replies ? academy : null,
  );
  if (input.status === "approved") {
    const line = `${isWord} in: ${input.tierName}${input.starts ? ` from ${input.starts}` : ""}`;
    return {
      subject: line,
      preheader: input.amountDue ? "Pay from the portal." : `${line}.`,
      heading: "Enrollment approved",
      paragraphs: [
        `${line}.`,
        ...(input.amountDue ? ["Pay from the portal: it shows what's due and how to pay."] : []),
      ],
      action: input.amountDue
        ? {
            label: "Pay from the portal",
            url: `${studentUrl(input.origin, input.clientId, "pay")}?request=${encodeURIComponent(input.requestId)}`,
          }
        : portal,
      footer,
    };
  }
  if (input.status === "waitlisted") {
    const line = `${isWord} on the waitlist for ${input.tierName}`;
    return {
      subject: line,
      heading: "Enrollment update",
      paragraphs: [`${line}.`, `Open CoachMan for any note from ${academy}.`],
      action: portal,
      footer,
    };
  }
  // Declined: the academy's reason stays inside the app.
  return {
    subject: self
      ? "Your enrollment request was updated"
      : `Your request for ${firstName} was updated`,
    heading: "Enrollment update",
    paragraphs: [
      `Open CoachMan to see ${academy}'s reply about ${self ? "your" : `${firstName}'s`} request.`,
    ],
    action: portal,
    footer,
  };
}

/**
 * A payment proof confirmed or not accepted, to the payers and whoever sent it (never the amount
 * or the academy's reason).
 */
export function proofDecisionEmail(input: {
  academy: string;
  origin: string;
  clientId: string;
  student: EmailStudent;
  confirmed: boolean;
  /** The proof was a screenshot (not cash at the court). */
  screenshot: boolean;
  /** Replies reach the academy. */
  replies: boolean;
}): EmailDraft {
  const academy = academyName(input.academy);
  const { firstName, self } = input.student;
  const forWho = self ? "you" : firstName;
  const url = studentUrl(input.origin, input.clientId, "payments");
  const footer = footerOf(
    academy,
    linkedWhy(academy, input.student),
    input.replies ? academy : null,
  );
  if (input.confirmed) {
    return {
      subject: self ? "Payment received" : `Payment received for ${firstName}`,
      heading: "Payment confirmed",
      paragraphs: [`${academy} confirmed the payment for ${forWho}.`],
      action: { label: "See payments", url },
      footer,
    };
  }
  // Why it wasn't accepted stays inside the app.
  return {
    subject: self ? "Payment proof not accepted" : `Payment proof not accepted for ${firstName}`,
    heading: "Payment proof not accepted",
    paragraphs: [
      `${academy} couldn't accept the payment ${input.screenshot ? "screenshot" : "proof"} for ${forWho}. Open the portal to see why and send another.`,
    ],
    action: { label: "See why", url },
    footer,
  };
}

/** A new enrollment request (or renewal) to review, to staff (staffEnrollmentPayload's wording). */
export function staffEnrollmentRequestEmail(input: {
  academy: string;
  origin: string;
  requestId: string;
  studentFirstName: string;
  tierName: string;
  renewal: boolean;
}): EmailDraft {
  const academy = academyName(input.academy);
  const first = firstNameOf(input.studentFirstName);
  return {
    subject: input.renewal ? `Renewal request for ${first}` : `New enrollment request for ${first}`,
    preheader: `${first} · ${input.tierName}`,
    heading: input.renewal ? "Renewal request" : "New enrollment request",
    paragraphs: ["Review it in Enrollments."],
    details: [
      ["Student", first],
      ["Package", input.tierName],
    ],
    action: {
      label: "Review the request",
      url: `${input.origin}/enrollments/${encodeURIComponent(input.requestId)}`,
    },
    footer: footerOf(academy, staffWhy(academy), null),
  };
}

/** A new payment proof to review, to staff (staffProofPayload's wording, never the amount). */
export function staffProofEmail(input: {
  academy: string;
  origin: string;
  studentFirstName: string;
}): EmailDraft {
  const academy = academyName(input.academy);
  const first = firstNameOf(input.studentFirstName);
  return {
    subject: `Payment proof to review for ${first}`,
    heading: "Payment proof to review",
    paragraphs: [`For ${first}. Review it in Money.`],
    action: { label: "Open Money", url: `${input.origin}/money` },
    footer: footerOf(academy, staffWhy(academy), null),
  };
}

// --- When an invite's email didn't go ----------------------------------------------------------

/** Why an email didn't go, as a short sentence, from sendEmail's code (Cloudflare's or ours). */
export function emailFailureReason(code: string): string {
  switch (code) {
    case "undeliverable":
      return "That address can't receive email.";
    case "not_configured":
      return "Email isn't set up here.";
    case "E_RECIPIENT_SUPPRESSED":
      return "Email to that address bounced or was refused before.";
    case "E_RATE_LIMIT_EXCEEDED":
      return "Too many emails went out at once.";
    case "E_DAILY_LIMIT_EXCEEDED":
      return "CoachMan reached today's email limit.";
    case "E_RECIPIENT_NOT_ALLOWED":
      return "CoachMan can't email that address.";
    case "E_SENDER_NOT_VERIFIED":
      return "CoachMan's sending address isn't verified yet.";
    case "E_VALIDATION_ERROR":
      return "The email service didn't accept that address.";
    default:
      return "The email service didn't take it.";
  }
}

/**
 * What an invite sheet says about its email: "We emailed the link to …", or why it couldn't
 * (null when no email was asked for).
 */
export function inviteEmailNote(result: {
  emailedTo: string | null;
  emailError: string | null;
}): string | null {
  if (result.emailedTo) return `We emailed the link to ${result.emailedTo}.`;
  if (result.emailError) {
    return `We couldn't email the link: ${result.emailError.replace(/\.$/, "")}. Copy it and send it yourself.`;
  }
  return null;
}
