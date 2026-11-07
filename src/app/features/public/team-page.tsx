import type { PublicAcademyDto, PublicCoachDto, PublicProgramDto } from "@shared/api-types";
import { ACADEMY_SOCIAL_LABELS, ACADEMY_SOCIALS } from "@shared/domain";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  Globe,
  type LucideIcon,
  Mail,
  MapPin,
  Medal,
  Phone,
  Printer,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { tapArea } from "../../components/ui/button";
import type { Format } from "../../lib/format";
import { TeamFace, TeamPortrait } from "./people";
import { ContactBar, ProgramPlaceRows, useScrolledPast } from "./public-ui";
import { FIELD, pillClass, RoundSticker, SkewLabel, Sticker, skewClass } from "./pubmat";
import type { PublicPage } from "./queries";
import { ContactPanel, SiteFrame } from "./site";
import { programWhen } from "./site-blocks";
import {
  EVERYONE,
  type ProgramTeam,
  programsOf,
  programTeams,
  teamCountLine,
  teamView,
} from "./team";
import { type ContactAction, contactActions, programVenue, scheduleLines, tiersOf } from "./text";

/** `?program=` (and `?preview=1` for staff) for a link that stays on the academy's pages. */
function searchFor(program: string | undefined, preview: boolean) {
  return {
    ...(program ? { program } : {}),
    ...(preview ? { preview: 1 as const } : {}),
  };
}

/** Up to four faces of the people in a program (and how many more), overlapping, on its tab. */
function FaceStack({ people }: { people: PublicCoachDto[] }) {
  const shown = people.slice(0, 4);
  const more = people.length - shown.length;
  const ring = "ring-2 ring-[var(--tile)]";
  return (
    <span aria-hidden className="flex shrink-0">
      {shown.map((p, i) => (
        <TeamFace key={p.id} person={p} className={`${ring} ${i ? "-ml-2" : ""}`} />
      ))}
      {more > 0 ? (
        <span
          className={`-ml-2 flex size-9 items-center justify-center rounded-full bg-club-ink text-[0.75rem] font-bold text-white ${ring}`}
        >
          +{more}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The programs as sticker tabs (a sideways row on phones; on desktops a column of tabs, each with
 * when it meets and who coaches it as faces, the chosen one lime), and Everyone last. Choosing
 * one swaps the roster in a view transition (people who coach both glide into place).
 */
function TeamPicker({
  teams,
  everyone,
  selected,
  slug,
  preview,
  fmt,
}: {
  teams: ProgramTeam[];
  everyone: PublicCoachDto[];
  selected: string;
  slug: string;
  preview: boolean;
  fmt: Format;
}) {
  const list = useRef<HTMLUListElement>(null);
  const current = useRef<HTMLAnchorElement>(null);
  // The phone's sideways row keeps the chosen tab in view. Only the row scrolls: the page never
  // moves, so a link to someone's space (#coach-…) keeps its place.
  useEffect(() => {
    const row = list.current;
    const tab = current.current;
    if (!row || !tab || row.scrollWidth <= row.clientWidth || !selected) return;
    row.scrollTo({ left: Math.max(0, tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2) });
  }, [selected]);
  const items = [
    ...teams.map((t) => ({
      id: t.program.id,
      label: t.program.name,
      meta: scheduleLines(t.program, fmt)[0] ?? null,
      people: t.people,
    })),
    {
      id: EVERYONE,
      label: "Everyone",
      meta: `${everyone.length} ${everyone.length === 1 ? "person" : "people"}`,
      people: everyone,
    },
  ];
  return (
    <nav aria-label="Programs">
      <ul
        ref={list}
        className="relative -mx-5 flex scroll-px-5 gap-2.5 overflow-x-auto px-5 pt-1.5 pb-2 [scrollbar-width:none] lg:mx-0 lg:flex-col lg:overflow-visible lg:p-0"
      >
        {items.map((it) => {
          const on = it.id === selected;
          return (
            <li key={it.id} className="shrink-0">
              <Link
                ref={on ? current : undefined}
                to="/a/$slug/team"
                params={{ slug }}
                search={searchFor(it.id, preview)}
                replace
                resetScroll={false}
                viewTransition
                aria-current={on ? "true" : undefined}
                className={`flex min-h-12 items-center gap-3 rounded-[14px] border-[3px] border-white px-4 whitespace-nowrap outline-none transition-colors focus-visible:outline-[3px] focus-visible:outline-offset-[3px] lg:min-h-14 lg:py-2 lg:whitespace-normal ${
                  on
                    ? "bg-club-ball text-club-ink [--tile:var(--color-club-ball)]"
                    : "text-white [--tile:var(--color-club-deep)] hover:bg-white/10"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="pm-d2 block text-[1.1875rem] font-black">{it.label}</span>
                  {it.meta && !on ? (
                    <span className="num mt-1 hidden text-[0.875rem] font-semibold text-club-mist lg:block">
                      {it.meta}
                    </span>
                  ) : null}
                </span>
                <span className="hidden lg:flex">
                  <FaceStack people={it.people} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** When the chosen program meets, in lime numerals on the panel (the tab above names it). */
function ProgramTimes({ program, fmt }: { program: PublicProgramDto; fmt: Format }) {
  const when = programWhen(program, fmt);
  const note = program.scheduleNote?.trim();
  if (!when.length && !note) return null;
  return (
    <div>
      <p className="sr-only">{program.name} meets</p>
      {when.length ? (
        <p className="pm-d1 num text-[3.25rem] text-club-ball lg:text-[3.5rem]">
          {when.map((w) => (
            <span key={`${w.days}-${w.time}`} className="block">
              <span className="block">{w.days}</span>
              <span className="block whitespace-nowrap">{w.time}</span>
            </span>
          ))}
        </p>
      ) : (
        <p className="pm-d2 text-[1.75rem] text-club-ball">{note}</p>
      )}
    </div>
  );
}

/**
 * Desktop: where the chosen program meets and when it next meets, under its times. Phones keep
 * the panel short so the first portrait starts at the fold; the landing page carries them there.
 */
function ProgramPlace({ program, fmt }: { program: PublicProgramDto; fmt: Format }) {
  if (!programVenue(program) && !program.nextSessionAt) return null;
  return (
    <dl className="hidden flex-col gap-3 text-[1rem] font-medium lg:flex">
      <ProgramPlaceRows program={program} fmt={fmt} />
    </dl>
  );
}

const panelLink = `${tapArea} rounded-sm font-semibold underline decoration-2 underline-offset-4 outline-none hover:decoration-club-ball`;

function PanelRow({
  icon: Icon,
  term,
  children,
}: {
  icon: LucideIcon;
  term: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <dt className="sr-only">{term}</dt>
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-club-ball" />
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * Desktop, on Everyone: the academy's contact details under its actions (the number shows on
 * screens that can't dial a Call button).
 */
function AcademyContactRows({ academy }: { academy: PublicAcademyDto }) {
  const socials = ACADEMY_SOCIALS.filter((k) => academy.socials[k]);
  const phone = academy.contactPhone;
  if (!phone && !academy.contactEmail && !academy.address && !socials.length) return null;
  const dial = phone?.replace(/[^\d+]/g, "");
  return (
    <dl className="hidden flex-col gap-4 text-[1rem] lg:flex">
      {phone ? (
        <PanelRow icon={Phone} term="Phone">
          <span className="flex flex-wrap gap-x-4">
            <a href={`tel:${dial}`} className={`${panelLink} num`}>
              {phone}
            </a>
            <a href={`sms:${dial}`} className={panelLink}>
              Send a text
            </a>
          </span>
        </PanelRow>
      ) : null}
      {academy.contactEmail ? (
        <PanelRow icon={Mail} term="Email">
          <a href={`mailto:${academy.contactEmail}`} className={`${panelLink} break-all`}>
            {academy.contactEmail}
          </a>
        </PanelRow>
      ) : null}
      {academy.address ? (
        <PanelRow icon={MapPin} term="Address">
          <span className="block">{academy.address}</span>
          {academy.mapUrl ? (
            <a
              href={academy.mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${panelLink} mt-1 inline-flex items-center gap-1.5`}
            >
              Open the map
              <ArrowUpRight aria-hidden className="size-4" />
            </a>
          ) : null}
        </PanelRow>
      ) : null}
      {socials.length ? (
        <PanelRow icon={Globe} term="Follow">
          <span className="flex flex-wrap gap-x-4 gap-y-2">
            {socials.map((k) => (
              <a
                key={k}
                href={academy.socials[k]}
                target="_blank"
                rel="noopener noreferrer"
                className={`${panelLink} inline-flex items-center gap-1`}
              >
                {ACADEMY_SOCIAL_LABELS[k]}
                <ArrowUpRight aria-hidden className="size-4" />
              </a>
            ))}
          </span>
        </PanelRow>
      ) : null}
    </dl>
  );
}

/** What the chosen program offers a family: Enroll while it takes requests, or its rates. */
type ProgramAction = "enroll" | "rates" | null;

function programAction(academy: PublicAcademyDto, program: PublicProgramDto | null) {
  if (!program || !tiersOf(academy.packages, program.id).length) return null;
  return academy.enrollmentOpen ? "enroll" : "rates";
}

/**
 * The panel's actions: Enroll in the chosen program (to its packages on Enroll now, where each
 * has its own Enroll) while the academy takes requests, then the ways to reach it.
 */
function TeamActions({
  program,
  action,
  actions,
  slug,
  preview,
}: {
  program: PublicProgramDto | null;
  action: ProgramAction;
  actions: ContactAction[];
  slug: string;
  preview: boolean;
}) {
  const enroll = action === "enroll";
  const [primary, second] = [
    actions[0],
    actions.find((a) => a.id === "call" && a !== actions[0]) ?? actions[1],
  ];
  const contactLabel = (a: ContactAction) =>
    a.id === "messenger"
      ? enroll
        ? "Message"
        : "Message us"
      : a.id === "text"
        ? enroll
          ? "Text"
          : "Text us"
        : a.id === "call"
          ? "Call"
          : a.label;
  if (!action && !primary) return null;
  // Desktop: the main move takes the panel's width; Message and Call share the row under it.
  const compact = "lg:min-h-11 lg:px-4";
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {program && action ? (
        <Link
          to="/a/$slug/enroll"
          params={{ slug }}
          search={searchFor(program.id, preview)}
          className={`${enroll ? skewClass("lime", "md") : pillClass("white")} lg:w-full`}
        >
          {enroll ? (
            <SkewLabel>
              Enroll<span className="sr-only"> in {program.name}</span>
              <ArrowRight aria-hidden className="size-5" />
            </SkewLabel>
          ) : (
            <>
              See packages<span className="sr-only"> for {program.name}</span>
              <ArrowRight aria-hidden className="size-5" />
            </>
          )}
        </Link>
      ) : null}
      {primary ? (
        <a href={primary.href} className={pillClass(action ? "outline" : "white", compact)}>
          {contactLabel(primary)}
        </a>
      ) : null}
      {second ? (
        <a href={second.href} className={pillClass("outline", compact)}>
          {contactLabel(second)}
        </a>
      ) : null}
    </div>
  );
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[0.9375rem] font-bold">{term}</dt>
      <dd className="mt-2">{children}</dd>
    </div>
  );
}

/** "Coach Jerros" when the title is plain "Coach"; otherwise the name, with the title under it. */
function coachHeading(person: PublicCoachDto) {
  const plain = /^coach$/i.test(person.title?.trim() ?? "");
  return { name: plain ? `Coach ${person.name}` : person.name, title: plain ? null : person.title };
}

/**
 * One person's space, a white card on the tarp: the half-body portrait stuck on (full width on
 * phones; beside the details from md, where it stays in view along a long read) with their DUPR
 * as a sticker, then the name, the facts a parent weighs, certifications as stickers, highlights,
 * about, specialties, and the programs they coach.
 */
function CoachSpace({
  person,
  lead,
  programs,
  current,
  first,
  slug,
  preview,
}: {
  person: PublicCoachDto;
  lead: boolean;
  programs: PublicProgramDto[];
  current: string | null;
  first: boolean;
  slug: string;
  preview: boolean;
}) {
  const nameId = `coach-${person.id}-name`;
  const { name, title } = coachHeading(person);
  const years = person.yearsCoaching;
  const facts = [
    years ? `${years} ${years === 1 ? "year" : "years"} coaching` : null,
    person.languages.length ? person.languages.join(", ") : null,
  ].filter((f): f is string => Boolean(f));
  return (
    <li id={`coach-${person.id}`} className="scroll-mt-20">
      <article
        aria-labelledby={nameId}
        className="rounded-2xl bg-white p-4 text-club-ink [--focus:var(--color-club-ink)] sm:p-5 md:grid md:grid-cols-[minmax(0,17.5rem)_minmax(0,1fr)] md:gap-6 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]"
      >
        <div className="relative md:sticky md:top-[88px] md:self-start">
          <span className="block [rotate:-1.5deg] overflow-hidden rounded-[14px] border-[6px] border-white bg-white ring-1 ring-club-ink/10">
            <TeamPortrait person={person} size="lg" transition priority={first} />
          </span>
          {person.duprRating != null ? (
            <RoundSticker
              label={`DUPR rating ${person.duprRating.toFixed(2)}`}
              top="DUPR"
              figure={person.duprRating.toFixed(2)}
              tone="lime"
              rot={-8}
              className="absolute -top-3 -left-2 z-[2] w-[104px] text-[0.8125rem]"
            />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-5 pt-6 md:pt-1">
          <header>
            <h3 id={nameId} className="pm-d1 text-[3.25rem] break-words lg:text-[3.5rem]">
              {name}
            </h3>
            {title ? <p className="pm-d2 mt-2 text-[1.375rem]">{title}</p> : null}
            {lead || facts.length ? (
              <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                {lead ? (
                  <Sticker tone="lime" rot={-3} className="border-club-ink text-[0.9375rem]">
                    Program lead
                  </Sticker>
                ) : null}
                {facts.length ? (
                  <span className="text-[1.125rem] font-semibold">{facts.join(" · ")}</span>
                ) : null}
              </p>
            ) : null}
          </header>
          {person.certifications.length ||
          person.highlights.length ||
          person.bio ||
          person.specialties.length ||
          programs.length ? (
            <dl className="flex flex-col gap-5">
              {person.certifications.length ? (
                <Detail term="Certifications">
                  <ul className="flex flex-wrap gap-2.5 pt-1">
                    {person.certifications.map((c, i) => (
                      <li key={c}>
                        <Sticker
                          tone="blue"
                          rot={i % 2 ? 3 : -3}
                          className="border-club-ink/10 text-[1.125rem] normal-case"
                        >
                          {c}
                        </Sticker>
                      </li>
                    ))}
                  </ul>
                </Detail>
              ) : null}
              {person.highlights.length ? (
                <Detail term="Highlights">
                  <ul className="flex flex-col gap-2.5">
                    {person.highlights.map((h) => (
                      <li key={h} className="flex items-start gap-3 text-[1.0625rem] font-semibold">
                        <Medal aria-hidden className="mt-0.5 size-5 shrink-0 text-club" />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                </Detail>
              ) : null}
              {person.bio ? (
                <Detail term="About">
                  <p className="max-w-[65ch] text-[1.0625rem] leading-relaxed whitespace-pre-line">
                    {person.bio}
                  </p>
                </Detail>
              ) : null}
              {person.specialties.length ? (
                <Detail term="Specialties">
                  <ul className="flex flex-wrap gap-2">
                    {person.specialties.map((s) => (
                      <li
                        key={s}
                        className="rounded-md border-[1.5px] border-club-ink/70 px-2.5 pt-[5px] pb-1.5 text-[0.9375rem] leading-tight font-bold"
                      >
                        {s}
                      </li>
                    ))}
                  </ul>
                </Detail>
              ) : null}
              {programs.length ? (
                <Detail term="Programs">
                  <ul className="flex flex-wrap gap-2">
                    {programs.map((p) =>
                      p.id === current ? (
                        <li
                          key={p.id}
                          aria-current="true"
                          className="inline-flex min-h-11 items-center rounded-full bg-club-ball px-4 text-[1rem] font-bold"
                        >
                          {p.name}
                        </li>
                      ) : (
                        <li key={p.id}>
                          <Link
                            to="/a/$slug/team"
                            params={{ slug }}
                            search={searchFor(p.id, preview)}
                            hash={`coach-${person.id}`}
                            viewTransition
                            className={pillClass("outlineInk", "min-h-11")}
                          >
                            {p.name}
                          </Link>
                        </li>
                      ),
                    )}
                  </ul>
                </Detail>
              ) : null}
            </dl>
          ) : null}
        </div>
      </article>
    </li>
  );
}

/**
 * Everyone else, on a white card: on phones a sideways row of photo stickers (the next one
 * peeking), from `sm` a compact grid; each opens their own space.
 */
function AlsoOnTheTeam({
  people,
  slug,
  preview,
}: {
  people: PublicCoachDto[];
  slug: string;
  preview: boolean;
}) {
  return (
    <section
      aria-labelledby="also-title"
      className="rounded-2xl bg-white py-5 text-club-ink [--focus:var(--color-club-ink)] sm:p-6"
    >
      <h2 id="also-title" className="pm-d1 px-5 text-[2.75rem] sm:px-0">
        Also on the team
      </h2>
      <ul className="mt-5 flex snap-x snap-mandatory scroll-px-5 gap-4 overflow-x-auto px-5 pt-1 pb-2 [scrollbar-width:none] sm:grid sm:grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] sm:gap-y-6 sm:overflow-visible sm:px-0">
        {people.map((p, i) => (
          <li key={p.id} className="w-[70%] shrink-0 snap-start sm:w-auto">
            <Link
              to="/a/$slug/team"
              params={{ slug }}
              search={searchFor(EVERYONE, preview)}
              hash={`coach-${p.id}`}
              viewTransition
              className="group block rounded-[14px] outline-none focus-visible:outline-[3px] focus-visible:outline-offset-4 focus-visible:outline-club-ink"
            >
              <span
                className="block overflow-hidden rounded-[14px] border-[6px] border-white ring-1 ring-club-ink/10"
                style={{ rotate: `${i % 2 ? 1.5 : -1.5}deg` }}
              >
                <TeamPortrait person={p} size="reel" transition />
              </span>
              <span className="mt-3 block text-[1.0625rem] leading-tight font-bold underline-offset-4 group-hover:underline">
                {p.name}
              </span>
              {p.title ? (
                <span className="mt-0.5 block text-[0.9375rem] text-club-ink/75">{p.title}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Desktop: the panel sticks under the nav only while all of it fits on screen. Taller (a short
 * laptop, many programs), it scrolls away with the page, so nothing in it is ever cut off.
 */
function usePanelFits() {
  const ref = useRef<HTMLElement>(null);
  const [fits, setFits] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The nav's 88px above it, and a little air below.
    const check = () => setFits(el.offsetHeight <= window.innerHeight - 104);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    window.addEventListener("resize", check);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", check);
    };
  }, []);
  return [ref, fits] as const;
}

/**
 * "Meet the team" (Persuade, phone-first): parents meet coaches through the program their child
 * will join. On the tarp, the deep-green panel holds the programs as sticker tabs (`?program=`,
 * Everyone last), when the chosen one meets (on desktop also where, and its next session), and
 * Enroll; on Everyone, desktop adds the academy's contact details. Each coach gets a white card
 * led by their portrait, then the rest of the team; on phones the roster closes on Enroll again.
 */
export function TeamPage({
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
  const teams = programTeams(academy);
  const view = teamView(academy, teams, programId);
  const program = view.kind === "program" ? view.team.program : null;
  const people = view.kind === "program" ? view.team.people : view.people;
  const action = programAction(academy, program);
  const actions = contactActions(academy);
  const [actionsRef, barShown] = useScrolledPast(actions.length > 0);
  const [panel, fits] = usePanelFits();
  return (
    <SiteFrame
      page={page}
      slug={slug}
      current="team"
      bar={
        actions.length ? (
          <ContactBar academyName={academy.name} actions={actions} shown={barShown} />
        ) : undefined
      }
    >
      <div className={`relative overflow-clip ${FIELD.green}`}>
        <div className="relative z-[1] mx-auto max-w-[1440px] px-3 pt-4 pb-14 sm:px-5 lg:grid lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:gap-6 lg:px-16 lg:pt-10 lg:pb-24">
          <aside
            ref={panel}
            className={`pm-dark flex flex-col gap-6 rounded-[22px] bg-club-deep px-5 pt-7 pb-7 text-white sm:px-6 lg:gap-5 lg:self-start lg:p-6 ${fits ? "lg:sticky lg:top-[88px]" : ""}`}
          >
            <h1 className="pm-d1 text-[3.75rem] lg:text-[3.125rem] lg:whitespace-nowrap">
              Meet the team
            </h1>
            {teams.length ? (
              <TeamPicker
                teams={teams}
                everyone={academy.coaches}
                selected={program?.id ?? EVERYONE}
                slug={slug}
                preview={preview}
                fmt={fmt}
              />
            ) : null}
            {program ? <ProgramTimes program={program} fmt={fmt} /> : null}
            {program ? <ProgramPlace program={program} fmt={fmt} /> : null}
            <div ref={actionsRef}>
              <TeamActions
                program={program}
                action={action}
                actions={actions}
                slug={slug}
                preview={preview}
              />
            </div>
            {program ? null : <AcademyContactRows academy={academy} />}
            {academy.packages.length ? (
              <div className="mt-auto hidden border-t border-white/20 pt-4 lg:block">
                <Link
                  to="/a/$slug/rates"
                  params={{ slug }}
                  search={searchFor(undefined, preview)}
                  className={`${panelLink} inline-flex items-center gap-2`}
                >
                  <Printer aria-hidden className="size-5" />
                  Printable rates
                </Link>
              </div>
            ) : null}
          </aside>

          <div className="flex min-w-0 flex-col gap-5 pt-8 lg:pt-0">
            {people.length ? (
              <section aria-labelledby="team-title" className="flex flex-col gap-5">
                <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2 px-1 text-white">
                  <h2
                    id="team-title"
                    className="pm-d1 scroll-mt-20 text-[3.25rem] lg:text-[4.5rem]"
                  >
                    {program ? `${program.name} coaches` : "The whole team"}
                  </h2>
                  <p className="num text-[1.25rem] font-bold">
                    {view.kind === "program"
                      ? teamCountLine(view.team)
                      : `${people.length} ${people.length === 1 ? "person" : "people"}`}
                  </p>
                </div>
                <ol className="flex flex-col gap-5">
                  {people.map((p, i) => (
                    <CoachSpace
                      key={p.id}
                      person={p}
                      lead={view.kind === "program" && view.team.leadId === p.id}
                      programs={programsOf(teams, p.id)}
                      current={program?.id ?? null}
                      first={i === 0}
                      slug={slug}
                      preview={preview}
                    />
                  ))}
                </ol>
              </section>
            ) : (
              <section
                aria-labelledby="team-title"
                className="rounded-2xl bg-white p-6 text-club-ink [--focus:var(--color-club-ink)]"
              >
                <h2
                  id="team-title"
                  className="pm-sticker pm-d1 block w-fit max-w-full rounded-[18px] bg-club-ball px-[0.28em] pt-[0.2em] pb-[0.14em] text-[2.75rem] leading-[0.86] whitespace-normal text-club-ink"
                  style={{ rotate: "-3deg" }}
                >
                  The team is on its way
                </h2>
                <p className="mt-5 max-w-[60ch] text-[1.125rem] font-semibold">
                  {academy.name} hasn't added its coaches here yet.
                  {actions.length ? " Message or call them to ask." : ""}
                </p>
              </section>
            )}

            {view.kind === "program" && view.others.length ? (
              <AlsoOnTheTeam people={view.others} slug={slug} preview={preview} />
            ) : null}

            {program && action === "enroll" ? (
              // Phones: the decision comes after meeting the coaches, so Enroll closes the roster.
              <Link
                to="/a/$slug/enroll"
                params={{ slug }}
                search={searchFor(program.id, preview)}
                className={`${skewClass("ink", "lg")} w-full lg:hidden`}
              >
                <SkewLabel>
                  Enroll in {program.name}
                  <ArrowRight aria-hidden className="size-[22px]" />
                </SkewLabel>
              </Link>
            ) : null}
          </div>
        </div>
      </div>
      <ContactPanel academy={academy} />
    </SiteFrame>
  );
}
