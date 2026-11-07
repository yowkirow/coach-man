import { type CSSProperties, Fragment, type ReactNode } from "react";
import { displayEm, fitLines } from "./site-data";

// The academy website's own world: an enrollment pubmat in the club's colors. Fields of flat
// color, extra-condensed italic caps, stickers with a white die-cut edge, strips of type laid
// across at an angle, and slanted actions. These are its parts; the pages compose them.

/** A sticker's or photo's turn, in degrees. */
const turn = (deg: number): CSSProperties => ({ "--rot": `${deg}deg` }) as CSSProperties;
/** The hero's stickers land in turn: each one a little after the last. */
const slapAt = (delay: number | undefined): CSSProperties =>
  delay ? { animationDelay: `${delay}ms` } : {};

// ---------------------------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------------------------

export type Field = "green" | "deep" | "blue" | "white" | "lime" | "ink";

/** A panel's color field: the club greens and blue are dark grounds; white and lime are light. */
export const FIELD: Record<Field, string> = {
  green: "pm-halftone pm-dark bg-club text-white",
  deep: "pm-dark bg-club-deep text-white",
  blue: "pm-dark bg-club-blue text-white",
  white: "bg-white text-club-ink",
  lime: "bg-club-ball text-club-ink",
  ink: "pm-dark bg-club-ink text-white",
};

/** The page's column: full width on phones, 1440px with wide margins on desktops. */
export const WRAP = "mx-auto w-full max-w-[1440px] px-5 lg:px-16";

/** A full-bleed field holding one part of the page. */
export function Panel({
  field,
  id,
  labelledBy,
  label,
  className = "",
  children,
}: {
  field: Field;
  id?: string;
  labelledBy?: string;
  /** Its name, when no heading on it says it. */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      className={`relative scroll-mt-14 overflow-hidden lg:scroll-mt-16 ${FIELD[field]} ${className}`}
    >
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Stickers, photos, strips
// ---------------------------------------------------------------------------------------------

export type StickerTone = "lime" | "white" | "blue" | "deep";

const STICKER: Record<StickerTone, string> = {
  lime: "bg-club-ball text-club-ink",
  white: "bg-white text-club-ink",
  blue: "bg-club-blue text-white",
  deep: "bg-club-deep text-white",
};

/** A sticker: one flat color inside a white die-cut edge, slapped on at an angle. */
export function Sticker({
  tone = "lime",
  rot = -4,
  slap = false,
  delay,
  className = "",
  children,
}: {
  tone?: StickerTone;
  rot?: number;
  /** Lands as the page opens (the hero's stickers only). */
  slap?: boolean;
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`pm-sticker ${STICKER[tone]} ${slap ? "pm-slap" : ""} ${className}`}
      style={{ ...turn(rot), ...slapAt(delay) }}
    >
      {children}
    </span>
  );
}

/**
 * A round sticker holding one figure: "From ₱1,200 / head", "DUPR 5.99". `label` is what a screen
 * reader hears; the sticker itself is set for the eye.
 */
export function RoundSticker({
  label,
  top,
  figure,
  bottom,
  tone = "white",
  rot = 7,
  slap = false,
  delay,
  className = "",
}: {
  label: string;
  top?: string;
  figure: string;
  bottom?: string;
  tone?: StickerTone;
  rot?: number;
  slap?: boolean;
  delay?: number;
  /** Its width (the sticker is round), and where it sits. */
  className?: string;
}) {
  return (
    <span
      className={`pm-sticker pm-sticker-round ${STICKER[tone]} ${slap ? "pm-slap" : ""} ${className}`}
      style={{ ...turn(rot), ...slapAt(delay) }}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden className="contents">
        {top ? <span className="text-[0.875em] font-extrabold">{top}</span> : null}
        <span className="pm-d1 num text-[2.35em] leading-[0.9]">{figure}</span>
        {bottom ? <span className="text-[0.875em] font-extrabold">{bottom}</span> : null}
      </span>
    </span>
  );
}

/**
 * A photo stuck on: a white border and a slight turn. `focus` is where the crop centers (a coach's
 * half-body portrait keeps the face; a court photo, its middle).
 */
export function PhotoSticker({
  src,
  alt = "",
  rot = -3,
  focus = "center 35%",
  priority = false,
  slap = false,
  delay,
  className = "",
  children,
}: {
  src: string;
  alt?: string;
  rot?: number;
  focus?: string;
  priority?: boolean;
  slap?: boolean;
  delay?: number;
  /** Its size and aspect (the frame crops the photo to fill it). */
  className?: string;
  /** A sticker pinned over the photo's edge. */
  children?: ReactNode;
}) {
  return (
    <span
      className={`relative block [rotate:var(--rot)] ${slap ? "pm-slap" : ""} ${className}`}
      style={{ ...turn(rot), ...slapAt(delay) }}
    >
      <span className="block size-full overflow-hidden rounded-[18px] border-8 border-white bg-white">
        <img
          src={src}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
          className="size-full object-cover"
          style={{ objectPosition: focus }}
        />
      </span>
      {children}
    </span>
  );
}

/**
 * A strip: a band of type laid across the panel at an angle, reaching past both edges (the panel
 * clips it). `tone` is the band's color.
 */
export function Strip({
  tone = "deep",
  className = "",
  children,
}: {
  tone?: "deep" | "blue" | "ink" | "lime";
  className?: string;
  children: ReactNode;
}) {
  const color = {
    deep: "bg-club-deep text-white",
    blue: "bg-club-blue text-white",
    ink: "bg-club-ink text-white",
    lime: "bg-club-ball text-club-ink",
  }[tone];
  return (
    <div className={`pm-strip relative -mx-16 px-16 py-3 ${color} ${className}`}>{children}</div>
  );
}

/** Tiny tarp grommets in the hero's corners (desktop only; decoration). */
export function Grommets() {
  return (
    <>
      {[
        "top-[18px] left-[18px]",
        "top-[18px] right-[18px]",
        "bottom-[18px] left-[18px]",
        "bottom-[18px] right-[18px]",
      ].map((at) => (
        <span
          key={at}
          aria-hidden
          className={`pointer-events-none absolute z-[2] hidden size-3 rounded-full border-[2.5px] border-club-metal bg-club-ink/40 lg:block ${at}`}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

const SKEW = {
  lime: "bg-club-ball text-club-ink hover:bg-white",
  ink: "bg-club-ink text-club-ball hover:bg-club-deep",
  white: "bg-white text-club-deep hover:bg-club-ball hover:text-club-ink",
} as const;

/**
 * The slanted action: the page's main move (Enroll now) in black italic caps. Put its words in a
 * `SkewLabel` so they stand up straight inside the slant.
 */
export function skewClass(tone: keyof typeof SKEW = "lime", size: "sm" | "md" | "lg" = "lg") {
  const sz =
    size === "lg"
      ? "min-h-14 px-[22px] text-[1.25rem] lg:px-[26px] lg:text-[1.375rem]"
      : size === "md"
        ? "min-h-12 px-5 text-[1.1875rem]"
        : "min-h-[38px] px-3.5 text-[0.9375rem] lg:min-h-11 lg:px-5 lg:text-[1.0625rem]";
  return `pm-skew pm-d2 inline-flex items-center justify-center font-black whitespace-nowrap outline-none transition-colors duration-150 focus-visible:outline-[3px] focus-visible:outline-offset-[3px] ${SKEW[tone]} ${sz}`;
}

export function SkewLabel({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-2.5">{children}</span>;
}

const PILL = {
  white: "bg-white text-club-deep hover:bg-club-ball hover:text-club-ink",
  outline: "text-white ring-2 ring-white ring-inset hover:bg-white hover:text-club-ink",
  outlineInk: "text-club-ink ring-2 ring-club-ink ring-inset hover:bg-club-ink hover:text-white",
  ink: "bg-club-ink text-white hover:bg-club-deep",
} as const;

/** The second move (Message us, Get directions): a plain pill. */
export function pillClass(tone: keyof typeof PILL = "white", extra = "") {
  return `inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full px-[18px] text-[1rem] font-bold outline-none transition-colors duration-150 focus-visible:outline-[3px] focus-visible:outline-offset-[3px] lg:px-[22px] lg:text-[1.0625rem] ${PILL[tone]} ${extra}`;
}

// ---------------------------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------------------------

/** On phones, the share of the name's widest line a sticker needs beside a short line. */
export const NAME_SLOT = 0.5;

/** The phone split of a name, and the short line whose free end can hold a sticker. */
export const phoneName = (text: string) => fitLines(text, 3, { slot: NAME_SLOT });

/**
 * The academy's name as the hero sets it: display caps broken into lines (up to three on phones,
 * two on desktops) and sized so the widest line fills the width. The sizes are measured from the
 * display cut's own glyph widths, so it fits before it renders. On phones `slot` (a sticker) sits
 * beside a short first or last line when the split leaves one ("The [Now enrolling] / Pickle
 * Spot / Academy"); it sizes itself in em of the name.
 */
export function FittedName({
  text,
  id,
  className = "",
  slot,
}: {
  text: string;
  id?: string;
  className?: string;
  slot?: ReactNode;
}) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const phone = phoneName(text);
  const desk = fitLines(text, 2);
  const breaks = (lines: string[]) => {
    const at = new Set<number>();
    let count = 0;
    for (const line of lines.slice(0, -1)) {
      count += line.split(" ").length;
      at.add(count);
    }
    return at;
  };
  const onPhone = breaks(phone.lines);
  const onDesk = breaks(desk.lines);
  // 96% of the width leaves the measured estimate a margin (kerning, rounding).
  const style = {
    "--fit-phone": `${(96 / Math.max(phone.em, 0.5)).toFixed(3)}cqi`,
    "--fit-desk": `${(96 / Math.max(desk.em, 0.5)).toFixed(3)}cqi`,
  } as CSSProperties;
  const size =
    "text-[min(30cqi,var(--fit-phone))] sm:text-[min(150px,var(--fit-phone))] lg:text-[min(168px,var(--fit-desk))]";
  const room = slot && phone.slot ? phone.slot : null;
  // Where the short line's words end, in em of the name's size (the box below shares it).
  const end = room ? displayEm(phone.lines[room.line] ?? "") + 0.2 : 0;
  return (
    <div className="relative @container">
      <h1 id={id} style={style} className={`pm-d1 ${size} whitespace-nowrap ${className}`}>
        {words.map((word, i) => (
          // Words repeat in a name ("Pickle and Pickle Academy"): the index keeps each one apart.
          // biome-ignore lint/suspicious/noArrayIndexKey: words are positional, never reordered.
          <Fragment key={i}>
            {i > 0 ? " " : null}
            {i > 0 && onPhone.has(i) && onDesk.has(i) ? <br /> : null}
            {i > 0 && onPhone.has(i) && !onDesk.has(i) ? <br className="lg:hidden" /> : null}
            {i > 0 && !onPhone.has(i) && onDesk.has(i) ? <br className="hidden lg:inline" /> : null}
            {word}
          </Fragment>
        ))}
      </h1>
      {room ? (
        // Shares the name's size (so em places it), not its display-caps spacing.
        <div
          style={style}
          className={`pointer-events-none absolute inset-x-0 top-0 lg:hidden ${size}`}
        >
          <div
            className="absolute flex h-[0.86em] items-center"
            style={{
              left: `${end}em`,
              top: `${room.line * 0.86}em`,
              width: `${Math.max(phone.em - end, 0)}em`,
            }}
          >
            {slot}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * An empty state as the pubmat says it: a big sticker ("Programs drop soon") set on two lines
 * and as wide as its longer one, then one plain line on what happens next.
 */
export function SoonBlock({
  id,
  title,
  line,
  tone = "lime",
  rot = -4,
  as: Heading = "h2",
}: {
  id?: string;
  title: string;
  line: string;
  tone?: StickerTone;
  rot?: number;
  as?: "h1" | "h2" | "h3";
}) {
  const lines = fitLines(title, 2).lines;
  return (
    <div className="grid justify-items-start gap-6 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center lg:gap-x-[72px]">
      <Heading
        id={id}
        className={`pm-sticker pm-d1 block w-fit max-w-full rounded-[22px] px-[0.28em] pt-[0.2em] pb-[0.14em] text-[clamp(2.75rem,14vw,4.125rem)] leading-[0.86] tracking-[-0.01em] [font-stretch:62%] lg:text-[7.5rem] ${STICKER[tone]}`}
        style={turn(rot)}
      >
        {lines.map((l, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional, never reordered.
          <Fragment key={i}>
            {i > 0 ? " " : null}
            {i > 0 ? <br /> : null}
            {l}
          </Fragment>
        ))}
      </Heading>
      <p className="max-w-[30ch] text-[1.25rem] leading-snug font-semibold lg:text-[1.5rem]">
        {line}
      </p>
    </div>
  );
}
