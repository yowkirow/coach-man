import type { PublicAcademyDto, PublicPackageDto, PublicProgramDto } from "@shared/api-types";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  Check,
  MapPin,
  Shirt,
  UsersRound,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { Format } from "../../lib/format";
import {
  FIELD,
  type Field,
  pillClass,
  RoundSticker,
  SkewLabel,
  Sticker,
  skewClass,
} from "./pubmat";
import { CONTACT_ICON, canEnroll, contactLabel, previewSearch } from "./site";
import {
  compactTime,
  displayEm,
  fromPriceMinor,
  programVenue,
  scheduleLineParts,
  tierInclusions,
  UNIFORM_WORDS,
} from "./site-data";
import { programTeams } from "./team";
import {
  agesLabel,
  contactActions,
  directionsUrl,
  MONTH_END_ADVICE,
  scheduleLines,
  sessionLength,
  sessionsLabel,
  tiersOf,
  validityLine,
} from "./text";

// The website's shared blocks: a program's panel, the packages as price stickers, and how
// enrolling works. The landing page and Enroll now both build from them.

/** A program's weekly times as the pubmat sets them: the days, then the compact range. */
export function programWhen(program: PublicProgramDto, fmt: Format) {
  const note = program.scheduleNote?.trim();
  if (note) {
    // The academy's own label, compacted only when it reads "days · times".
    const { lead, time } = scheduleLineParts(note);
    return time ? [{ days: lead.replace(/\s*·\s*$/, ""), time: compactTime(time) }] : [];
  }
  return scheduleLines(program, fmt).map((line) => {
    const { lead, time } = scheduleLineParts(line);
    return { days: lead.replace(/\s*·\s*$/, ""), time: compactTime(time) };
  });
}

/** "A", "A and B", "A, B, and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

const factLink =
  "rounded-sm font-semibold underline decoration-2 underline-offset-4 outline-none hover:decoration-club-ball";

/**
 * One program on its own color field: its name, its "from" price as a sticker, its days and times
 * in giant lime numerals, who it's for, where and when it next meets, who coaches it, and its own
 * Enroll now.
 */
export function ProgramPanel({
  academy,
  program,
  field,
  slug,
  preview,
  fmt,
  level = 3,
  action = true,
  wide = false,
  className = "",
}: {
  academy: PublicAcademyDto;
  program: PublicProgramDto;
  field: Extract<Field, "blue" | "deep" | "green">;
  slug: string;
  preview: boolean;
  fmt: Format;
  level?: 2 | 3;
  /** Its own Enroll now (left out on Enroll now itself, where the packages follow). */
  action?: boolean;
  /** Full width on desktops: the name and times on the left, the details on the right. */
  wide?: boolean;
  className?: string;
}) {
  const Name = `h${level}` as "h2" | "h3";
  const nameId = `program-${program.id}`;
  const when = programWhen(program, fmt);
  const note = program.scheduleNote?.trim() || null;
  const length = program.schedule[0]?.durationMinutes;
  const chips = [
    program.level,
    agesLabel(program.ageMin, program.ageMax),
    length ? sessionLength(length) : null,
  ].filter((c): c is string => Boolean(c));
  const tiers = tiersOf(academy.packages, program.id);
  const from = fromPriceMinor(academy.packages, program.id);
  const people = programTeams({ programs: [program], coaches: academy.coaches })[0]?.people ?? [];
  const venue = programVenue(program);
  const search = previewSearch(preview);
  // Phones: the name and the giant numerals shrink to the column when a word can't fit it
  // ("SATURDAYS" at full size is wider than a 360px phone).
  const longest = (words: string[]) => Math.max(0.5, ...words.map(displayEm));
  const fit = {
    "--name-em": longest(program.name.split(/\s+/)).toFixed(3),
    "--when-em": longest(when.flatMap((w) => [...w.days.split(/\s+/), w.time])).toFixed(3),
  } as CSSProperties;
  return (
    <section
      aria-labelledby={nameId}
      className={`relative px-5 pt-12 pb-14 lg:px-16 lg:pt-[88px] lg:pb-24 ${FIELD[field]} ${className}`}
    >
      <div
        className={
          wide
            ? "mx-auto max-w-[1312px] lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:items-end lg:gap-x-20"
            : "max-w-[600px]"
        }
      >
        <div className="relative max-w-[600px] @container" style={fit}>
          <Name
            id={nameId}
            className={`pm-d1 break-words lg:text-[3.5rem] ${from != null ? "text-[min(3.625rem,calc((100cqi_-_124px)*0.96/var(--name-em)))] pr-[124px] lg:pr-[150px]" : "text-[min(3.625rem,calc(100cqi*0.96/var(--name-em)))]"}`}
          >
            {program.name}
          </Name>
          {from != null ? (
            <RoundSticker
              label={`From ${fmt.moneyShort(from)} per head`}
              top="From"
              figure={fmt.moneyShort(from)}
              bottom="/ head"
              rot={8}
              className="absolute -top-2 right-0 w-[120px] text-[0.9375rem] lg:-top-6 lg:-right-2.5 lg:w-[140px] lg:text-[1.0625rem]"
            />
          ) : null}
          {when.length ? (
            <p
              className={`pm-d1 num mt-6 text-club-ball lg:mt-8 ${when.length > 1 ? "text-[min(3.25rem,calc(100cqi*0.96/var(--when-em)))] lg:text-[4rem]" : "text-[min(5.25rem,calc(100cqi*0.96/var(--when-em)))] lg:text-[6rem]"}`}
            >
              <span className="sr-only">{program.name} meets </span>
              {when.map((w) => (
                <span key={`${w.days}-${w.time}`} className="block">
                  <span className="block">{w.days}</span>
                  <span className="block whitespace-nowrap">{w.time}</span>
                </span>
              ))}
            </p>
          ) : note ? (
            <p className="pm-d2 mt-6 text-[1.75rem] text-club-ball lg:text-[2.25rem]">{note}</p>
          ) : null}
        </div>
        <div className={wide ? "lg:pb-3 lg:[&>:first-child]:mt-0" : ""}>
          {program.description ? (
            <p className="mt-6 max-w-[38ch] text-[1.125rem] leading-[1.45] whitespace-pre-line lg:text-[1.1875rem]">
              {program.description}
            </p>
          ) : null}
          {chips.length ? (
            <ul aria-label="Who it's for" className="mt-5 flex flex-wrap gap-2">
              {chips.map((c) => (
                <li
                  key={c}
                  className="rounded-md border-[1.5px] border-white/80 px-2.5 pt-[5px] pb-1.5 text-[0.9375rem] leading-tight font-bold"
                >
                  {c}
                </li>
              ))}
            </ul>
          ) : null}
          {venue || people.length || program.nextSessionAt ? (
            <ul className="mt-5 grid gap-2.5 text-[1.0625rem] leading-snug font-medium">
              {venue ? (
                <li className="flex items-start gap-2.5">
                  <MapPin aria-hidden className="mt-0.5 size-5 shrink-0 text-club-ball" />
                  <span>
                    <span className="sr-only">Where: </span>
                    {venue.name}
                    {venue.address ? `, ${venue.address}` : ""}{" "}
                    <a
                      href={directionsUrl(venue)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${factLink} inline-flex min-h-11 items-center gap-1 align-middle sm:min-h-0`}
                    >
                      Directions
                      <ArrowUpRight aria-hidden className="size-4" />
                    </a>
                  </span>
                </li>
              ) : null}
              {people.length ? (
                <li className="flex items-start gap-2.5">
                  <UsersRound aria-hidden className="mt-0.5 size-5 shrink-0 text-club-ball" />
                  <Link
                    to="/a/$slug/team"
                    params={{ slug }}
                    search={{ ...search, program: program.id }}
                    className={factLink}
                  >
                    Coached by {joinNames(people.map((p) => p.name))}
                  </Link>
                </li>
              ) : null}
              {program.nextSessionAt ? (
                <li className="num flex items-start gap-2.5">
                  <CalendarClock aria-hidden className="mt-0.5 size-5 shrink-0 text-club-ball" />
                  <span>
                    Next session {fmt.day(fmt.dayOf(program.nextSessionAt))} ·{" "}
                    {fmt.time(program.nextSessionAt)}
                  </span>
                </li>
              ) : null}
            </ul>
          ) : null}
          {!action ? null : tiers.length && canEnroll(academy) ? (
            <Link
              to="/a/$slug/enroll"
              params={{ slug }}
              search={{ ...search, program: program.id }}
              className={`${skewClass("lime", "lg")} mt-8`}
            >
              <SkewLabel>
                Enroll now<span className="sr-only"> in {program.name}</span>
                <ArrowRight aria-hidden className="size-[22px]" />
              </SkewLabel>
            </Link>
          ) : tiers.length ? (
            <Link
              to="/a/$slug/enroll"
              params={{ slug }}
              search={{ ...search, program: program.id }}
              className={pillClass("white", "mt-8")}
            >
              See packages<span className="sr-only"> for {program.name}</span>
              <ArrowRight aria-hidden className="size-5" />
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/**
 * A package card's way in: Enroll (to the wizard), or, while the academy isn't taking requests,
 * a plain note with the ways to reach it.
 */
export function PackageEnroll({
  academy,
  tier,
}: {
  academy: PublicAcademyDto;
  tier: PublicPackageDto;
}) {
  if (academy.enrollmentOpen) {
    return (
      <Link
        to="/a/$slug/enroll"
        params={{ slug: academy.slug }}
        search={{ package: tier.id }}
        className={`${skewClass(tier.highlight ? "lime" : "ink", "md")} w-full`}
      >
        <SkewLabel>
          Enroll<span className="sr-only"> in {tier.name}</span>
          <ArrowRight aria-hidden className="size-5" />
        </SkewLabel>
      </Link>
    );
  }
  const actions = contactActions(academy).slice(0, 2);
  return (
    <div className="rounded-xl px-4 py-3 ring-[1.5px] ring-current/25 ring-inset">
      <p className="font-bold">Enrollment is closed for now</p>
      {actions.length ? (
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[0.9375rem]">
          {actions.map((a) => (
            <a
              key={a.id}
              href={a.href}
              className="rounded-sm font-semibold underline underline-offset-4 outline-none"
            >
              {a.label}
            </a>
          ))}
        </p>
      ) : (
        <p className="mt-1 text-[0.9375rem]">Ask the academy when it opens again.</p>
      )}
    </div>
  );
}

/**
 * One package as a price sticker: white (the featured one Jersey Blue with a lime "Featured"
 * sticker), turned a hair, with its sessions, price per head, how long it lasts, what's included,
 * and who it's for.
 */
export function PackageCard({
  tier,
  fmt,
  rot = 0,
  level = 4,
  enroll,
}: {
  tier: PublicPackageDto;
  fmt: Format;
  rot?: number;
  level?: 3 | 4;
  enroll?: ReactNode;
}) {
  const Heading = `h${level}` as "h3" | "h4";
  const featured = tier.highlight;
  const nameId = `tier-${tier.id}`;
  const inclusions = tierInclusions(tier);
  return (
    <article
      aria-labelledby={nameId}
      style={{ "--rot": `${rot}deg` } as CSSProperties}
      className={`relative flex flex-col rounded-2xl px-[18px] pt-5 pb-[22px] [rotate:var(--rot)] ${featured ? "pm-dark border-[3px] border-white bg-club-blue text-white" : "bg-white text-club-ink"}`}
    >
      {featured ? (
        <Sticker tone="lime" rot={6} className="absolute -top-[18px] right-4 text-[1.125rem]">
          Featured
        </Sticker>
      ) : null}
      <div className="flex items-baseline justify-between gap-3">
        <Heading id={nameId} className="pm-d2 min-w-0 text-[1.875rem] break-words">
          {tier.name}
        </Heading>
        <p className="num shrink-0 text-[1rem] font-bold whitespace-nowrap">
          {sessionsLabel(tier)}
        </p>
      </div>
      {tier.coach ? (
        <p className="mt-1 text-[0.9375rem] font-semibold">With {tier.coach.name}</p>
      ) : null}
      {/* Coaches see tiers without prices (the staff API leaves money out for them). */}
      {typeof tier.priceMinor === "number" ? (
        <p className="mt-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="pm-d1 num text-[3.5rem] lg:text-[3.875rem]">
            {fmt.moneyShort(tier.priceMinor)}
          </span>
          <span className="text-[1rem] font-semibold">per head</span>
        </p>
      ) : null}
      <p className="mt-2 text-[1rem] leading-snug">
        {validityLine(tier)}
        {tier.validityMode === "month_end" ? (
          <span className="block">{MONTH_END_ADVICE}</span>
        ) : null}
      </p>
      {tier.commitmentNote ? (
        <p className="mt-1 text-[1rem] leading-snug font-bold">{tier.commitmentNote}</p>
      ) : null}
      {inclusions.length ? (
        <ul
          aria-label={`Included in ${tier.name}`}
          className={`mt-3 grid gap-1.5 border-t-[1.5px] pt-3 ${featured ? "border-white/40" : "border-club-ink/15"}`}
        >
          {inclusions.map((item) => (
            <li key={item} className="flex gap-2 text-[1rem] leading-snug">
              {UNIFORM_WORDS.test(item) ? (
                <Shirt
                  aria-hidden
                  className={`mt-0.5 size-[18px] shrink-0 ${featured ? "text-club-ball" : "text-club"}`}
                />
              ) : (
                <Check
                  aria-hidden
                  strokeWidth={3}
                  className={`mt-0.5 size-[18px] shrink-0 ${featured ? "text-club-ball" : "text-club"}`}
                />
              )}
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {tier.audience ? (
        <p className="mt-3 text-[1rem] leading-snug">
          <span className="font-bold">Who it's for:</span> {tier.audience}
        </p>
      ) : null}
      {tier.asksSelfRating ? (
        <p className="mt-2 text-[0.9375rem] leading-snug">
          Enrolling asks you to rate your own level, so the coaches can place you.
        </p>
      ) : null}
      {enroll ? <div className="mt-auto pt-4">{enroll}</div> : null}
    </article>
  );
}

/** Each card a hair off true, like stickers slapped on by hand. */
const CARD_TURNS = [-1.2, 0.9, -0.5, 1.1, -0.8, 0.6];

/**
 * The packages in groups: each program's own (its name and when it meets beside them), then the
 * ones in no program. `enroll` gives each card its way in (left out for staff previews).
 */
export function PackageGroups({
  academy,
  programs,
  others = true,
  fmt,
  enroll,
  level = 3,
}: {
  academy: PublicAcademyDto;
  programs: PublicProgramDto[];
  /** Include the tiers in no program. */
  others?: boolean;
  fmt: Format;
  enroll?: (tier: PublicPackageDto) => ReactNode;
  level?: 2 | 3;
}) {
  const Group = `h${level}` as "h2" | "h3";
  const groups = programs
    .map((p) => ({
      key: p.id,
      title: p.name,
      lines: [scheduleLines(p, fmt)[0], agesLabel(p.ageMin, p.ageMax)].filter((l): l is string =>
        Boolean(l),
      ),
      tiers: tiersOf(academy.packages, p.id),
    }))
    .filter((g) => g.tiers.length);
  const loose = others ? tiersOf(academy.packages, null) : [];
  if (loose.length) {
    groups.push({
      key: "others",
      title: groups.length ? "More packages" : "Packages",
      lines: [],
      tiers: loose,
    });
  }
  return (
    <div className="flex flex-col gap-10 lg:gap-14">
      {groups.map((g) => (
        <div
          key={g.key}
          className="lg:grid lg:grid-cols-[250px_minmax(0,1fr)] lg:items-start lg:gap-x-[30px]"
        >
          <div className="lg:pt-3.5">
            <Group id={`group-${g.key}`} className="pm-d2 text-[2.125rem]">
              {g.title}
            </Group>
            {g.lines.length ? (
              <p className="num mt-1.5 text-[1rem] leading-snug font-semibold">
                {g.lines.map((l) => (
                  <span key={l} className="block">
                    {l}
                  </span>
                ))}
              </p>
            ) : null}
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:mt-0 lg:grid-cols-3 lg:gap-[30px]">
            {g.tiers.map((t, i) => (
              <PackageCard
                key={t.id}
                tier={t}
                fmt={fmt}
                rot={CARD_TURNS[i % CARD_TURNS.length]}
                level={level === 2 ? 3 : 4}
                enroll={enroll?.(t)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** How enrolling works: true for every academy, so it shows even before anything is published. */
export function StepsPanel({
  academy,
  slug,
  preview,
  actions = true,
}: {
  academy: PublicAcademyDto;
  slug: string;
  preview: boolean;
  /** Its Enroll now and Message us (left out on Enroll now, where the packages are above). */
  actions?: boolean;
}) {
  const steps = [
    {
      title: "Choose a program and package",
      text: "Pick when you'll train, then the package that fits.",
    },
    { title: "Send your request", text: `${academy.name} reviews it and confirms your spot.` },
    {
      title: "Pay and upload your receipt",
      text: "Pay the way the academy confirms, then upload a screenshot of your payment.",
    },
  ];
  const message = contactActions(academy)[0] ?? null;
  const enroll = canEnroll(academy);
  return (
    <section
      aria-labelledby="steps-title"
      className={`relative overflow-hidden ${FIELD.deep} py-[58px] lg:pt-[100px] lg:pb-28`}
    >
      <div className="mx-auto w-full max-w-[1440px] px-5 lg:px-16">
        <h2 id="steps-title" className="pm-d1 text-[4.5rem] lg:text-[6rem]">
          How to enroll
        </h2>
        <ol className="mt-8 grid gap-[26px] lg:mt-[52px] lg:grid-cols-3 lg:gap-10">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className={`grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3.5 lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-[18px] ${i === 1 ? "lg:mt-11" : i === 2 ? "lg:mt-[88px]" : ""}`}
            >
              <span
                aria-hidden
                className="pm-d1 text-[7.375rem] leading-[0.8] text-club-ball lg:text-[9.75rem]"
              >
                {i + 1}
              </span>
              <div>
                <h3 className="pm-d2 text-[1.625rem] leading-[1.02] font-black lg:text-[1.875rem]">
                  {s.title}
                </h3>
                <p className="mt-2 max-w-[40ch] text-[1.0625rem] leading-[1.45] lg:text-[1.125rem]">
                  {s.text}
                </p>
              </div>
            </li>
          ))}
        </ol>
        {actions && (enroll || message) ? (
          <div className="mt-[38px] flex flex-wrap items-center gap-3 lg:mt-6">
            {enroll ? (
              <Link
                to="/a/$slug/enroll"
                params={{ slug }}
                search={previewSearch(preview)}
                className={skewClass("lime", "lg")}
              >
                <SkewLabel>
                  Enroll now
                  <ArrowRight aria-hidden className="size-[22px]" />
                </SkewLabel>
              </Link>
            ) : null}
            {message ? (
              <a href={message.href} className={pillClass(enroll ? "outline" : "white")}>
                {CONTACT_ICON[message.id]}
                {contactLabel(message, null)}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
