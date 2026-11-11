// Transactional email: what CoachMan's emails say and how they look, and which addresses it may
// write to. Pure (no DOM), so the Worker renders them (src/worker/services/email.ts) and the unit
// tests read them.
//
// Privacy, as with pushes: first names only; never amounts, the academy's reasons for declining a
// request or not accepting a payment proof, or health details. An email says what happened and
// links to CoachMan for the rest.

import { type FamilyRelation, isPlaceholderEmail } from "./domain";
import { FAMILY_SIGN_IN } from "./family";
import { firstNameOf } from "./notifications";
import { STAFF_ROLE_DESCRIPTIONS, STAFF_ROLE_NOUNS, type StaffRole } from "./roles";

export const EMAIL_KINDS = [
  "staff_invite",
  "family_invite",
  "enrollment_received",
  "enrollment_decision",
  "proof_confirmed",
  "proof_rejected",
  "staff_enrollment_request",
  "staff_proof",
  "sign_in_code",
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

/**
 * Where a step stands on an email's progress line: done (an ink circle), now (a lime circle, and
 * the step that holds the button or the code), or next (an outlined circle).
 */
export type EmailStepState = "done" | "now" | "next";

/**
 * One step on the progress line. Its title says where it stands in words, so the email reads
 * without its colors: done steps in the past ("Ana invited you"), the step that's now as where
 * things stand or what to do ("Accept the invite"), next steps as what follows.
 */
export interface EmailStep {
  state: EmailStepState;
  title: string;
  text?: string;
}

/** What an email says, before it's rendered. */
export interface EmailContent {
  /** The academy's name, in the header and the footer ("CoachMan" for CoachMan's own emails). */
  academy: string;
  /** The academy's logo as an absolute public link, or null: its initials stand in. */
  logoUrl?: string | null;
  /**
   * Whose email it is: an academy's (default; its tile, its name, and "via CoachMan"), or
   * CoachMan's own (the app icon is the tile, and there's no byline).
   */
  brand?: "academy" | "coachman";
  /** The inbox's preview line (hidden in the email itself). */
  preheader?: string;
  heading: string;
  /** The progress line, first to last: what's done, the one step that's now, what's next. */
  steps: EmailStep[];
  /** The one button, inside the step that's now, with its link written out under the steps. */
  action?: EmailAction;
  /** A sign-in code, in a well inside the step that's now (an email with a code has no button). */
  code?: string;
  /** The small print, in place of "Sent with CoachMan for <Academy>". */
  footer?: string;
}

/** An email of one kind, ready to render: what the builders below return. */
export interface EmailDraft extends EmailContent {
  subject: string;
}

// DESIGN.md's colors. Inline styles carry the light email; the <style> block only adapts it, for
// phones and for apps that honor a dark color scheme (Apple Mail). Apps that darken an email on
// their own (Gmail's and Outlook's) keep dark fills as they are but lighten dark borders, so each
// dark fill also wears a border of its own color: the done circles, the ink line, and the button
// keep an edge there.
const INK = "#111111";
const SLATE = "#5f6066";
const HAIRLINE = "#e4e4e7";
const OUTLINE = "#cfcfd4";
const FOLDER = "#f3f3f4";
const LIME = "#daee63";
const WHITE = "#ffffff";
// The dark color scheme: Command Black, Tile Charcoal, Dark Outline, Panel Seam, Night Mist.
const NIGHT = "#0e0e0f";
const CHARCOAL = "#1c1c1e";
const DARK_OUTLINE = "#38383c";
const SEAM = "#2e2e32";
const MIST = "#a3a3a9";
// DESIGN.md's type stack without its web font, which email apps don't load.
const FONT = "font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;";
// A cell that only holds space, at any app's smallest line.
const SPACER = "font-size:1px;line-height:1px;mso-line-height-rule:exactly;";

const STYLE = [
  ":root{color-scheme:light dark;supported-color-schemes:light dark}",
  "@media (max-width:480px){.cm-col{padding:32px 20px!important}.cm-h1{font-size:28px!important;line-height:32px!important}}",
  "@media (prefers-color-scheme:dark){",
  `.cm-page{background-color:${NIGHT}!important}`,
  `.cm-ink{color:${WHITE}!important}`,
  `.cm-slate{color:${MIST}!important}`,
  `.cm-tile{background-color:${CHARCOAL}!important;color:${WHITE}!important}`,
  `.cm-code{background-color:${CHARCOAL}!important;color:${WHITE}!important}`,
  `.cm-logo{border-color:${WHITE}!important}`,
  `.cm-done{background-color:${WHITE}!important;border-color:${WHITE}!important;color:${NIGHT}!important}`,
  `.cm-next{background-color:${NIGHT}!important;border-color:${DARK_OUTLINE}!important;color:${MIST}!important}`,
  `.cm-line-done{border-color:${WHITE}!important}`,
  `.cm-line-next{border-color:${DARK_OUTLINE}!important}`,
  `.cm-btn,.cm-btn a{background-color:${LIME}!important;border-color:${LIME}!important;color:${INK}!important}`,
  `.cm-link{color:${WHITE}!important}`,
  `.cm-rule{border-color:${SEAM}!important}`,
  "}",
].join("\n");

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Text made safe for HTML, attribute values included. */
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);

/** The small print under every email: one line. */
export const emailFooterLine = (academy: string) => `Sent with CoachMan for ${academy}`;

/** An academy's initials for its tile, as the family portal shows them: "The Pickle Spot" is TP. */
function initialsOf(name: string): string {
  const [first = "", second = ""] = name.trim().split(/\s+/);
  return `${[...first][0] ?? ""}${[...second][0] ?? ""}`.toUpperCase();
}

/** A heading's last two words bound together, so a long one never leaves one word on its last line. */
function withoutWidow(text: string): string {
  return text.trim().split(/\s+/).length < 3 ? text : text.replace(/\s+(\S+)\s*$/, "\u00a0$1");
}

/**
 * The inbox's preview line: the preheader, else the step that's now. Hidden in the email, and
 * padded with invisible characters so the inbox doesn't run on into the email's own words.
 */
function previewOf(input: EmailContent): string {
  const now = input.steps.find((s) => s.state === "now");
  const line = input.preheader ?? now?.text ?? now?.title ?? input.heading;
  return `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(line)}${"&#847;&zwnj;&nbsp;".repeat(80)}</div>`;
}

const row = (style: string, content: string, cls = "") =>
  `<tr><td${cls ? ` class="${cls}"` : ""} style="${style}">${content}</td></tr>`;

const table = (content: string, width = "") =>
  `<table role="presentation"${width ? ` width="${width}"` : ""} cellpadding="0" cellspacing="0" border="0">${content}</table>`;

/**
 * The academy's logo on a white tile, else its initials on a soft one, beside its name. The logo's
 * white is also an image fill, which apps that invert colors leave alone, so a logo drawn on
 * transparency never sinks into a darkened tile there. CoachMan's own emails show its app icon as
 * the tile itself (the icon is its own dark square) and no "via CoachMan" under the name.
 */
function header(input: EmailContent): string {
  const { academy, logoUrl } = input;
  const coachman = input.brand === "coachman";
  const tile =
    logoUrl && coachman
      ? `<td width="44" height="44" valign="middle" style="width:44px;height:44px;"><img src="${escapeHtml(logoUrl)}" alt="" width="44" height="44" style="display:block;width:44px;height:44px;border:0;border-radius:14px;"></td>`
      : logoUrl
        ? `<td width="42" height="42" align="center" valign="middle" class="cm-logo" style="width:42px;height:42px;border:1px solid ${HAIRLINE};border-radius:14px;background-color:${WHITE};background-image:linear-gradient(${WHITE},${WHITE});"><img src="${escapeHtml(logoUrl)}" alt="" width="34" style="display:block;width:auto;height:auto;max-width:34px;max-height:34px;margin:0 auto;border:0;"></td>`
        : `<td width="44" height="44" align="center" valign="middle" class="cm-tile" style="width:44px;height:44px;border-radius:14px;background-color:${FOLDER};${FONT}font-size:14px;line-height:44px;font-weight:600;color:${INK};mso-line-height-rule:exactly;">${escapeHtml(initialsOf(academy))}</td>`;
  const byline = coachman
    ? ""
    : `<div class="cm-slate" style="${FONT}font-size:13px;line-height:18px;color:${SLATE};">via CoachMan</div>`;
  const name = `<div class="cm-ink" style="${FONT}font-size:16px;line-height:20px;font-weight:500;color:${INK};">${escapeHtml(academy)}</div>${byline}`;
  return table(`<tr>${tile}<td style="padding-left:12px;">${name}</td></tr>`);
}

/** A step's 32px circle with its number: ink when done, lime when now, outlined when next. */
function stepCircle(n: number, state: EmailStepState): string {
  const look =
    state === "done"
      ? `width:28px;height:28px;line-height:28px;border:2px solid ${INK};background-color:${INK};color:${WHITE};`
      : state === "now"
        ? `width:28px;height:28px;line-height:28px;border:2px solid ${LIME};background-color:${LIME};color:${INK};`
        : `width:30px;height:30px;line-height:30px;border:1px solid ${OUTLINE};background-color:${WHITE};color:${SLATE};`;
  const cls = state === "now" ? "" : ` class="cm-${state}"`;
  return table(
    `<tr><td align="center" valign="middle"${cls} style="${look}border-radius:16px;${FONT}font-size:13px;font-weight:600;text-align:center;mso-line-height-rule:exactly;">${n}</td></tr>`,
  );
}

/**
 * The ink pill (lime in a dark color scheme). The link carries the padding, so all of the pill
 * opens it; Outlook pads the cell instead (`mso-padding-alt`).
 */
function button(action: EmailAction): string {
  return table(
    `<tr><td align="center" bgcolor="${INK}" class="cm-btn" style="background-color:${INK};border-radius:999px;mso-padding-alt:15px 26px;"><a href="${escapeHtml(action.url)}" target="_blank" style="display:inline-block;padding:15px 25px;border:1px solid ${INK};border-radius:999px;background-color:${INK};${FONT}font-size:16px;line-height:20px;font-weight:500;color:${WHITE};text-decoration:none;">${escapeHtml(action.label)}</a></td></tr>`,
  );
}

/**
 * A sign-in code in a Folder Gray well: one unbroken run of digits, so copying it or a phone's
 * code autofill takes all of it (the space between digits is only letter-spacing, whose trailing
 * bit the right padding gives back).
 */
function codeWell(code: string): string {
  return table(
    `<tr><td class="cm-code" style="padding:14px 16px 14px 20px;border-radius:22px;background-color:${FOLDER};${FONT}font-size:32px;line-height:36px;font-weight:300;letter-spacing:0.12em;font-variant-numeric:tabular-nums;white-space:nowrap;color:${INK};mso-line-height-rule:exactly;">${escapeHtml(code)}</td></tr>`,
  );
}

/**
 * The progress line: each step is a row with its circle and title, then a row with the line down
 * to the next step beside its text (and, in the step that's now, the button, or a code above the
 * text). The line is a 2px border, ink below a done step and Outline Gray after that.
 */
function progressLine(
  steps: readonly EmailStep[],
  action: EmailAction | undefined,
  code: string | undefined,
): string {
  const nowAt = steps.findIndex((s) => s.state === "now");
  const rows = steps.map((step, i) => {
    const last = i === steps.length - 1;
    const next = step.state === "next";
    const title = `<tr><td colspan="3" width="32" valign="top" style="width:32px;">${stepCircle(i + 1, step.state)}</td><td width="16" style="width:16px;${SPACER}">&nbsp;</td><td valign="top" class="${next ? "cm-slate" : "cm-ink"}" style="padding:5px 0 0;${FONT}font-size:16px;line-height:22px;font-weight:500;color:${next ? SLATE : INK};">${escapeHtml(step.title)}</td></tr>`;
    const well =
      code && i === nowAt ? `<div style="padding:8px 0 12px;">${codeWell(code)}</div>` : "";
    const text = step.text
      ? `<div class="cm-slate" style="${FONT}font-size:15px;line-height:22px;color:${SLATE};">${escapeHtml(step.text)}</div>`
      : "";
    const cta =
      action && i === nowAt ? `<div style="padding-top:16px;">${button(action)}</div>` : "";
    if (last && !well && !text && !cta) return title;
    const line = last
      ? `<td style="width:0;${SPACER}"></td>`
      : `<td class="cm-line-${step.state === "done" ? "done" : "next"}" style="width:0;border-left:2px solid ${step.state === "done" ? INK : OUTLINE};${SPACER}">&nbsp;</td>`;
    const body = `<tr><td width="15" style="width:15px;${SPACER}">&nbsp;</td>${line}<td width="15" style="width:15px;${SPACER}">&nbsp;</td><td width="16" style="width:16px;${SPACER}">&nbsp;</td><td valign="top" style="padding:4px 0 ${last ? 0 : 32}px;word-break:break-word;">${well}${text}${cta}</td></tr>`;
    return title + body;
  });
  // An email that only reports (no step is now) still gets its code and its button, under the line.
  if (nowAt === -1 && (code || action)) {
    const cta = action ? button(action) : "";
    const under = code
      ? `${codeWell(code)}${cta ? `<div style="padding-top:16px;">${cta}</div>` : ""}`
      : cta;
    rows.push(
      `<tr><td colspan="4" style="${SPACER}">&nbsp;</td><td style="padding:24px 0 0;">${under}</td></tr>`,
    );
  }
  return table(rows.join(""), "100%");
}

function renderHtml(input: EmailContent): string {
  const rows = [
    row("padding:0 0 40px;", header(input)),
    row(
      "padding:0 0 32px;",
      `<h1 class="cm-ink cm-h1" style="margin:0;${FONT}font-size:32px;line-height:36px;font-weight:300;letter-spacing:-0.02em;color:${INK};text-wrap:balance;">${escapeHtml(withoutWidow(input.heading))}</h1>`,
    ),
    row("padding:0;", progressLine(input.steps, input.action, input.code)),
  ];
  if (input.action) {
    const url = escapeHtml(input.action.url);
    rows.push(
      row(
        `${FONT}font-size:13px;line-height:20px;color:${SLATE};padding:36px 0 0;overflow-wrap:anywhere;word-break:break-word;`,
        `Or open this link: <a href="${url}" target="_blank" class="cm-link" style="color:${INK};text-decoration:underline;">${url}</a>`,
        "cm-slate",
      ),
    );
  }
  rows.push(
    row(
      "padding:28px 0 0;",
      table(
        row(
          `${FONT}font-size:13px;line-height:20px;color:${SLATE};padding:20px 0 0;border-top:1px solid ${HAIRLINE};`,
          escapeHtml(input.footer ?? emailFooterLine(input.academy)),
          "cm-slate cm-rule",
        ),
        "100%",
      ),
    ),
  );
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="x-apple-disable-message-reformatting">',
    // Dates, times, and addresses stay as written, not turned into links in the app's own colors.
    '<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="supported-color-schemes" content="light dark">',
    `<title>${escapeHtml(input.heading)}</title>`,
    `<style>\n${STYLE}\n</style>`,
    // Outlook on Windows takes only the first font it's given, and no light weight: give it the
    // system's own, and its light cut for the heading.
    "<!--[if mso]><style>td,div,a{font-family:'Segoe UI',sans-serif!important}.cm-h1{font-family:'Segoe UI Light','Segoe UI',sans-serif!important}</style><![endif]-->",
    "</head>",
    `<body class="cm-page" style="margin:0;padding:0;background-color:${WHITE};">`,
    previewOf(input),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="cm-page" style="background-color:${WHITE};">`,
    '<tr><td align="center" class="cm-col" style="padding:40px 24px 36px;">',
    // Outlook ignores max-width: a fixed-width table holds the column there.
    '<!--[if mso]><table role="presentation" width="520" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;">',
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
  const nowAt = input.steps.findIndex((s) => s.state === "now");
  const actionLine = input.action ? `${input.action.label}: ${input.action.url}` : null;
  const blocks = [input.heading];
  input.steps.forEach((step, i) => {
    const lines = [`${i + 1}. ${step.title}`];
    if (input.code && i === nowAt) lines.push(input.code);
    if (step.text) lines.push(step.text);
    if (actionLine && i === nowAt) lines.push(actionLine);
    blocks.push(lines.join("\n"));
  });
  if (nowAt === -1) {
    if (input.code) blocks.push(input.code);
    if (actionLine) blocks.push(actionLine);
  }
  blocks.push(input.footer ?? emailFooterLine(input.academy));
  return `${blocks.join("\n\n")}\n`;
}

/**
 * The email's HTML and its plain text, every value escaped in the HTML. The HTML is a 520px
 * column of inline-styled tables: the academy's tile and name, a light heading, the progress line
 * (the button, or a sign-in code, inside the step that's now), the button's link written out, and
 * one footer line, with a dark color scheme for apps that ask for one. Its only image is the
 * academy's logo, the public one its website shows, the same for every reader (or CoachMan's app
 * icon, in CoachMan's own emails).
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

const studentUrl = (origin: string, clientId: string, section: string) =>
  `${origin}/my/${encodeURIComponent(clientId)}/${section}`;

/** A request or renewal's package, and from when ("Monthly from December 2026."). */
const packageLine = (tierName: string, starts: string | null) =>
  `${tierName}${starts ? ` from ${starts}` : ""}.`;

const PROOF_SENT: EmailStep = { state: "done", title: "Payment proof sent" };

/** A staff invite: who invited them, as what, which address to sign in as, until when, and the role. */
export function staffInviteEmail(input: {
  academy: string;
  /** The inviter's name, as the team knows them (their coach profile's name). */
  inviter: string;
  role: StaffRole;
  /** The invited address: the one to sign in as, with Google or a code. */
  email: string;
  link: string;
  /** When the link stops working, already formatted ("Tue, Nov 17"). */
  expires: string;
}): EmailDraft {
  const academy = academyName(input.academy);
  const inviter = oneLine(input.inviter) || "Someone";
  const noun = STAFF_ROLE_NOUNS[input.role];
  return {
    subject: `Join ${academy} on CoachMan`,
    preheader: `${inviter} invited you as ${noun}. The link works once, until ${input.expires}.`,
    academy,
    heading: `Join ${academy} on CoachMan`,
    steps: [
      { state: "done", title: `${inviter} invited you`, text: `To join as ${noun}.` },
      {
        state: "now",
        title: "Sign in",
        text: `As ${input.email}, with Google or a code we email you. The link works once, until ${input.expires}.`,
      },
      { state: "next", title: "You're on the team", text: STAFF_ROLE_DESCRIPTIONS[input.role] },
    ],
    action: { label: `Join ${academy}`, url: input.link },
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
}): EmailDraft {
  const academy = academyName(input.academy);
  const guardian = input.relation === "guardian";
  return {
    subject: `${academy} invited you to its family portal`,
    preheader: guardian
      ? `Follow ${input.firstName}'s training. The link works once, until ${input.expires}.`
      : `See your own training. The link works once, until ${input.expires}.`,
    academy,
    heading: guardian ? `Follow ${input.firstName}'s training` : "See your own training",
    steps: [
      {
        state: "done",
        title: `${academy} invited you`,
        text: guardian
          ? `To follow ${input.firstName}'s training on CoachMan.`
          : "To see your own training on CoachMan.",
      },
      {
        state: "now",
        title: "Accept the invite",
        text: `${FAMILY_SIGN_IN} The link works once, until ${input.expires}.`,
      },
      {
        state: "next",
        title: "You're in",
        text: `${guardian ? `${input.firstName}'s` : "Your"} sessions, progress, coaches' comments, and payments.`,
      },
    ],
    action: { label: "Open the invite", url: input.link },
  };
}

/**
 * A sign-in code, to the address that asked for one. The code leads the subject, where inbox
 * previews and a phone's code autofill read it; the email has no button and no link. With an
 * invite it's the academy's, and says what signing in leads to; without one it's CoachMan's own.
 */
export function signInCodeEmail(input: {
  /** The code itself, digits only. */
  code: string;
  /** The address signing in. */
  email: string;
  /** How long the code works. */
  minutes: number;
  /** The inviting academy's name; null without an invite. */
  academy: string | null;
  invite: "staff" | "family" | null;
}): EmailDraft {
  const academy = input.invite && input.academy !== null ? academyName(input.academy) : null;
  const staff = academy !== null && input.invite === "staff";
  const family = academy !== null && input.invite === "family";
  const then = staff ? `Then join ${academy}.` : family ? "Then accept the invite." : null;
  return {
    subject: `${input.code} is your CoachMan code`,
    preheader: `Enter it on CoachMan within ${input.minutes} minutes.`,
    academy: academy ?? "CoachMan",
    ...(academy === null ? { brand: "coachman" as const } : {}),
    heading: "Your sign-in code",
    steps: [
      {
        state: "done",
        title: "You asked for a code",
        text: staff
          ? `To join ${academy} on CoachMan as ${input.email}.`
          : family
            ? `To accept ${academy}'s invite as ${input.email}.`
            : `To sign in to CoachMan as ${input.email}.`,
      },
      {
        state: "now",
        title: "Enter this code",
        text: `It works once, for the next ${input.minutes} minutes.`,
      },
      { state: "next", title: "You're signed in", ...(then ? { text: then } : {}) },
    ],
    code: input.code,
    footer: "Didn't ask for a code? Ignore this email: nobody can sign in without it.",
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
    academy,
    heading: subject,
    steps: [
      { state: "done", title: "Request sent", text: asked },
      { state: "now", title: "Under review", text: `${academy} will review it and let you know.` },
    ],
    action: {
      label: "See your request",
      url: studentUrl(input.origin, input.clientId, "payments"),
    },
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
}): EmailDraft {
  const academy = academyName(input.academy);
  const { firstName, self } = input.student;
  const isWord = self ? "You're" : `${firstName} is`;
  const portal = { label: "Open CoachMan", url: `${input.origin}/my` };
  const sent: EmailStep = {
    state: "done",
    title: "Request sent",
    text: packageLine(input.tierName, input.starts),
  };
  if (input.status === "approved") {
    const line = `${isWord} in: ${input.tierName}${input.starts ? ` from ${input.starts}` : ""}`;
    if (input.amountDue) {
      return {
        subject: line,
        preheader: "Pay from the portal.",
        academy,
        heading: "Enrollment approved",
        steps: [
          sent,
          { state: "done", title: "Approved", text: `${isWord} in.` },
          {
            state: "now",
            title: "Pay what's due",
            text: "The portal shows how much and how to pay.",
          },
        ],
        action: {
          label: "Pay from the portal",
          url: `${studentUrl(input.origin, input.clientId, "pay")}?request=${encodeURIComponent(input.requestId)}`,
        },
      };
    }
    return {
      subject: line,
      preheader: `${line}.`,
      academy,
      heading: "Enrollment approved",
      steps: [sent, { state: "now", title: "Approved", text: `${isWord} in.` }],
      action: portal,
    };
  }
  if (input.status === "waitlisted") {
    return {
      subject: `${isWord} on the waitlist for ${input.tierName}`,
      academy,
      heading: "Enrollment update",
      steps: [
        sent,
        {
          state: "now",
          title: "On the waitlist",
          text: `${isWord} on the waitlist. Open CoachMan for any note from ${academy}.`,
        },
        {
          state: "next",
          title: "If a place opens",
          text: "You'll get an email when they approve it.",
        },
      ],
      action: portal,
    };
  }
  // Declined: the academy's reason stays inside the app.
  return {
    subject: self
      ? "Your enrollment request was updated"
      : `Your request for ${firstName} was updated`,
    academy,
    heading: "Enrollment update",
    steps: [
      sent,
      {
        state: "now",
        title: "Read their reply",
        text: `Open CoachMan to see ${academy}'s reply about ${self ? "your" : `${firstName}'s`} request.`,
      },
    ],
    action: portal,
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
}): EmailDraft {
  const academy = academyName(input.academy);
  const { firstName, self } = input.student;
  const forWho = self ? "you" : firstName;
  const url = studentUrl(input.origin, input.clientId, "payments");
  if (input.confirmed) {
    return {
      subject: self ? "Payment received" : `Payment received for ${firstName}`,
      academy,
      heading: "Payment confirmed",
      steps: [
        PROOF_SENT,
        {
          state: "now",
          title: "Confirmed",
          text: `${academy} confirmed the payment for ${forWho}.`,
        },
      ],
      action: { label: "See payments", url },
    };
  }
  // Why it wasn't accepted stays inside the app.
  return {
    subject: self ? "Payment proof not accepted" : `Payment proof not accepted for ${firstName}`,
    academy,
    heading: "Payment proof not accepted",
    steps: [
      PROOF_SENT,
      {
        state: "now",
        title: "Send another",
        text: `${academy} couldn't accept the payment ${input.screenshot ? "screenshot" : "proof"} for ${forWho}. Open the portal to see why and send another.`,
      },
      { state: "next", title: "Confirmed", text: `Once ${academy} accepts it.` },
    ],
    action: { label: "See why", url },
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
    academy,
    heading: input.renewal ? "Renewal request" : "New enrollment request",
    steps: [
      { state: "done", title: "Request sent", text: `For ${first}: ${input.tierName}.` },
      {
        state: "now",
        title: "Review it",
        text: "Approve, waitlist, or decline it in Enrollments.",
      },
      {
        state: "next",
        title: "The family hears back",
        text: "CoachMan lets them know what you decide.",
      },
    ],
    action: {
      label: "Review the request",
      url: `${input.origin}/enrollments/${encodeURIComponent(input.requestId)}`,
    },
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
    academy,
    heading: "Payment proof to review",
    steps: [
      { ...PROOF_SENT, text: `For ${first}.` },
      {
        state: "now",
        title: "Review it",
        text: "Confirm it in Money, or mark it not accepted.",
      },
      {
        state: "next",
        title: "The family hears back",
        text: "CoachMan lets them know either way.",
      },
    ],
    action: { label: "Open Money", url: `${input.origin}/money` },
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
