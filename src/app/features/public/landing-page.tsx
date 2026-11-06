import type { PublicAcademyDto, PublicCoachDto, PublicProgramDto } from "@shared/api-types";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight, MapPin } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { buttonClass } from "../../components/ui/button";
import { publicFileUrl } from "../../lib/api";
import type { Format } from "../../lib/format";
import { TeamFace, TeamPortrait } from "./people";
import { ProgramPlaceRows } from "./public-ui";
import type { PublicPage } from "./queries";
import {
  CONTACT_ICON,
  canEnroll,
  contactLabel,
  previewSearch,
  QuestionsBox,
  SiteFrame,
} from "./site";
import {
  academyVenues,
  arcGeometry,
  coachProof,
  firstSentence,
  fromPriceMinor,
  headlineParts,
  nextSession,
  programVenue,
  ribbonCopies,
  ribbonText,
  showcaseTier,
  tierInclusions,
} from "./site-data";
import { EVERYONE, programTeams } from "./team";
import {
  agesLabel,
  contactActions,
  directionsUrl,
  scheduleLines,
  sessionLength,
  tiersOf,
} from "./text";

/** "A", "A and B", "A, B, and C", "A, B, C, and 2 more". */
function joinNames(names: string[], shown = 3): string {
  const head = names.slice(0, shown);
  const more = names.length - head.length;
  if (more > 0) return `${head.join(", ")}, and ${more} more`;
  if (head.length <= 2) return head.join(" and ");
  return `${head.slice(0, -1).join(", ")}, and ${head.at(-1)}`;
}

/** The line under the headline: the academy's own first sentence, else what it runs and where. */
function heroLine(academy: PublicAcademyDto): string | null {
  const own = firstSentence(academy.about);
  if (own) return own;
  if (!academy.programs.length) return null;
  const venue = academyVenues(academy.programs)[0];
  return `${joinNames(academy.programs.map((p) => p.name))}${venue ? ` at ${venue.name}` : ""}.`;
}

const display = "font-display tracking-[-0.02em]";

// ---------------------------------------------------------------------------------------------
// The ball's arc
// ---------------------------------------------------------------------------------------------

/**
 * Moves the arc's words along their paths: a slow drift, sped up (or turned back) by the page's
 * own scroll. Runs only while the arc is on screen; with reduced motion the words hold still.
 */
function useArcMotion(
  host: React.RefObject<HTMLDivElement | null>,
  paths: React.RefObject<SVGTextPathElement | null>[],
  units: number[],
) {
  useEffect(() => {
    const el = host.current;
    const texts = paths.map((r) => r.current);
    if (!el || texts.some((t) => !t) || units.some((u) => !(u > 0))) return;
    const place = (phase: number) => {
      texts.forEach((t, i) => {
        const u = units[i] ?? 1;
        t?.setAttribute("startOffset", String((((phase % u) + u) % u) - u));
      });
    };
    place(0);
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    let phase = 0;
    let raf = 0;
    let visible = false;
    let last = 0;
    let lastY = window.scrollY;
    const tick = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      const y = window.scrollY;
      phase += dt * 0.028 + (y - lastY) * 0.9;
      lastY = y;
      place(phase);
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (raf || !visible || document.hidden) return;
      last = 0;
      lastY = window.scrollY;
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      start();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", start);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", start);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [host, paths, units]);
}

/**
 * The hero's signature: the academy's own words riding a pickleball's arc. The programs trail in
 * from the left in Pewter, meet the ball, and leave as when and where on an ink band. Drawn in
 * pixels at the screen's width, so the words keep their size while the curve follows the width.
 */
function BallArc({
  before,
  after,
  status,
}: {
  before: string;
  after: string;
  status: string | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const beforeText = useRef<SVGTextPathElement>(null);
  const afterText = useRef<SVGTextPathElement>(null);
  const beforeUnit = useRef<SVGTextElement>(null);
  const afterUnit = useRef<SVGTextElement>(null);
  const beforePath = useRef<SVGPathElement>(null);
  const afterPath = useRef<SVGPathElement>(null);
  const [width, setWidth] = useState(0);
  const [units, setUnits] = useState<number[]>([0, 0]);
  const [copies, setCopies] = useState<number[]>([8, 8]);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const paths = useRef([beforeText, afterText]).current;

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = width < 640 ? 150 : 260;
  const geo = width ? arcGeometry(width, height) : null;

  // One copy of each line measured, then enough copies to cover its path and wrap seamlessly.
  const measureKey = geo ? `${geo.before}|${geo.after}|${before}|${after}` : "";
  useLayoutEffect(() => {
    if (!measureKey) return;
    const next = [beforeUnit.current, afterUnit.current].map((t) => {
      try {
        return t?.getComputedTextLength() ?? 0;
      } catch {
        return 0;
      }
    });
    const lengths = [beforePath.current, afterPath.current].map((p) => {
      try {
        return p?.getTotalLength() ?? 0;
      } catch {
        return 0;
      }
    });
    setUnits((u) => (u[0] === next[0] && u[1] === next[1] ? u : next));
    const need = next.map((u, i) => ribbonCopies(lengths[i] ?? 0, u) + 1);
    setCopies((c) => (c[0] === need[0] && c[1] === need[1] ? c : need));
  }, [measureKey]);

  useArcMotion(host, paths, units);

  const textStyle = { fontSize: geo?.fontSize ?? 20, letterSpacing: "0.01em" };
  return (
    <div ref={host} aria-hidden className="relative w-full overflow-hidden" style={{ height }}>
      {geo ? (
        <svg
          aria-hidden="true"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="absolute inset-0"
          focusable="false"
        >
          <defs>
            <path ref={beforePath} id={`${id}-before`} d={geo.before} />
            <path ref={afterPath} id={`${id}-after`} d={geo.after} />
          </defs>
          <text ref={beforeUnit} visibility="hidden" style={textStyle} className="font-medium">
            {before}
          </text>
          <text ref={afterUnit} visibility="hidden" style={textStyle} className="font-semibold">
            {after}
          </text>
          <text dy={geo.fontSize * 0.34} style={textStyle} className="fill-ink-3 font-medium">
            <textPath ref={beforeText} href={`#${id}-before`}>
              {before.repeat(copies[0] ?? 1)}
            </textPath>
          </text>
          <use
            href={`#${id}-after`}
            className="fill-none stroke-ink"
            strokeWidth={geo.band}
            strokeLinecap="butt"
          />
          <text dy={geo.fontSize * 0.34} style={textStyle} className="fill-ivory font-semibold">
            <textPath ref={afterText} href={`#${id}-after`}>
              {after.repeat(copies[1] ?? 1)}
            </textPath>
          </text>
          <g transform={`translate(${geo.cx} ${geo.cy})`}>
            <rect
              x={-geo.pillW / 2}
              y={-geo.pillH / 2}
              width={geo.pillW}
              height={geo.pillH}
              rx={geo.pillH / 2}
              className="fill-ivory stroke-ink"
              strokeWidth={3}
            />
            {[0.3, 0.2, 0.1].map((o, i) => (
              <circle
                key={o}
                cx={-geo.pillW * (0.07 + i * 0.13)}
                cy={0}
                r={geo.pillH * (0.09 - i * 0.02)}
                className="fill-ink"
                opacity={1 - i * 0.3}
              />
            ))}
            <g transform={`translate(${geo.pillW * 0.2} 0)`}>
              <circle r={geo.pillH * 0.32} className="fill-lime stroke-ink" strokeWidth={2} />
              {[
                [0, -0.5],
                [-0.42, -0.18],
                [0.42, -0.18],
                [0, 0.06],
                [-0.3, 0.38],
                [0.3, 0.38],
              ].map(([x = 0, y = 0]) => (
                <circle
                  key={`${x}${y}`}
                  cx={x * geo.pillH * 0.32}
                  cy={y * geo.pillH * 0.32}
                  r={geo.pillH * 0.045}
                  className="fill-ink"
                />
              ))}
            </g>
          </g>
          {status ? (
            <g
              transform={`translate(${geo.cx} ${geo.cy - geo.pillH / 2 - (width < 640 ? 26 : 34)})`}
            >
              <rect
                x={-(status.length * (width < 640 ? 7 : 8.2) + 32) / 2}
                y={width < 640 ? -14 : -17}
                width={status.length * (width < 640 ? 7 : 8.2) + 32}
                height={width < 640 ? 28 : 34}
                rx={width < 640 ? 14 : 17}
                className="fill-court"
              />
              <text
                textAnchor="middle"
                dy={width < 640 ? 4.5 : 5.5}
                style={{ fontSize: width < 640 ? 12.5 : 14.5 }}
                className="fill-court-ink font-semibold"
              >
                {status}
              </text>
            </g>
          ) : null}
        </svg>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

function Hero({
  academy,
  slug,
  preview,
  fmt,
}: {
  academy: PublicAcademyDto;
  slug: string;
  preview: boolean;
  fmt: Format;
}) {
  const { quiet, strong } = headlineParts(academy.tagline?.trim() || academy.name);
  const line = heroLine(academy);
  const next = nextSession(academy.programs);
  const venue = next ? programVenue(next.program) : null;
  const message = contactActions(academy)[0] ?? null;
  const enroll = canEnroll(academy);
  // The arc's words: who each program is for, then when and where they meet.
  const before = ribbonText(
    academy.programs.flatMap((p) => [
      p.name,
      p.level,
      agesLabel(p.ageMin, p.ageMax),
      p.schedule[0] ? sessionLength(p.schedule[0].durationMinutes) : null,
    ]),
  );
  const after = ribbonText(
    academy.programs.flatMap((p) => [...scheduleLines(p, fmt), programVenue(p)?.name]),
  );
  return (
    <section aria-labelledby="hero-title" className="pt-14 sm:pt-20">
      <div className="mx-auto max-w-[1100px] px-4 text-center sm:px-6">
        <h1
          id="hero-title"
          className={`${display} text-[2.75rem] leading-[1.02] sm:text-[4.5rem] lg:text-[6rem]`}
        >
          {academy.tagline?.trim() ? <span className="sr-only">{academy.name}: </span> : null}
          {quiet ? <span className="text-ink-3">{quiet} </span> : null}
          {strong}
        </h1>
        {line ? (
          <p className="mx-auto mt-6 max-w-[34rem] text-[1rem] text-balance sm:mt-7 sm:text-[1.125rem]">
            {line}
          </p>
        ) : null}
        {enroll || message ? (
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {enroll ? (
              <Link
                to="/a/$slug/enroll"
                params={{ slug }}
                search={previewSearch(preview)}
                className={buttonClass("lime", "lg")}
              >
                Enroll now
                <ArrowRight aria-hidden className="size-5" />
              </Link>
            ) : null}
            {message ? (
              <a href={message.href} className={buttonClass("outline", "lg")}>
                {CONTACT_ICON[message.id]}
                {contactLabel(message, null)}
              </a>
            ) : null}
          </div>
        ) : null}
        {next ? (
          <p className="num mt-5 text-[0.8125rem] text-ink-2">
            Next session {fmt.day(fmt.dayOf(next.at))} · {fmt.time(next.at)}
            {venue ? ` · ${venue.name}` : ""}
          </p>
        ) : null}
      </div>
      {before || after ? (
        <div className="mt-2 sm:mt-10">
          <BallArc
            before={before || after}
            after={after || before}
            status={enroll ? "Enrolling now" : null}
          />
        </div>
      ) : (
        <div className="h-16 sm:h-24" />
      )}
    </section>
  );
}

/** A program's coaches, fanned like a hand of cards; each opens their space on the team page. */
function CoachFan({
  people,
  program,
  slug,
  preview,
}: {
  people: PublicCoachDto[];
  program: PublicProgramDto;
  slug: string;
  preview: boolean;
}) {
  if (!people.length) return null;
  const shown = people.slice(0, 3);
  const more = people.length - shown.length;
  const layout =
    shown.length === 3
      ? { w: "w-[34%]", turn: [-7, 0, 7], drop: [26, 0, 26] }
      : shown.length === 2
        ? { w: "w-[44%]", turn: [-5, 5], drop: [10, 10] }
        : { w: "w-[56%]", turn: [0], drop: [0] };
  return (
    <div>
      <ul
        aria-label={`${program.name} coaches`}
        className="flex justify-center pt-2 pb-6 [&>li+li]:-ml-[3%]"
      >
        {shown.map((p, i) => (
          <li
            key={p.id}
            className={`relative max-w-[14rem] shrink-0 ${layout.w}`}
            style={{
              rotate: `${layout.turn[i] ?? 0}deg`,
              translate: `0 ${layout.drop[i] ?? 0}px`,
              zIndex: i === 1 ? 2 : 1,
            }}
          >
            <Link
              to="/a/$slug/team"
              params={{ slug }}
              search={{ ...previewSearch(preview), program: program.id }}
              hash={`coach-${p.id}`}
              className="group block rounded-[24px] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime"
            >
              <TeamPortrait person={p} size="sm" className="rounded-[24px] ring-4 ring-night" />
              <span className="mt-3 block text-center text-[0.9375rem] leading-tight font-semibold underline-offset-4 group-hover:underline">
                {p.name}
              </span>
              {p.title ? (
                <span className="mt-0.5 block text-center text-[0.8125rem] text-night-ink-2">
                  {p.title}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <p className="mt-6 text-center">
          <Link
            to="/a/$slug/team"
            params={{ slug }}
            search={{ ...previewSearch(preview), program: program.id }}
            className={buttonClass("night", "sm")}
          >
            And {more} more
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The black slab: the programs as outlined pills (the chosen one lime, `?program=`), then the
 * chosen program in full (who it's for, when and where, the next session, its price from) beside
 * its coaches.
 */
function ProgramsSlab({
  academy,
  program,
  slug,
  preview,
  fmt,
}: {
  academy: PublicAcademyDto;
  program: PublicProgramDto;
  slug: string;
  preview: boolean;
  fmt: Format;
}) {
  const search = previewSearch(preview);
  const several = academy.programs.length > 1;
  const people = programTeams({ programs: [program], coaches: academy.coaches })[0]?.people ?? [];
  const lines = scheduleLines(program, fmt);
  const length = program.schedule[0]?.durationMinutes;
  const chips = [
    program.level,
    agesLabel(program.ageMin, program.ageMax),
    length ? sessionLength(length) : null,
  ].filter((c): c is string => Boolean(c));
  const tiers = tiersOf(academy.packages, program.id);
  const from = fromPriceMinor(academy.packages, program.id);
  const enroll = canEnroll(academy) && tiers.length > 0;
  const Name = several ? "h3" : "h2";
  return (
    <section
      id="programs"
      aria-labelledby="programs-title"
      className="slab dark-zone scroll-mt-24 bg-night text-white"
    >
      <div className="mx-auto grid max-w-[1100px] gap-14 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center lg:gap-16">
        <div className="min-w-0">
          {several ? (
            <>
              <h2
                id="programs-title"
                className={`${display} text-[2.5rem] leading-[1.02] sm:text-[3.5rem] lg:text-[4rem]`}
              >
                Choose a program
              </h2>
              <nav aria-label="Programs" className="mt-7">
                <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                  {academy.programs.map((p) => {
                    const on = p.id === program.id;
                    return (
                      <li key={p.id} className="shrink-0">
                        <Link
                          to="/a/$slug"
                          params={{ slug }}
                          search={{ ...search, program: p.id }}
                          replace
                          resetScroll={false}
                          aria-current={on ? "true" : undefined}
                          className={`flex h-11 items-center rounded-full px-4.5 text-[0.9375rem] font-medium whitespace-nowrap ring-[1.5px] outline-none ring-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime ${
                            on
                              ? "bg-lime text-ink ring-lime"
                              : "text-white ring-white/55 hover:bg-white/10"
                          }`}
                        >
                          {p.name}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </>
          ) : null}
          <Name
            id={several ? undefined : "programs-title"}
            className={`${display} break-words ${
              several
                ? "mt-10 text-[2rem] leading-tight sm:text-[2.5rem]"
                : "text-[2.5rem] leading-[1.02] sm:text-[3.5rem] lg:text-[4rem]"
            }`}
          >
            {program.name}
          </Name>
          {chips.length ? (
            <ul aria-label="Who it's for" className="mt-4 flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <li
                  key={c}
                  className="inline-flex h-7 items-center rounded-full px-3 text-[0.8125rem] font-medium ring-1 ring-white/45 ring-inset"
                >
                  {c}
                </li>
              ))}
            </ul>
          ) : null}
          {program.description ? (
            <p className="mt-5 max-w-[52ch] text-[1rem] whitespace-pre-line text-night-ink-2 sm:text-[1.125rem]">
              {program.description}
            </p>
          ) : null}
          <div className="mt-7 flex flex-col gap-1">
            {lines.length ? (
              lines.map((l) => (
                <p
                  key={l}
                  className="num text-[1.5rem] leading-tight font-light tracking-[-0.01em] sm:text-[1.75rem]"
                >
                  {l}
                </p>
              ))
            ) : (
              <p className="text-[0.9375rem] text-night-ink-2">
                Ask the academy for this program's days and times.
              </p>
            )}
          </div>
          <dl className="mt-5 flex flex-col gap-3 text-[0.9375rem]">
            <ProgramPlaceRows program={program} fmt={fmt} />
          </dl>
          {from !== null ? (
            <p className="mt-6 text-[1rem]">
              <span className="text-night-ink-2">
                {tiers.length > 1 && tiers.some((t) => t.priceMinor !== from) ? "From " : ""}
              </span>
              <span className="num text-[1.375rem] font-semibold">{fmt.moneyShort(from)}</span>
              <span className="text-night-ink-2"> per head</span>
            </p>
          ) : null}
          <div className="mt-8 flex flex-wrap gap-3">
            {tiers.length ? (
              <Link
                to="/a/$slug/enroll"
                params={{ slug }}
                search={{ ...search, program: program.id }}
                className={buttonClass(enroll ? "lime" : "night", "lg")}
              >
                {enroll ? `Enroll in ${program.name}` : "See packages"}
                <ArrowRight aria-hidden className="size-5" />
              </Link>
            ) : null}
            {people.length ? (
              <Link
                to="/a/$slug/team"
                params={{ slug }}
                search={{ ...search, program: program.id }}
                className={buttonClass("outlineLight", "lg")}
              >
                Meet the coaches
              </Link>
            ) : null}
          </div>
        </div>
        <CoachFan people={people} program={program} slug={slug} preview={preview} />
      </div>
    </section>
  );
}

/**
 * The academy's own photos. On laptops the reel travels sideways while the page scrolls down (a
 * stage pinned for exactly that trip); on phones, with reduced motion, or when it fits, it's a
 * plain sideways reel.
 */
function OnCourt({ academy }: { academy: PublicAcademyDto }) {
  const photos = academy.photos;
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLUListElement>(null);
  const [travel, setTravel] = useState(0);

  useLayoutEffect(() => {
    const el = track.current;
    if (!el || !photos.length) return;
    const wide = window.matchMedia(
      "(min-width: 1024px) and (prefers-reduced-motion: no-preference)",
    );
    const measure = () => {
      const viewport = el.parentElement?.clientWidth ?? 0;
      setTravel(wide.matches ? Math.max(0, Math.round(el.scrollWidth - viewport)) : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    wide.addEventListener("change", measure);
    return () => {
      ro.disconnect();
      wide.removeEventListener("change", measure);
    };
  }, [photos.length]);

  useEffect(() => {
    const t = track.current;
    if (!t) return;
    if (!travel) {
      t.style.transform = "";
      return;
    }
    let raf = 0;
    const update = () => {
      raf = 0;
      const s = section.current;
      if (!s) return;
      const progress = Math.min(1, Math.max(0, -s.getBoundingClientRect().top / travel));
      t.style.transform = `translate3d(${-progress * travel}px, 0, 0)`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [travel]);

  if (!photos.length) return null;
  return (
    <section
      ref={section}
      id="on-court"
      aria-labelledby="on-court-title"
      className="relative"
      style={travel ? { height: `calc(100dvh + ${travel}px)` } : undefined}
    >
      <div
        className={
          travel
            ? "sticky top-0 flex h-dvh flex-col justify-center overflow-hidden"
            : "py-20 sm:py-28"
        }
      >
        <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6">
          <h2
            id="on-court-title"
            className={`${display} text-[2.5rem] leading-[1.02] sm:text-[3.5rem] lg:text-[4rem]`}
          >
            On court
          </h2>
        </div>
        <section
          // The academy's photos, labeled. Without the pinned trip it's a plain sideways reel, so
          // it takes one keyboard stop and scrolls without a pointer.
          aria-label={`${academy.name} photos`}
          tabIndex={travel ? undefined : 0}
          className={
            travel
              ? "mt-10"
              : "mt-8 snap-x snap-mandatory scroll-px-4 overflow-x-auto pb-2 outline-none [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink sm:scroll-px-6 lg:scroll-px-[max(1.5rem,calc((100vw_-_1100px)/2_+_1.5rem))] lg:pb-4 lg:[scrollbar-width:thin]"
          }
        >
          <ul
            ref={track}
            className="flex w-max gap-3 px-4 will-change-transform sm:gap-4 sm:px-6 lg:px-[max(1.5rem,calc((100vw_-_1100px)/2_+_1.5rem))]"
          >
            {photos.map((p, i) => (
              <li
                key={p.id}
                className="w-[84vw] max-w-[38rem] shrink-0 snap-start sm:w-[60vw] lg:w-[min(38rem,40vw)]"
              >
                <figure>
                  <img
                    src={publicFileUrl(p.key) ?? undefined}
                    alt={p.caption ?? ""}
                    width={1200}
                    height={800}
                    loading={i < 2 ? "eager" : "lazy"}
                    decoding="async"
                    className="block aspect-[3/2] w-full rounded-[28px] bg-ivory-2 object-cover"
                  />
                  {p.caption ? (
                    <figcaption className="mt-3 px-1 text-[0.9375rem] text-ink-2">
                      {p.caption}
                    </figcaption>
                  ) : null}
                </figure>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}

/**
 * The court-green slab: the coaches, proved by their own highlights (else their certifications),
 * each card opening that person's space on the team page.
 */
function CoachesSlab({
  academy,
  slug,
  preview,
}: {
  academy: PublicAcademyDto;
  slug: string;
  preview: boolean;
}) {
  const search = previewSearch(preview);
  const proof = coachProof(academy.coaches, 4);
  return (
    <section
      id="coaches"
      aria-labelledby="coaches-title"
      className="slab dark-zone scroll-mt-24 bg-court text-court-ink"
    >
      <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6 sm:py-24">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
          <div className="max-w-[40rem]">
            <h2
              id="coaches-title"
              className={`${display} text-[2.5rem] leading-[1.02] sm:text-[3.5rem] lg:text-[4rem]`}
            >
              The coaches
            </h2>
            <p className="mt-4 text-[1rem] text-court-ink-2 sm:text-[1.125rem]">
              {joinNames(academy.coaches.map((c) => c.name))}
            </p>
          </div>
          <Link
            to="/a/$slug/team"
            params={{ slug }}
            search={search}
            className={buttonClass("outlineLight", "lg")}
          >
            Meet the team
            <ArrowRight aria-hidden className="size-5" />
          </Link>
        </div>
        {proof.length ? (
          <ul className="mt-10 grid gap-3 md:grid-cols-2">
            {proof.map((item) => (
              <li key={`${item.person.id}-${item.kind}-${item.text}`}>
                <Link
                  to="/a/$slug/team"
                  params={{ slug }}
                  search={{ ...search, program: EVERYONE }}
                  hash={`coach-${item.person.id}`}
                  className="group relative flex h-full min-h-[13rem] flex-col justify-between gap-10 rounded-[28px] bg-court-2 p-6 outline-none hover:ring-1 hover:ring-court-ink/30 focus-visible:outline-2 focus-visible:outline-lime sm:p-8"
                >
                  <span className={`${display} pr-10 text-[1.75rem] leading-[1.12] sm:text-[2rem]`}>
                    {item.text}
                  </span>
                  <ArrowUpRight
                    aria-hidden
                    className="absolute top-6 right-6 size-7 text-court-ink-2 transition-transform duration-200 ease-out group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-court-ink sm:top-8 sm:right-8"
                  />
                  <span className="flex items-center gap-3">
                    <TeamFace person={item.person} className="ring-2 ring-court-ink/35" />
                    <span className="min-w-0">
                      <span className="block text-[0.9375rem] leading-tight font-semibold">
                        {item.person.name}
                      </span>
                      <span className="mt-0.5 block text-[0.8125rem] text-court-ink-2">
                        {item.person.title ??
                          (item.kind === "certification" ? "Certification" : "Highlight")}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="mt-10 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
            {academy.coaches.slice(0, 8).map((p) => (
              <li key={p.id}>
                <Link
                  to="/a/$slug/team"
                  params={{ slug }}
                  search={{ ...search, program: EVERYONE }}
                  hash={`coach-${p.id}`}
                  className="group block rounded-[24px] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime"
                >
                  <TeamPortrait person={p} size="sm" className="rounded-[24px]" />
                  <span className="mt-3 block text-[0.9375rem] font-semibold underline-offset-4 group-hover:underline">
                    {p.name}
                  </span>
                  {p.title ? (
                    <span className="mt-0.5 block text-[0.8125rem] text-court-ink-2">
                      {p.title}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * About the academy, beside a black card of what one of its packages includes (stacked green
 * pills): the featured package, else the one that lists the most.
 */
function AboutAndIncluded({
  academy,
  slug,
  preview,
  fmt,
}: {
  academy: PublicAcademyDto;
  slug: string;
  preview: boolean;
  fmt: Format;
}) {
  const about = academy.about?.trim();
  const tier = showcaseTier(academy.packages);
  const inclusions = tier ? tierInclusions(tier) : [];
  if (!about && !inclusions.length) return null;
  return (
    <section
      id="about"
      aria-labelledby={about ? "about-title" : "included-title"}
      className="mx-auto grid max-w-[1100px] scroll-mt-24 gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-2 lg:items-start lg:gap-16"
    >
      {about ? (
        <div>
          <h2
            id="about-title"
            className={`${display} text-[2.5rem] leading-[1.02] break-words sm:text-[3.5rem] lg:text-[4rem]`}
          >
            About {academy.name}
          </h2>
          <p className="mt-6 max-w-[60ch] text-[1rem] leading-relaxed whitespace-pre-line sm:text-[1.125rem]">
            {about}
          </p>
        </div>
      ) : null}
      {tier && inclusions.length ? (
        <div
          className={`dark-zone overflow-hidden rounded-[32px] bg-night py-8 pl-6 text-white sm:py-10 sm:pl-10 ${about ? "" : "lg:col-span-2"}`}
        >
          <h2
            id="included-title"
            className="pr-6 text-[1.5rem] leading-tight font-semibold sm:pr-10"
          >
            What's included
          </h2>
          <p className="num mt-1 pr-6 text-[0.9375rem] text-night-ink-2 sm:pr-10">
            In {tier.name}, {fmt.moneyShort(tier.priceMinor)} per head
          </p>
          <ul className="mt-8 flex flex-col items-end gap-2">
            {inclusions.map((item, i) => (
              <li
                key={item}
                className="-mr-4 flex min-h-11 max-w-[calc(100%_+_1rem)] items-center rounded-l-full bg-court py-2 pl-5 text-[0.9375rem] leading-snug font-medium text-court-ink ring-2 ring-white ring-inset"
                style={{ paddingRight: `calc(2.5rem + ${i} * min(6vw, 1.75rem))` }}
              >
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-9 pr-6 sm:pr-10">
            <Link
              to="/a/$slug/enroll"
              params={{ slug }}
              search={{
                ...previewSearch(preview),
                ...(tier.programId ? { program: tier.programId } : {}),
              }}
              className={buttonClass("lime", "md")}
            >
              {canEnroll(academy) ? "Choose a package" : "See the packages"}
              <ArrowRight aria-hidden className="size-4.5" />
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** The violet card: where the programs meet (each with directions), and Enroll now. */
function WhereWePlay({
  academy,
  slug,
  preview,
}: {
  academy: PublicAcademyDto;
  slug: string;
  preview: boolean;
}) {
  const venues = academyVenues(academy.programs);
  const first = venues[0] ?? null;
  if (!first && !academy.address) return null;
  const directions = first ? directionsUrl(first) : academy.mapUrl;
  const title =
    venues.length === 1 && first
      ? `Train at ${first.name}`
      : venues.length
        ? "Where we play"
        : `Visit ${academy.name}`;
  return (
    <section aria-labelledby="where-title" className="mx-auto max-w-[1100px] px-4 sm:px-6">
      <div className="rounded-[32px] bg-violet px-5 py-14 text-center sm:px-10 sm:py-20">
        {venues.length > 1 ? (
          <ul aria-label="Venues" className="flex flex-wrap justify-center gap-2">
            {venues.map((v) => (
              <li key={`${v.name}-${v.address ?? ""}`}>
                <a
                  href={directionsUrl(v)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClass("outline", "sm")}
                >
                  <MapPin aria-hidden className="size-4" />
                  {v.name}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <h2
          id="where-title"
          className={`${display} text-[2.5rem] leading-[1.05] break-words sm:text-[3.5rem] lg:text-[4rem] ${venues.length > 1 ? "mt-7" : ""}`}
        >
          {title}
        </h2>
        {(venues.length <= 1 ? (first?.address ?? academy.address) : academy.address) ? (
          <p className="mx-auto mt-4 max-w-[48ch] text-[1rem] sm:text-[1.125rem]">
            {venues.length <= 1 ? (first?.address ?? academy.address) : academy.address}
          </p>
        ) : null}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {directions && venues.length <= 1 ? (
            <a
              href={directions}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass("outline", "lg")}
            >
              Get directions
              <ArrowUpRight aria-hidden className="size-5" />
            </a>
          ) : null}
          {canEnroll(academy) ? (
            <Link
              to="/a/$slug/enroll"
              params={{ slug }}
              search={previewSearch(preview)}
              className={buttonClass("dark", "lg")}
            >
              Enroll now
              <ArrowRight aria-hidden className="size-5" />
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** The close: the academy's cover photo (else black) under one line and the two ways forward. */
function ClosingCall({
  academy,
  slug,
  preview,
  fmt,
}: {
  academy: PublicAcademyDto;
  slug: string;
  preview: boolean;
  fmt: Format;
}) {
  const enroll = canEnroll(academy);
  const message = contactActions(academy)[0] ?? null;
  if (!enroll && !message) return null;
  const src = publicFileUrl(academy.coverKey ?? academy.photos[0]?.key ?? null);
  const next = nextSession(academy.programs);
  return (
    <section
      aria-labelledby="closing-title"
      className="slab dark-zone relative isolate mt-20 overflow-hidden bg-night text-white sm:mt-28"
    >
      {src ? (
        <>
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 -z-20 size-full object-cover"
          />
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-gradient-to-b from-night/35 via-night/55 to-night/85"
          />
        </>
      ) : null}
      <svg
        aria-hidden
        focusable="false"
        viewBox="0 0 400 520"
        className="pointer-events-none absolute -top-6 -right-16 -z-10 h-[34%] w-auto sm:-right-10 sm:h-[70%] lg:right-[4%]"
      >
        <path
          d="M 120 10 C 330 10, 410 170, 300 250 C 210 315, 250 430, 390 510"
          className="fill-none stroke-lime"
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray="0 20"
        />
      </svg>
      <div className="mx-auto max-w-[900px] px-4 py-28 text-center sm:py-40">
        <h2
          id="closing-title"
          className={`${display} text-[3rem] leading-none sm:text-[4.5rem] lg:text-[6rem]`}
        >
          Ready to play?
        </h2>
        <p className="num mx-auto mt-6 max-w-[44ch] text-[1rem] text-balance text-white/85 sm:text-[1.125rem]">
          {next
            ? `Next session ${fmt.day(fmt.dayOf(next.at))} · ${fmt.time(next.at)}, ${next.program.name}.`
            : enroll
              ? `${academy.name} is taking enrollment requests.`
              : `Ask ${academy.name} when the next season starts.`}
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          {enroll ? (
            <Link
              to="/a/$slug/enroll"
              params={{ slug }}
              search={previewSearch(preview)}
              className={buttonClass("lime", "lg")}
            >
              Enroll now
              <ArrowRight aria-hidden className="size-5" />
            </Link>
          ) : null}
          {message ? (
            <a href={message.href} className={buttonClass("outlineLight", "lg")}>
              {CONTACT_ICON[message.id]}
              {contactLabel(message, null)}
            </a>
          ) : null}
        </div>
        {enroll ? (
          <p className="mx-auto mt-6 max-w-[44ch] text-[0.875rem] text-balance text-white/75">
            {academy.name} reviews every request, then confirms your spot and how to pay.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The academy's website, its landing page (Persuade, phone-first): the academy's promise with its
 * programs riding the ball's arc, then its programs, photos, coaches, what it includes, where it
 * plays, and the way to enroll, in CoachMan's family.
 */
export function LandingPage({
  page,
  slug,
  programId,
  fmt,
}: {
  page: PublicPage;
  slug: string;
  programId?: string;
  fmt: Format;
}) {
  const academy = page.academy;
  const preview = page.kind === "preview";
  const program = academy.programs.find((p) => p.id === programId) ?? academy.programs[0] ?? null;
  const nothing = !academy.programs.length && !academy.packages.length;
  return (
    <SiteFrame page={page} slug={slug} current="home">
      <Hero academy={academy} slug={slug} preview={preview} fmt={fmt} />
      {program ? (
        <ProgramsSlab academy={academy} program={program} slug={slug} preview={preview} fmt={fmt} />
      ) : null}
      {nothing ? (
        <section
          aria-labelledby="soon-title"
          className="mx-auto max-w-[1100px] px-4 pb-8 text-center sm:px-6"
        >
          <h2 id="soon-title" className={`${display} text-[2.5rem] leading-tight sm:text-[3.5rem]`}>
            Programs and rates are on their way
          </h2>
          <p className="mx-auto mt-4 max-w-[48ch] text-ink-2">
            {academy.name} hasn't published its programs and packages here yet.
          </p>
        </section>
      ) : null}
      <OnCourt academy={academy} />
      {academy.coaches.length ? (
        <CoachesSlab academy={academy} slug={slug} preview={preview} />
      ) : null}
      <AboutAndIncluded academy={academy} slug={slug} preview={preview} fmt={fmt} />
      <WhereWePlay academy={academy} slug={slug} preview={preview} />
      <ClosingCall academy={academy} slug={slug} preview={preview} fmt={fmt} />
      <div className="pt-20 sm:pt-28">
        <QuestionsBox academy={academy} />
      </div>
    </SiteFrame>
  );
}
