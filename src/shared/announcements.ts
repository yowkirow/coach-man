// Announcements: where one stands (draft, scheduled, live, expired), which families it reaches,
// the order families and staff read them in, and how its plain-text body is shown (paragraphs and
// links, never HTML). Pure, so the Worker, the app, and the unit tests share the rules.

import type { AnnouncementAudience } from "./domain";

export const ANNOUNCEMENT_STATES = ["draft", "scheduled", "live", "expired"] as const;
export type AnnouncementState = (typeof ANNOUNCEMENT_STATES)[number];

export const ANNOUNCEMENT_STATE_LABELS: Record<AnnouncementState, string> = {
  draft: "Drafts",
  scheduled: "Scheduled",
  live: "Live",
  expired: "Expired",
};

export const ANNOUNCEMENT_AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
  all: "Everyone",
  program: "A program",
  event: "An event",
};

export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 4000;
/** How far ahead an announcement may be scheduled. */
export const ANNOUNCEMENT_MAX_AHEAD_MS = 366 * 86_400_000;

export interface AnnouncementTimes {
  /** Null while it's a draft. */
  publishedAt: number | null;
  expiresAt: number | null;
}

/**
 * A draft has no publish time; a scheduled one goes live at a time still ahead; a live one is
 * published and hasn't reached its end; an expired one has.
 */
export function announcementState(a: AnnouncementTimes, now: number): AnnouncementState {
  if (a.publishedAt === null) return "draft";
  if (a.publishedAt > now) return "scheduled";
  if (a.expiresAt !== null && a.expiresAt <= now) return "expired";
  return "live";
}

/** `${workspaceId}:${id}`: a program or event of one academy. */
export const audienceKey = (workspaceId: string, id: string) => `${workspaceId}:${id}`;

/**
 * What a family's linked students belong to, by academy: the academies they train at, the
 * programs (groups) they're current members of, and the events they're registered for (not
 * cancelled). Built by the Worker from the caller's active links.
 */
export interface FamilyAudience {
  workspaceIds: ReadonlySet<string>;
  /** `audienceKey(workspaceId, groupId)` */
  programs: ReadonlySet<string>;
  /** `audienceKey(workspaceId, eventId)` */
  events: ReadonlySet<string>;
}

export interface AudienceTarget extends AnnouncementTimes {
  workspaceId: string;
  audience: AnnouncementAudience;
  audienceId: string | null;
}

/**
 * Whether a family sees an announcement now: it's live, from an academy where they have a linked
 * student, and for everyone there, or for a program one of their students is a current member of,
 * or for an event one of their students is registered for.
 */
export function reachesFamily(a: AudienceTarget, family: FamilyAudience, now: number): boolean {
  if (announcementState(a, now) !== "live") return false;
  if (!family.workspaceIds.has(a.workspaceId)) return false;
  switch (a.audience) {
    case "all":
      return true;
    case "program":
      return (
        Boolean(a.audienceId) && family.programs.has(audienceKey(a.workspaceId, a.audienceId ?? ""))
      );
    case "event":
      return (
        Boolean(a.audienceId) && family.events.has(audienceKey(a.workspaceId, a.audienceId ?? ""))
      );
    default:
      return false;
  }
}

interface Sortable {
  id: string;
  pinned: boolean;
  publishedAt: number | null;
  expiresAt: number | null;
  updatedAt: number;
}

/** How families (and Today) read them: pinned first, then newest first. */
export function compareLive(a: Sortable, b: Sortable): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return (b.publishedAt ?? 0) - (a.publishedAt ?? 0) || a.id.localeCompare(b.id);
}

/**
 * Each staff tab's order: drafts by last edit, scheduled soonest first, live as families read
 * them, expired most recently ended first.
 */
export function sortForState<T extends Sortable>(state: AnnouncementState, items: T[]): T[] {
  const out = [...items];
  switch (state) {
    case "draft":
      return out.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    case "scheduled":
      return out.sort(
        (a, b) => (a.publishedAt ?? 0) - (b.publishedAt ?? 0) || a.id.localeCompare(b.id),
      );
    case "live":
      return out.sort(compareLive);
    case "expired":
      return out.sort(
        (a, b) => (b.expiresAt ?? 0) - (a.expiresAt ?? 0) || a.id.localeCompare(b.id),
      );
  }
}

export type PublishMode = "draft" | "now" | "schedule";

export type PublishCheck =
  | { ok: true; publishedAt: number | null; expiresAt: number | null }
  | { ok: false; field: "publishAt" | "expiresAt"; message: string };

/**
 * When a save publishes it: a draft has no time; "now" keeps the original time of one that's
 * already live (fixing a typo doesn't make it news again) and is the server's now otherwise;
 * "schedule" is a time ahead (within a year). The end, when set, must come after it's published
 * and not have passed (an end already stored may stay as it is).
 */
export function resolvePublish(input: {
  mode: PublishMode;
  publishAt?: number | null;
  expiresAt?: number | null;
  current?: AnnouncementTimes | null;
  now: number;
}): PublishCheck {
  const { mode, now } = input;
  const current = input.current ?? null;
  let publishedAt: number | null;
  if (mode === "draft") publishedAt = null;
  else if (mode === "now") {
    publishedAt =
      current?.publishedAt !== null &&
      current?.publishedAt !== undefined &&
      current.publishedAt <= now
        ? current.publishedAt
        : now;
  } else {
    const at = input.publishAt ?? null;
    if (at === null || !Number.isFinite(at)) {
      return { ok: false, field: "publishAt", message: "Pick when it should go live." };
    }
    if (at <= now) {
      return {
        ok: false,
        field: "publishAt",
        message: "Pick a time that's still ahead, or publish now.",
      };
    }
    if (at > now + ANNOUNCEMENT_MAX_AHEAD_MS) {
      return {
        ok: false,
        field: "publishAt",
        message: "Schedule it within the next year.",
      };
    }
    publishedAt = at;
  }
  const expiresAt = input.expiresAt ?? null;
  if (expiresAt !== null) {
    const unchanged = current?.expiresAt === expiresAt;
    if (!unchanged && expiresAt <= now) {
      return { ok: false, field: "expiresAt", message: "Pick an end that's still ahead." };
    }
    if (publishedAt !== null && expiresAt <= publishedAt) {
      return {
        ok: false,
        field: "expiresAt",
        message: "The end has to come after it goes live.",
      };
    }
  }
  return { ok: true, publishedAt, expiresAt };
}

// --- The body: plain text with paragraphs and links ----------------------------------------------

/** Paragraphs of a plain-text body (a blank line starts a new one; single line breaks stay). */
export function announcementParagraphs(body: string): string[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.replace(/[ \t]+$/gm, "").trim())
    .filter(Boolean);
}

export type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string };

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const TRAILING = /[.,;:!?'"\]}>]+$/;

/** A web address as typed, or null when it isn't a plain http(s) link. */
function hrefOf(raw: string): string | null {
  const candidate = /^www\./i.test(raw) ? `https://${raw}` : raw;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Splits text into plain runs and web links (http, https, or www. addresses), so the app can show
 * links without ever reading the text as HTML. Punctuation that ends a sentence stays outside the
 * link, and a closing parenthesis only belongs to a link that opened one.
 */
export function linkify(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    let raw = match[0];
    for (;;) {
      const trimmed = raw.replace(TRAILING, "");
      const unbalanced =
        trimmed.endsWith(")") &&
        (trimmed.match(/\(/g)?.length ?? 0) < (trimmed.match(/\)/g)?.length ?? 0);
      const next = unbalanced ? trimmed.slice(0, -1) : trimmed;
      if (next === raw) break;
      raw = next;
    }
    const href = raw ? hrefOf(raw) : null;
    if (!href) continue;
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    out.push({ kind: "link", text: raw, href });
    last = start + raw.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** The start of a body on one line, for compact cards. */
export function announcementExcerpt(body: string, max = 140): string {
  const line = body.replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s.,;:!-]+$/, "")}…`;
}
