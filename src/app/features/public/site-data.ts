import type {
  PublicAcademyDto,
  PublicPackageDto,
  PublicProgramDto,
  PublicVenueDto,
} from "@shared/api-types";

// Pure helpers for the academy website (landing page, Enroll now, the site frame). Kept free of
// the app's DOM-bound modules so unit tests can import them.

/** Inclusions that already name the uniform (so it isn't listed twice). */
export const UNIFORM_WORDS = /uniform|shirt|jersey/i;

/** A tier's inclusions as families read them: the uniform joins when the tier includes one. */
export function tierInclusions(t: Pick<PublicPackageDto, "inclusions" | "includesUniform">) {
  const out = [...t.inclusions];
  if (t.includesUniform && !out.some((i) => UNIFORM_WORDS.test(i))) {
    out.push("Training uniform included");
  }
  return out;
}

/** The lowest price per head among a program's tiers (`null`: the tiers in no program). */
export function fromPriceMinor(packages: PublicPackageDto[], programId: string | null) {
  return lowestPriceMinor(packages.filter((p) => (p.programId ?? null) === programId));
}

/** The lowest price per head among some tiers, or null with none priced. */
export function lowestPriceMinor(packages: Pick<PublicPackageDto, "priceMinor">[]) {
  const prices = packages
    .map((p) => p.priceMinor)
    .filter((n): n is number => typeof n === "number");
  return prices.length ? Math.min(...prices) : null;
}

/** Where a program meets: the first weekly session with a venue, else its default venue. */
export function programVenue(p: Pick<PublicProgramDto, "schedule" | "venue">) {
  return p.schedule.find((s) => s.venue)?.venue ?? p.venue;
}

/** Every place the academy's programs meet, each once, in the programs' order. */
export function academyVenues(programs: PublicProgramDto[]): PublicVenueDto[] {
  const seen = new Set<string>();
  const out: PublicVenueDto[] = [];
  for (const p of programs) {
    for (const v of [...p.schedule.map((s) => s.venue), p.venue]) {
      if (!v) continue;
      const key = `${v.name}\n${v.address ?? ""}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

/** The soonest next session across the programs, and whose it is. */
export function nextSession(programs: PublicProgramDto[]) {
  let best: { at: number; program: PublicProgramDto } | null = null;
  for (const p of programs) {
    if (p.nextSessionAt && (!best || p.nextSessionAt < best.at)) {
      best = { at: p.nextSessionAt, program: p };
    }
  }
  return best;
}

/** The first sentence of the academy's about text, for the line under its name. */
export function firstSentence(text: string | null | undefined, max = 180): string | null {
  const flat = text?.trim().replace(/\s+/g, " ");
  if (!flat) return null;
  const end = /[.!?](\s|$)/.exec(flat);
  const sentence = end ? flat.slice(0, end.index + 1) : flat;
  return sentence.length <= max ? sentence : null;
}

/**
 * A schedule line ("Tue & Thu · 7:00 – 10:00 PM") split after its last dot, so the days and the
 * time range can be set apart (and the range kept on one line).
 */
export function scheduleLineParts(line: string): { lead: string; time: string } {
  const at = line.lastIndexOf(" · ");
  if (at < 0) return { lead: line, time: "" };
  return { lead: line.slice(0, at + 3), time: line.slice(at + 3) };
}

/** A time range as a pubmat sets it: "7:00 – 10:00 PM" becomes "7–10 PM". */
export function compactTime(range: string): string {
  return range
    .replace(/:00(?=\D|$)/g, "")
    .replace(/\s*[–-]\s*/g, "–")
    .trim();
}

/**
 * The photo the website's first screen holds: the academy's cover, else its first website photo,
 * else a coach's portrait (the team page's photo), else none.
 */
export function heroPhoto(
  a: Pick<PublicAcademyDto, "coverKey" | "photos" | "coaches">,
): { key: string; kind: "cover" | "photo" | "coach" } | null {
  if (a.coverKey) return { key: a.coverKey, kind: "cover" };
  const first = a.photos[0];
  if (first) return { key: first.key, kind: "photo" };
  for (const c of a.coaches) {
    const key = c.portraitKey ?? c.photoKey;
    if (key) return { key, kind: "coach" };
  }
  return null;
}

/**
 * Advance widths (em) of the website's display cut: Archivo at 62% width, weight 900, italic,
 * measured from the shipped font files. Lets a headline be sized to fill its width before it
 * renders; anything not listed counts as an average glyph.
 */
export const DISPLAY_EM: Readonly<Record<string, number>> = {
  A: 0.53,
  B: 0.498,
  C: 0.513,
  D: 0.509,
  E: 0.462,
  F: 0.402,
  G: 0.543,
  H: 0.513,
  I: 0.263,
  J: 0.453,
  K: 0.51,
  L: 0.432,
  M: 0.705,
  N: 0.518,
  O: 0.554,
  P: 0.485,
  Q: 0.554,
  R: 0.509,
  S: 0.469,
  T: 0.475,
  U: 0.503,
  V: 0.49,
  W: 0.729,
  X: 0.5,
  Y: 0.481,
  Z: 0.475,
  "0": 0.444,
  "1": 0.371,
  "2": 0.427,
  "3": 0.44,
  "4": 0.435,
  "5": 0.437,
  "6": 0.445,
  "7": 0.396,
  "8": 0.432,
  "9": 0.445,
  " ": 0.11,
  ".": 0.222,
  ",": 0.222,
  "-": 0.24,
  "–": 0.31,
  "—": 0.62,
  "&": 0.566,
  "'": 0.213,
  "’": 0.204,
  "!": 0.266,
  "?": 0.424,
  ":": 0.222,
  "(": 0.389,
  ")": 0.389,
  "/": 0.278,
  "#": 0.499,
  "+": 0.528,
  "@": 0.688,
  "₱": 0.611,
};

/** The display cut's tracking (letter-spacing), in em. */
export const DISPLAY_TRACKING = -0.01;
/** The display cut's extra word spacing, in em (styles.css `.pm-d1` sets the same). */
export const DISPLAY_WORD_SPACING = 0.08;

/** How wide a line of display caps runs, in em of its font size. */
export function displayEm(text: string): number {
  let w = 0;
  for (const ch of text.toUpperCase()) {
    w += (DISPLAY_EM[ch] ?? 0.5) + DISPLAY_TRACKING + (ch === " " ? DISPLAY_WORD_SPACING : 0);
  }
  return w;
}

/** A short first or last line's free end, where a sticker can sit beside the words. */
export type LineSlot = { line: number; free: number };

/** How much a sticker slot is worth against type size, and what a hole in the middle costs. */
const SLOT_BONUS = 1.12;
const HOLE_SHARE = 0.3;
const HOLE_COST = 0.85;

/**
 * Splits a headline into at most `maxLines` lines (words kept whole, in order) so its widest line
 * is as narrow as it can be, which lets the type run as large as the width allows. Returns the
 * lines and the widest one's width in em; equal widths prefer fewer lines.
 *
 * With `slot` (the share of the widest line a sticker needs), the split also weighs balance: a
 * short first or last line whose free end holds a sticker is worth a little size ("The / Pickle
 * Spot / Academy" with "Now enrolling" beside "The"), and a short middle line, a hole with
 * nothing to fill it, costs some. The chosen slot comes back as `slot`.
 */
export function fitLines(
  text: string,
  maxLines: number,
  opts: { slot?: number } = {},
): { lines: string[]; em: number; slot?: LineSlot } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { lines: [], em: 0 };
  const limit = Math.max(1, Math.min(maxLines, words.length));
  let best: { lines: string[]; em: number; slot?: LineSlot; score: number } | null = null;
  const visit = (start: number, left: number, acc: string[]) => {
    if (left === 1) {
      const lines = [...acc, words.slice(start).join(" ")];
      const widths = lines.map(displayEm);
      const em = Math.max(...widths);
      let score = 1 / em;
      let slot: LineSlot | undefined;
      if (opts.slot && lines.length > 1) {
        const free = (i: number) => (em - (widths[i] ?? em)) / em;
        if (widths.slice(1, -1).some((w) => (em - w) / em > HOLE_SHARE)) score *= HOLE_COST;
        for (const line of [0, lines.length - 1]) {
          if (free(line) >= opts.slot && (!slot || free(line) > slot.free + 1e-9)) {
            slot = { line, free: free(line) };
          }
        }
        if (slot) score *= SLOT_BONUS;
      }
      if (!best || score > best.score + 1e-9) best = { lines, em, slot, score };
      return;
    }
    for (let end = start + 1; end <= words.length - (left - 1); end++) {
      visit(end, left - 1, [...acc, words.slice(start, end).join(" ")]);
    }
  };
  for (let n = 1; n <= limit; n++) visit(0, n, []);
  // `best` is set inside `visit`, which control-flow narrowing can't see.
  const found = best as { lines: string[]; em: number; slot?: LineSlot } | null;
  if (!found) return { lines: words, em: 0 };
  const { lines, em, slot } = found;
  return slot ? { lines, em, slot } : { lines, em };
}
