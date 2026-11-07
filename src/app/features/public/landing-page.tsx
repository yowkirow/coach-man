import type { PublicAcademyDto, PublicCoachDto } from "@shared/api-types";
import { ACADEMY_SOCIAL_LABELS, ACADEMY_SOCIALS } from "@shared/domain";
import { framingOr, SCENE_FRAMING } from "@shared/framing";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowRight, ArrowUpRight, Medal, Printer } from "lucide-react";
import { publicFileUrl } from "../../lib/api";
import type { Format } from "../../lib/format";
import { TeamPortrait } from "./people";
import {
  FIELD,
  FittedName,
  Grommets,
  Panel,
  PhotoSticker,
  phoneName,
  pillClass,
  RoundSticker,
  SkewLabel,
  SoonBlock,
  Sticker,
  Strip,
  skewClass,
  WRAP,
} from "./pubmat";
import type { PublicPage } from "./queries";
import { CONTACT_ICON, canEnroll, contactLabel, Policies, previewSearch, SiteFrame } from "./site";
import { PackageEnroll, PackageGroups, ProgramPanel, programWhen, StepsPanel } from "./site-blocks";
import {
  academyVenues,
  firstSentence,
  heroPhoto,
  lowestPriceMinor,
  nextSession,
} from "./site-data";
import { programsOf, programTeams } from "./team";
import { contactActions, directionsUrl } from "./text";

/** What the academy does, when it hasn't written its own line yet (CoachMan is pickleball-first). */
const SPORT_LINE = "Pickleball coaching";

/** "Coach Jerros" when the title is plain "Coach"; otherwise the name, with the title under it. */
function coachHeading(person: PublicCoachDto) {
  const plain = /^coach$/i.test(person.title?.trim() ?? "");
  return { name: plain ? `Coach ${person.name}` : person.name, title: plain ? null : person.title };
}

// ---------------------------------------------------------------------------------------------
// The tarp
// ---------------------------------------------------------------------------------------------

/**
 * The first screen, set like the enrollment pubmat families already stop for: the academy's name
 * as big as the width allows, a photo stuck on, "Now enrolling", the lowest price, every program's
 * days and times on a strip, Enroll now, and the next session. On desktop it is the tarp on the
 * court's fence, grommets and all.
 */
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
  const enroll = canEnroll(academy);
  const message = contactActions(academy)[0] ?? null;
  const photo = heroPhoto(academy);
  const src = photo ? publicFileUrl(photo.key) : null;
  // The coach in the photo, when it's a portrait: named beside it, and their rating first.
  const pictured =
    photo?.kind === "coach"
      ? (academy.coaches.find((c) => (c.portraitKey ?? c.photoKey) === photo.key) ?? null)
      : null;
  const lowest = lowestPriceMinor(academy.packages);
  const rated =
    (pictured?.duprRating != null ? pictured : null) ??
    academy.coaches.find((c) => c.duprRating != null) ??
    null;
  const own = academy.tagline?.trim() || firstSentence(academy.about);
  // Phones: a short first or last line of the name holds a sticker beside it.
  const slotted = Boolean(phoneName(academy.name).slot);
  const segments = academy.programs.map((p) => {
    const w = programWhen(p, fmt)[0];
    return { id: p.id, name: p.name, when: w ? `${w.days} ${w.time}` : (p.scheduleNote ?? "") };
  });
  const shown = segments.slice(0, 3);
  const more = segments.length - shown.length;
  const next = nextSession(academy.programs);
  const nextVenue = next
    ? (next.program.schedule.find((s) => s.venue)?.venue ?? next.program.venue)
    : null;
  const coaches = academy.coaches;
  const meet =
    coaches.length === 1 && coaches[0]
      ? `Meet ${coachHeading(coaches[0]).name}`
      : coaches.length
        ? "Meet the coaches"
        : null;
  const badge = enroll ? (
    <Sticker tone="lime" rot={-6} slap delay={140} className="text-[1.0625rem] lg:text-[1.75rem]">
      Now enrolling
    </Sticker>
  ) : null;
  // Beside the name on phones: "Now enrolling", else what the academy does.
  const slot = slotted ? (
    <Sticker
      tone="lime"
      rot={-4}
      slap
      delay={140}
      className="max-w-full min-w-0 text-[length:max(0.875rem,0.22em)] text-balance whitespace-normal"
    >
      {enroll ? "Now enrolling" : SPORT_LINE}
    </Sticker>
  ) : undefined;
  // With the sport line on the sticker, phones name the pictured coach instead of repeating it.
  const caption = slotted && !enroll && !own && pictured ? coachHeading(pictured) : null;
  const round =
    lowest != null ? (
      <RoundSticker
        label={`From ${fmt.moneyShort(lowest)} per head`}
        top="From"
        figure={fmt.moneyShort(lowest)}
        bottom="/ head"
        rot={7}
        slap
        delay={260}
        className="w-32 text-[0.9375rem] lg:w-[168px] lg:text-[1.25rem]"
      />
    ) : rated?.duprRating != null ? (
      <RoundSticker
        label={`${rated.name}'s DUPR rating: ${rated.duprRating.toFixed(2)}`}
        top="DUPR"
        figure={rated.duprRating.toFixed(2)}
        tone="blue"
        rot={-7}
        slap
        delay={260}
        className="w-[124px] text-[0.9375rem] lg:w-[168px] lg:text-[1.25rem]"
      />
    ) : null;
  return (
    <section aria-labelledby="hero-title" className={`relative overflow-hidden ${FIELD.green}`}>
      <Grommets />
      <div
        className={`relative z-[1] mx-auto grid max-w-[1440px] items-start gap-x-2 px-3 pt-3.5 pb-6 lg:min-h-[calc(100dvh_-_64px)] lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr_auto_auto] lg:gap-x-10 lg:px-16 lg:pt-[50px] lg:pb-[58px] ${src ? "grid-cols-[minmax(0,1fr)_58%]" : "grid-cols-1"}`}
      >
        <div className={`min-w-0 ${src ? "col-span-2 lg:col-span-1" : ""}`}>
          <FittedName id="hero-title" text={academy.name} className="text-white" slot={slot} />
        </div>

        <div className="contents lg:col-start-1 lg:row-start-2 lg:flex lg:flex-col lg:items-start lg:gap-7 lg:pt-6">
          <div className="col-start-1 row-start-2 mt-3.5 flex flex-col items-start gap-3 lg:mt-0">
            {src || !badge ? null : <span className={slotted ? "max-lg:hidden" : ""}>{badge}</span>}
            {own ? (
              <p className="max-w-[30ch] text-[1.25rem] leading-tight font-bold text-white lg:text-[1.625rem] lg:leading-snug lg:font-semibold">
                {own}
              </p>
            ) : (
              <>
                {caption ? (
                  <p className="text-white lg:hidden">
                    <span className="pm-d2 block text-[1.5625rem] leading-[0.98]">
                      {caption.name}
                    </span>
                    {caption.title ? (
                      <span className="mt-1 block text-[1.1875rem] font-bold">{caption.title}</span>
                    ) : null}
                  </p>
                ) : null}
                <p
                  className={`pm-d2 text-[1.5625rem] leading-[0.98] text-white lg:text-[2.125rem] ${slotted && !enroll ? "max-lg:hidden" : ""}`}
                >
                  {SPORT_LINE}
                </p>
              </>
            )}
          </div>
          {round ? (
            <div className="col-start-1 row-start-3 mt-2 mb-8 ml-1 self-center lg:hidden">
              {round}
            </div>
          ) : null}
        </div>

        {src ? (
          <div className="col-start-2 row-span-2 row-start-2 mt-3.5 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-1 lg:w-full lg:max-w-[410px] lg:justify-self-end">
            <PhotoSticker
              src={src}
              rot={-3}
              priority
              slap
              delay={380}
              framing={photo?.framing}
              className="aspect-[0.82] w-full"
            >
              {badge ? (
                <span
                  className={`absolute -top-3.5 -right-1.5 z-[2] lg:-top-5 lg:-right-4 ${slotted ? "max-lg:hidden" : ""}`}
                >
                  {badge}
                </span>
              ) : null}
            </PhotoSticker>
          </div>
        ) : null}

        <div
          className={`relative z-[3] -mt-11 ${src ? "col-span-2" : ""} row-start-4 lg:col-span-2 lg:row-start-3 lg:-mt-[104px]`}
        >
          {round ? (
            // Desktop: slapped across the strip's upper edge (the way a price lands on a tarp),
            // biting the band above its lettering, never over it.
            <div className="absolute -top-[126px] left-[6%] z-[1] hidden lg:block">{round}</div>
          ) : null}
          <Strip className="lg:py-5">
            <p className="pm-d1 text-center text-[1.5rem] leading-[1.06] tracking-[0.01em] lg:text-[2.5rem]">
              {shown.length ? (
                <>
                  <span className="sr-only">When: </span>
                  {shown.map((s, i) => (
                    <span key={s.id} className="block lg:inline">
                      {i ? (
                        <span aria-hidden className="hidden lg:inline">
                          {" "}
                          ·{" "}
                        </span>
                      ) : null}
                      <span className="text-club-ball">{s.name}</span>
                      {s.when ? ` · ${s.when}` : ""}
                    </span>
                  ))}
                  {more > 0 ? (
                    <span className="block lg:inline">
                      <span aria-hidden className="hidden lg:inline">
                        {" "}
                        ·{" "}
                      </span>
                      +{more} more
                    </span>
                  ) : null}
                </>
              ) : (
                "Schedule drops soon"
              )}
            </p>
          </Strip>
        </div>

        <div
          className={`row-start-5 mt-5 grid gap-3.5 ${src ? "col-span-2" : ""} lg:col-span-2 lg:row-start-4 lg:mt-11 lg:flex lg:items-center lg:justify-between lg:gap-8`}
        >
          <div className="flex flex-wrap items-center gap-2.5 lg:gap-4">
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
            ) : meet ? (
              <a href="#coaches" className={skewClass("lime", "lg")}>
                <SkewLabel>
                  {meet}
                  <ArrowDown aria-hidden className="size-[22px]" />
                </SkewLabel>
              </a>
            ) : null}
            {message ? (
              <a href={message.href} className={pillClass("white")}>
                {CONTACT_ICON[message.id]}
                {contactLabel(message, null)}
              </a>
            ) : null}
          </div>
          {next ? (
            <p className="num text-[1.25rem] leading-tight font-bold text-white lg:text-right lg:text-[1.5rem] lg:font-semibold">
              Next session {fmt.day(fmt.dayOf(next.at))} · {fmt.time(next.at)}
              {nextVenue ? (
                <>
                  {" "}
                  at <span className="whitespace-nowrap">{nextVenue.name}</span>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------------------------

/** Each program on its own field, Jersey Blue and Deep Green by turns (two across on desktops). */
function Programs({
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
  if (!academy.programs.length) {
    return (
      <Panel field="blue" id="programs" labelledBy="programs-title">
        <div className={`${WRAP} py-16 lg:py-28`}>
          <SoonBlock
            id="programs-title"
            title="Programs drop soon"
            line="The academy is setting its schedule."
          />
        </div>
      </Panel>
    );
  }
  const odd = academy.programs.length % 2 === 1;
  return (
    <section
      id="programs"
      aria-labelledby="programs-title"
      className="scroll-mt-14 lg:scroll-mt-16"
    >
      <h2 id="programs-title" className="sr-only">
        Programs
      </h2>
      <div className="grid lg:grid-cols-2">
        {academy.programs.map((p, i) => (
          <ProgramPanel
            key={p.id}
            academy={academy}
            program={p}
            field={i % 2 ? "deep" : "blue"}
            slug={slug}
            preview={preview}
            fmt={fmt}
            className={odd && i === academy.programs.length - 1 ? "lg:col-span-2" : ""}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// On court
// ---------------------------------------------------------------------------------------------

/** The academy's own photos, stuck on the tarp: a swipe row on phones, a scatter on desktops. */
function OnCourt({ academy }: { academy: PublicAcademyDto }) {
  const photos = academy.photos.slice(0, 12);
  if (!photos.length) return null;
  const turns = [-3, 2, -1.5, 2.5, -2, 1.5];
  return (
    <Panel field="green" id="on-court" labelledBy="on-court-title">
      <div className="pt-14 pb-12 lg:pt-24 lg:pb-24">
        <div className={WRAP}>
          <h2 id="on-court-title" className="pm-d1 text-[4.5rem] text-white lg:text-[6rem]">
            On court
          </h2>
        </div>
        <section
          aria-label={`${academy.name} photos`}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a sideways-scrolling row takes one keyboard stop, so it scrolls without a pointer (axe's scrollable-region-focusable).
          tabIndex={0}
          className="mt-6 snap-x snap-mandatory scroll-px-5 overflow-x-auto pt-4 pb-6 outline-none [scrollbar-width:none] focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] lg:mt-10 lg:overflow-visible lg:p-0"
        >
          <ul className="flex w-max gap-5 px-5 lg:mx-auto lg:grid lg:w-full lg:max-w-[1440px] lg:grid-cols-3 lg:gap-x-10 lg:gap-y-14 lg:px-16">
            {photos.map((p, i) => {
              const src = publicFileUrl(p.key);
              if (!src) return null;
              return (
                <li
                  key={p.id}
                  className={`w-[78vw] max-w-[26rem] shrink-0 snap-start lg:w-auto lg:max-w-none ${i % 3 === 1 ? "lg:mt-12" : ""}`}
                >
                  <figure>
                    <PhotoSticker
                      src={src}
                      alt={p.caption ?? ""}
                      rot={turns[i % turns.length]}
                      framing={framingOr(p.framing, SCENE_FRAMING)}
                      priority={i < 2}
                      className="aspect-[4/3] w-full"
                    />
                    {p.caption ? (
                      <figcaption className="mt-4 ml-2">
                        <Sticker
                          tone="deep"
                          rot={i % 2 ? 2 : -2}
                          className="text-[0.9375rem] whitespace-normal"
                        >
                          {p.caption}
                        </Sticker>
                      </figcaption>
                    ) : null}
                  </figure>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// Coaches
// ---------------------------------------------------------------------------------------------

/**
 * A coach as the pubmat features one: the photo stuck on with their DUPR as a sticker, the name
 * huge, their certifications as stickers, highlights, and what they coach; their specialties run
 * on a strip under them.
 */
function CoachFeature({
  person,
  programs,
  flip,
  slug,
  preview,
  level,
}: {
  person: PublicCoachDto;
  programs: string[];
  flip: boolean;
  slug: string;
  preview: boolean;
  level: 2 | 3;
}) {
  const Name = `h${level}` as "h2" | "h3";
  const { name, title } = coachHeading(person);
  const years = person.yearsCoaching;
  const facts = [
    years ? `${years} ${years === 1 ? "year" : "years"} coaching` : null,
    person.languages.length ? person.languages.join(", ") : null,
  ].filter((f): f is string => Boolean(f));
  const nameId = `coach-${person.id}-name`;
  return (
    <article aria-labelledby={nameId}>
      <div
        className={`${WRAP} grid gap-[30px] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center lg:gap-x-20 ${flip ? "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" : ""}`}
      >
        <div
          className={`relative ml-2.5 w-[min(100%,280px)] lg:mx-auto lg:w-[min(100%,430px)] ${flip ? "lg:order-2" : ""}`}
        >
          <Link
            to="/a/$slug/team"
            params={{ slug }}
            search={previewSearch(preview)}
            hash={`coach-${person.id}`}
            aria-labelledby={nameId}
            className="block rounded-[18px] outline-none focus-visible:outline-[3px] focus-visible:outline-offset-4 focus-visible:outline-club-ink"
          >
            <span className="block [rotate:-3deg] overflow-hidden rounded-[18px] border-8 border-white bg-white ring-2 ring-club-mist">
              <TeamPortrait person={person} size="lg" />
            </span>
          </Link>
          {person.duprRating != null ? (
            <RoundSticker
              label={`DUPR rating ${person.duprRating.toFixed(2)}`}
              top="DUPR"
              figure={person.duprRating.toFixed(2)}
              tone="lime"
              rot={-9}
              className="absolute -top-[22px] -left-3.5 z-[2] w-[122px] text-[0.9375rem] lg:-top-[30px] lg:-left-11 lg:w-[150px] lg:text-[1.1875rem]"
            />
          ) : null}
        </div>
        <div className="min-w-0">
          <Name id={nameId} className="pm-d1 text-[4.25rem] break-words lg:text-[6rem]">
            {name}
          </Name>
          {title ? <p className="pm-d2 mt-2 text-[1.5rem] lg:text-[1.875rem]">{title}</p> : null}
          {person.certifications.length ? (
            <div className="mt-5 flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
              <span aria-hidden className="text-[1rem] font-semibold">
                Certifications
              </span>
              <ul aria-label="Certifications" className="flex flex-wrap gap-2.5">
                {person.certifications.map((c, i) => (
                  <li key={c}>
                    <Sticker
                      tone="blue"
                      rot={i % 2 ? 3 : -3}
                      className="text-[1.375rem] normal-case"
                    >
                      {c}
                    </Sticker>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {facts.length ? (
            <p className="mt-[18px] text-[1.25rem] leading-snug font-semibold lg:text-[1.375rem]">
              {facts.join(" · ")}
            </p>
          ) : null}
          {person.highlights.length ? (
            <ul aria-label="Highlights" className="mt-5 grid gap-2.5">
              {person.highlights.slice(0, 3).map((h) => (
                <li key={h} className="flex items-start gap-3 text-[1.0625rem] font-semibold">
                  <Medal aria-hidden className="mt-0.5 size-5 shrink-0 text-club" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {person.bio ? (
            <p className="mt-4 max-w-[52ch] text-[1.0625rem] leading-relaxed whitespace-pre-line">
              {firstSentence(person.bio, 280) ?? person.bio}
            </p>
          ) : null}
          {programs.length ? (
            <p className="mt-2 max-w-[46ch] text-[1.0625rem] text-pretty">
              Coaches the{" "}
              {programs.length === 1
                ? programs[0]
                : `${programs.slice(0, -1).join(", ")} and ${programs.at(-1)}`}
              .
            </p>
          ) : null}
        </div>
      </div>
      {person.specialties.length ? (
        <Strip className="mt-[34px] mb-[46px] lg:mt-14 lg:mb-[84px]">
          <p
            className={`${WRAP} pm-d1 text-[1.625rem] leading-[1.06] tracking-[0.01em] lg:text-[2.75rem] ${flip ? "lg:text-left" : "lg:text-right"}`}
          >
            <span className="sr-only">Specialties: </span>
            {person.specialties.join(" · ")}
          </p>
        </Strip>
      ) : (
        <div aria-hidden className="h-14 lg:h-20" />
      )}
    </article>
  );
}

/** The coaches on a white field: up to three featured, then the rest of the team on its page. */
function Coaches({
  academy,
  slug,
  preview,
}: {
  academy: PublicAcademyDto;
  slug: string;
  preview: boolean;
}) {
  if (!academy.coaches.length) return null;
  const teams = programTeams(academy);
  const shown = academy.coaches.slice(0, 3);
  const several = academy.coaches.length > 1;
  return (
    <Panel
      field="white"
      id="coaches"
      labelledBy={several ? "coaches-title" : undefined}
      label="The team"
      className="pt-[60px] lg:pt-[100px]"
    >
      {several ? (
        <div className={`${WRAP} mb-12 lg:mb-16`}>
          <h2 id="coaches-title" className="pm-d1 text-[4.5rem] lg:text-[6rem]">
            The team
          </h2>
        </div>
      ) : null}
      <div className="flex flex-col">
        {shown.map((p, i) => (
          <CoachFeature
            key={p.id}
            person={p}
            programs={programsOf(teams, p.id).map((x) => x.name)}
            flip={i % 2 === 1}
            slug={slug}
            preview={preview}
            level={several ? 3 : 2}
          />
        ))}
      </div>
      <div className={`${WRAP} -mt-4 pb-14 lg:-mt-8 lg:pb-20`}>
        <Link
          to="/a/$slug/team"
          params={{ slug }}
          search={previewSearch(preview)}
          className={pillClass("outlineInk")}
        >
          {academy.coaches.length > shown.length
            ? `Meet all ${academy.coaches.length} on the team`
            : "Meet the team"}
          <ArrowRight aria-hidden className="size-5" />
        </Link>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------------------------

/** The packages on a lime field as price stickers, grouped by program, each with its Enroll. */
function Packages({ page, slug, fmt }: { page: PublicPage; slug: string; fmt: Format }) {
  const academy = page.academy;
  const preview = page.kind === "preview";
  if (!academy.packages.length) {
    return (
      <Panel field="lime" id="packages" labelledBy="packages-title">
        <div className={`${WRAP} py-16 lg:py-28`}>
          <SoonBlock
            id="packages-title"
            title="Packages drop soon"
            line="Packages and prices appear here once the academy publishes them."
            tone="blue"
            rot={3}
          />
        </div>
      </Panel>
    );
  }
  return (
    <Panel field="lime" id="packages" labelledBy="packages-title">
      <div className={`${WRAP} py-14 lg:pt-24 lg:pb-[108px]`}>
        <h2 id="packages-title" className="pm-d1 text-[5rem] lg:text-[6rem]">
          Packages
        </h2>
        <p className="mt-2.5 text-[1.0625rem] font-semibold">
          All prices are per head.
          {academy.enrollmentOpen
            ? ""
            : ` ${academy.name} isn't taking enrollment requests right now.`}
        </p>
        <div className="mt-10 lg:mt-14">
          <PackageGroups
            academy={academy}
            programs={academy.programs}
            fmt={fmt}
            enroll={
              page.kind === "public"
                ? (t) => <PackageEnroll academy={academy} tier={t} />
                : undefined
            }
          />
        </div>
        <Link
          to="/a/$slug/rates"
          params={{ slug }}
          search={previewSearch(preview)}
          className={pillClass("outlineInk", "mt-10 lg:mt-14")}
        >
          <Printer aria-hidden className="size-5" />
          Printable rates
        </Link>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// Find us
// ---------------------------------------------------------------------------------------------

/**
 * Where the academy plays and how to reach it, on a blue field: "See you at [venue]" with
 * directions, its own words about itself, its contact details, and its policies.
 */
function FindUs({ academy }: { academy: PublicAcademyDto }) {
  const venue = academyVenues(academy.programs)[0] ?? null;
  const actions = contactActions(academy);
  const message = actions[0] ?? null;
  const area = venue?.address ?? academy.address;
  const directions = venue ? directionsUrl(venue) : academy.mapUrl;
  const socials = ACADEMY_SOCIALS.filter((k) => academy.socials[k]);
  const phone = academy.contactPhone;
  const located = Boolean(venue || academy.address);
  const details = Boolean(
    academy.about || phone || academy.contactEmail || socials.length || academy.policies,
  );
  const ways =
    directions || message ? (
      <div className="mt-7 flex flex-wrap gap-3">
        {directions ? (
          <a
            href={directions}
            target="_blank"
            rel="noopener noreferrer"
            className={pillClass("white")}
          >
            Get directions
            <ArrowUpRight aria-hidden className="size-5" />
          </a>
        ) : null}
        {message ? (
          <a href={message.href} className={pillClass(directions ? "outline" : "white")}>
            {CONTACT_ICON[message.id]}
            {contactLabel(message, null)}
          </a>
        ) : null}
      </div>
    ) : null;
  if (!located && !details) {
    // Nothing posted yet: the pubmat's "coming soon" sticker, with its line beside it.
    return (
      <Panel field="blue" id="contact" labelledBy="find-title">
        <div className={`${WRAP} py-[58px] lg:pt-[100px] lg:pb-[108px]`}>
          <SoonBlock
            id="find-title"
            title="Location coming soon"
            line="The address and directions go up here once the academy posts them."
            tone="white"
            rot={-3}
          />
          {ways}
        </div>
      </Panel>
    );
  }
  return (
    <Panel field="blue" id="contact" labelledBy="find-title">
      <div
        className={`${WRAP} grid gap-[34px] py-[58px] lg:items-end lg:gap-x-20 lg:pt-[100px] lg:pb-[108px] ${details ? "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" : ""}`}
      >
        <div>
          {located ? (
            <>
              <h2 id="find-title" className="pm-d1 text-[3.875rem] break-words lg:text-[6rem]">
                See you at {venue?.name ?? academy.name}
              </h2>
              {area ? (
                <p className="pm-d2 mt-3.5 text-[1.75rem] text-club-ball lg:text-[2.125rem]">
                  {area}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <h2 id="find-title" className="pm-d1 max-w-[6.4em] text-[3.875rem] lg:text-[6rem]">
                Location coming soon
              </h2>
              <p className="mt-4 max-w-[34ch] text-[1.25rem] font-semibold">
                The address and directions go up here once the academy posts them.
              </p>
            </>
          )}
          {ways}
        </div>
        {details ? (
          <div>
            {academy.about ? (
              <p className="max-w-[44ch] text-[1.125rem] leading-normal whitespace-pre-line lg:text-[1.1875rem]">
                {academy.about}
              </p>
            ) : null}
            {phone || academy.contactEmail || socials.length ? (
              <dl className="mt-6 grid gap-4">
                {actions.find((a) => a.id === "messenger") ? (
                  <div className="grid gap-0.5">
                    <dt className="text-[0.9375rem] font-semibold text-white/85">Messenger</dt>
                    <dd className="text-[1.25rem] font-bold">
                      <a
                        href={actions.find((a) => a.id === "messenger")?.href}
                        className="rounded-sm no-underline outline-none hover:underline"
                      >
                        Message {academy.name}
                      </a>
                    </dd>
                  </div>
                ) : null}
                {phone ? (
                  <div className="grid gap-0.5">
                    <dt className="text-[0.9375rem] font-semibold text-white/85">Phone</dt>
                    <dd className="num text-[1.25rem] font-bold">
                      <a
                        href={`tel:${phone.replace(/[^\d+]/g, "")}`}
                        className="rounded-sm no-underline outline-none hover:underline"
                      >
                        {phone}
                      </a>
                    </dd>
                  </div>
                ) : null}
                {academy.contactEmail ? (
                  <div className="grid gap-0.5">
                    <dt className="text-[0.9375rem] font-semibold text-white/85">Email</dt>
                    <dd className="text-[1.25rem] font-bold break-all">
                      <a
                        href={`mailto:${academy.contactEmail}`}
                        className="rounded-sm no-underline outline-none hover:underline"
                      >
                        {academy.contactEmail}
                      </a>
                    </dd>
                  </div>
                ) : null}
                {socials.length ? (
                  <div className="grid gap-0.5">
                    <dt className="text-[0.9375rem] font-semibold text-white/85">Follow</dt>
                    <dd className="flex flex-wrap gap-x-5 gap-y-1 text-[1.25rem] font-bold">
                      {socials.map((k) => (
                        <a
                          key={k}
                          href={academy.socials[k]}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-sm no-underline outline-none hover:underline"
                        >
                          {ACADEMY_SOCIAL_LABELS[k]}
                          <ArrowUpRight aria-hidden className="size-4" />
                        </a>
                      ))}
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
            {academy.policies ? <Policies text={academy.policies} /> : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------

/**
 * The academy's website, its landing page (Persuade, phone-first), set like an enrollment pubmat in
 * the club's colors: the tarp, each program, the courts, the coaches, the packages, how to
 * enroll, and where to find the academy. Every part says what's coming when it has nothing yet.
 */
export function LandingPage({
  page,
  slug,
  fmt,
}: {
  page: PublicPage;
  slug: string;
  programId?: string;
  fmt: Format;
}) {
  const academy = page.academy;
  const preview = page.kind === "preview";
  return (
    <SiteFrame page={page} slug={slug} current="home">
      <Hero academy={academy} slug={slug} preview={preview} fmt={fmt} />
      <Programs academy={academy} slug={slug} preview={preview} fmt={fmt} />
      <OnCourt academy={academy} />
      <Coaches academy={academy} slug={slug} preview={preview} />
      <Packages page={page} slug={slug} fmt={fmt} />
      <StepsPanel academy={academy} slug={slug} preview={preview} />
      <FindUs academy={academy} />
    </SiteFrame>
  );
}
