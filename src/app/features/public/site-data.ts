import type {
  PublicCoachDto,
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

/**
 * The package whose inclusions the landing page shows: the one the academy features, else the
 * one that includes the most (one real package's list, never a blend of several).
 */
export function showcaseTier(packages: PublicPackageDto[]): PublicPackageDto | null {
  const featured = packages.find((p) => p.highlight && tierInclusions(p).length);
  if (featured) return featured;
  let best: PublicPackageDto | null = null;
  for (const p of packages) {
    if (tierInclusions(p).length > (best ? tierInclusions(best).length : 0)) best = p;
  }
  return best;
}

/** The lowest price per head among a program's tiers (`null`: the tiers in no program). */
export function fromPriceMinor(packages: PublicPackageDto[], programId: string | null) {
  const prices = packages
    .filter((p) => (p.programId ?? null) === programId)
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

export interface CoachProof {
  person: PublicCoachDto;
  text: string;
  kind: "highlight" | "certification";
}

/**
 * Up to `limit` lines of proof from the coaches' own profiles: their highlights first, one coach
 * at a time so nobody fills the section alone, then their certifications.
 */
export function coachProof(coaches: PublicCoachDto[], limit = 4): CoachProof[] {
  const out: CoachProof[] = [];
  for (const kind of ["highlight", "certification"] as const) {
    for (let round = 0; out.length < limit; round++) {
      let added = false;
      for (const person of coaches) {
        const text = (kind === "highlight" ? person.highlights : person.certifications)[round];
        if (!text?.trim()) continue;
        out.push({ person, text: text.trim(), kind });
        added = true;
        if (out.length >= limit) break;
      }
      if (!added) break;
    }
  }
  return out;
}

/**
 * A headline in two tones, the opening clause quiet and the rest in ink ("Train with purpose," /
 * "play with joy"). Only a written clause break splits it; anything else stays in one tone.
 */
export function headlineParts(text: string): { quiet: string; strong: string } {
  const line = text.trim().replace(/\s+/g, " ");
  const match = /^(.+?[,;:—–])\s+(.+)$/u.exec(line);
  if (!match?.[1] || !match[2]) return { quiet: "", strong: line };
  const [quiet, strong] = [match[1], match[2]];
  if (quiet.split(" ").length < 2 || strong.split(" ").length < 2)
    return { quiet: "", strong: line };
  return { quiet, strong };
}

/** The first sentence of the academy's about text, for the line under the headline. */
export function firstSentence(text: string | null | undefined, max = 180): string | null {
  const flat = text?.trim().replace(/\s+/g, " ");
  if (!flat) return null;
  const end = /[.!?](\s|$)/.exec(flat);
  const sentence = end ? flat.slice(0, end.index + 1) : flat;
  return sentence.length <= max ? sentence : null;
}

/**
 * A schedule line set large ("Tue & Thu · 7:00 – 10:00 PM") split after its last dot, so the time
 * range can be held on one line and a narrow column breaks after the dot, never inside
 * "10:00 PM". (No-break spaces can't do it: browsers still break after the dash.)
 */
export function scheduleLineParts(line: string): { lead: string; time: string } {
  const at = line.lastIndexOf(" · ");
  if (at < 0) return { lead: line, time: "" };
  return { lead: line.slice(0, at + 3), time: line.slice(at + 3) };
}

/** Words for the ball's arc: the parts joined with dots, ending on one so it repeats cleanly. */
export function ribbonText(parts: (string | null | undefined)[]): string {
  const clean = parts.map((p) => p?.trim()).filter((p): p is string => Boolean(p));
  return clean.length ? `${clean.join("  ·  ")}  ·  ` : "";
}

/** How many copies of a ribbon unit it takes to run past the end of its path, plus one to wrap. */
export function ribbonCopies(pathLength: number, unitLength: number): number {
  if (!(unitLength > 0) || !(pathLength > 0)) return 1;
  return Math.min(40, Math.ceil(pathLength / unitLength) + 1);
}

/**
 * The ball's arc at a given size: the trail that runs in from the left to the ball (`before`),
 * the ball pill, and the band that leaves it toward the top right (`after`). Sized in pixels, so
 * its words keep their size on every screen while the curve follows the width.
 */
export function arcGeometry(width: number, height: number) {
  const compact = width < 640;
  const pillW = compact ? 76 : 136;
  const pillH = compact ? 40 : 60;
  const band = compact ? 30 : 44;
  const cx = width / 2;
  const cy = Math.round(height * (compact ? 0.74 : 0.72));
  const left = cx - pillW / 2;
  const right = cx + pillW / 2;
  // Phones are narrow for their height: the trail starts high near the left edge, and the band
  // ends further off screen, so the part in view is flatter and its words stay legible.
  const rise = compact ? 0.1 : 0.16;
  const fall = compact ? 0.16 : 0.06;
  const startX = compact ? -0.1 : -0.06;
  const endX = compact ? 1.45 : 1.06;
  const f = (n: number) => Math.round(n * 10) / 10;
  const before = `M ${f(startX * width)} ${f(height * rise)} C ${f(width * (compact ? 0.12 : 0.16))} ${f(height * Math.max(0, rise - 0.06))}, ${f(width * 0.3)} ${f(cy)}, ${f(left)} ${f(cy)}`;
  const after = `M ${f(right)} ${f(cy)} C ${f(width * 0.68)} ${f(cy)}, ${f(width * (compact ? 1 : 0.82))} ${f(height * 0.5)}, ${f(width * endX)} ${f(height * fall)}`;
  return { before, after, cx, cy, pillW, pillH, band, fontSize: compact ? 13 : 20 };
}
