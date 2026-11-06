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
  UsersRound,
} from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { buttonClass, tapArea } from "../../components/ui/button";
import type { Format } from "../../lib/format";
import { TeamFace, TeamPortrait } from "./people";
import { ContactBar, ProgramPlaceRows, useScrolledPast } from "./public-ui";
import type { PublicPage } from "./queries";
import { QuestionsBox, ScheduleText, SiteFrame } from "./site";
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

/** Up to four faces of the people in a program (and how many more), overlapping, on its tile. */
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
          className={`-ml-2 flex size-9 items-center justify-center rounded-full bg-night-3 text-[0.75rem] font-semibold text-night-ink ${ring}`}
        >
          +{more}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The programs as pills (phones) or dark list tiles (desktop: when each meets and who coaches it,
 * as faces; the chosen tile, lime, keeps only its name and faces, since its times show below), and
 * Everyone last. Choosing one swaps the canvas in a view transition (people who coach both glide
 * into place).
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
  // The phone's sideways row keeps the chosen pill in view. Only the row scrolls: the page never
  // moves, so a link to someone's space (#coach-…) keeps its place.
  useEffect(() => {
    const row = list.current;
    const pill = current.current;
    if (!row || !pill || row.scrollWidth <= row.clientWidth || !selected) return;
    row.scrollTo({ left: Math.max(0, pill.offsetLeft - (row.clientWidth - pill.offsetWidth) / 2) });
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
        className="relative -mx-5 flex scroll-px-5 gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
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
                className={`flex h-11 items-center gap-3 rounded-full px-4 text-[0.9375rem] whitespace-nowrap outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime lg:h-auto lg:min-h-[4.25rem] lg:rounded-[24px] lg:py-3 lg:whitespace-normal ${
                  on
                    ? "bg-lime text-ink [--tile:var(--color-lime)]"
                    : "bg-night-2 text-night-ink [--tile:var(--color-night-2)] hover:bg-night-3 hover:[--tile:var(--color-night-3)]"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block">{it.label}</span>
                  {it.meta && !on ? (
                    <span className="num mt-0.5 hidden text-[0.8125rem] text-night-ink-2 lg:block">
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

/** When the chosen program meets, on the dark block (the pill above names it). */
function ProgramTimes({ program, fmt }: { program: PublicProgramDto; fmt: Format }) {
  const lines = scheduleLines(program, fmt);
  if (!lines.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="sr-only">{program.name} meets</p>
      {lines.map((l) => (
        <p
          key={l}
          className="num text-[1.5rem] leading-tight font-light tracking-[-0.01em] sm:text-[1.75rem]"
        >
          <ScheduleText line={l} />
        </p>
      ))}
    </div>
  );
}

/**
 * Desktop: where the chosen program meets and when it next meets, under its times, as the academy
 * page's program pass shows them. Phones keep the block short so the first portrait starts at the
 * fold; the academy page carries them there.
 */
function ProgramPlace({ program, fmt }: { program: PublicProgramDto; fmt: Format }) {
  if (!programVenue(program) && !program.nextSessionAt) return null;
  return (
    <dl className="hidden flex-col gap-3 text-[0.9375rem] lg:flex">
      <ProgramPlaceRows program={program} fmt={fmt} />
    </dl>
  );
}

const panelLink = `${tapArea} rounded-sm underline decoration-night-ink-2 underline-offset-4 outline-none hover:decoration-night-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime`;

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
      <Icon aria-hidden className="mt-0.5 size-4.5 shrink-0 text-night-ink-2" />
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * Desktop, on Everyone: the academy's contact details under its actions (the number shows on
 * screens that can't dial a Call button), as the academy page's Contact card lists them.
 */
function AcademyContactRows({ academy }: { academy: PublicAcademyDto }) {
  const socials = ACADEMY_SOCIALS.filter((k) => academy.socials[k]);
  const phone = academy.contactPhone;
  if (!phone && !academy.contactEmail && !academy.address && !socials.length) return null;
  const dial = phone?.replace(/[^\d+]/g, "");
  return (
    <dl className="hidden flex-col gap-4 text-[0.9375rem] lg:flex">
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
              className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-full text-[0.875rem] font-medium text-night-ink underline underline-offset-4"
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
 * The dark block's actions: Enroll in the chosen program (to its packages on Enroll now, where
 * each has its own Enroll) while the academy takes requests, then the ways to reach it. The
 * first is lime; the rest are charcoal.
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
  return (
    <div className="flex flex-wrap gap-2">
      {program && action ? (
        <Link
          to="/a/$slug/enroll"
          params={{ slug }}
          search={searchFor(program.id, preview)}
          className={buttonClass(enroll ? "lime" : "night", "md")}
        >
          {enroll ? "Enroll" : "See packages"}
          <span className="sr-only"> in {program.name}</span>
          <ArrowRight aria-hidden className="size-4.5" />
        </Link>
      ) : null}
      {primary ? (
        <a href={primary.href} className={buttonClass(enroll ? "night" : "lime", "md")}>
          {contactLabel(primary)}
        </a>
      ) : null}
      {second ? (
        <a href={second.href} className={buttonClass("night", "md")}>
          {contactLabel(second)}
        </a>
      ) : null}
    </div>
  );
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[0.8125rem] text-ink-2">{term}</dt>
      <dd className="mt-2">{children}</dd>
    </div>
  );
}

/**
 * One person's space: the half-body portrait leads (full width on phones; beside the details from
 * md, where it stays in view along a long read), then name and title, the facts a parent weighs
 * (years, rating, languages), certifications, highlights, about, specialties, and the programs
 * they coach.
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
  const years = person.yearsCoaching;
  const numbers = [
    years ? { term: "Coaching", value: `${years} ${years === 1 ? "year" : "years"}` } : null,
    person.duprRating != null ? { term: "DUPR rating", value: person.duprRating.toFixed(2) } : null,
  ].filter((f): f is { term: string; value: string } => f !== null);
  // The numbers pair in two columns; the languages (a list) and a lone number take the row.
  const facts = [
    ...numbers.map((f) => ({ ...f, wide: numbers.length === 1 })),
    ...(person.languages.length
      ? [
          {
            term: person.languages.length === 1 ? "Language" : "Languages",
            value: person.languages.join(", "),
            wide: true,
          },
        ]
      : []),
  ];
  return (
    <li id={`coach-${person.id}`} className="scroll-mt-4">
      <article
        aria-labelledby={nameId}
        className="overflow-clip rounded-[28px] bg-ivory ring-[1.5px] ring-ivory-line ring-inset md:grid md:grid-cols-[minmax(0,17.5rem)_minmax(0,1fr)] md:gap-1 md:p-2 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]"
      >
        <div className="md:sticky md:top-[100px] md:self-start">
          <TeamPortrait
            person={person}
            size="lg"
            transition
            priority={first}
            className="md:rounded-[22px]"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-5 p-5 sm:p-6 md:py-4">
          <header>
            <h3
              id={nameId}
              className="font-display text-[2rem] leading-tight tracking-[-0.01em] break-words"
            >
              {person.name}
            </h3>
            {person.title ? (
              <p className="mt-1 text-[0.9375rem] text-ink-2">{person.title}</p>
            ) : null}
            {lead ? (
              <p className="mt-3">
                <span className="inline-flex h-7 items-center rounded-full bg-violet px-3 text-[0.8125rem] font-medium text-ink">
                  Program lead
                </span>
              </p>
            ) : null}
          </header>
          {facts.length ? (
            <dl className="grid grid-cols-2 gap-2">
              {facts.map((f) => (
                <div
                  key={f.term}
                  className={`rounded-[18px] bg-ivory-2 px-4 py-3 ${f.wide ? "col-span-2" : ""}`}
                >
                  <dt className="text-[0.8125rem] text-ink-2">{f.term}</dt>
                  <dd className="num mt-0.5 text-[1.375rem] leading-tight font-light tracking-[-0.01em] break-words">
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {person.certifications.length ||
          person.highlights.length ||
          person.bio ||
          person.specialties.length ||
          programs.length ? (
            <dl className="flex flex-col gap-5">
              {person.certifications.length ? (
                <Detail term="Certifications">
                  <ul className="flex flex-wrap gap-1.5">
                    {person.certifications.map((c) => (
                      <li
                        key={c}
                        className="inline-flex min-h-7 items-center rounded-full px-3 py-1 text-[0.8125rem] font-medium text-ink ring-[1.5px] ring-ink ring-inset"
                      >
                        {c}
                      </li>
                    ))}
                  </ul>
                </Detail>
              ) : null}
              {person.highlights.length ? (
                <Detail term="Highlights">
                  <ul className="flex flex-col gap-2.5">
                    {person.highlights.map((h) => (
                      <li key={h} className="flex items-start gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ivory-2">
                          <Medal aria-hidden className="size-4" />
                        </span>
                        <span className="pt-1 text-[0.9375rem]">{h}</span>
                      </li>
                    ))}
                  </ul>
                </Detail>
              ) : null}
              {person.bio ? (
                <Detail term="About">
                  <p className="max-w-[65ch] text-[0.9375rem] whitespace-pre-line">{person.bio}</p>
                </Detail>
              ) : null}
              {person.specialties.length ? (
                <Detail term="Specialties">
                  <ul className="flex flex-wrap gap-1.5">
                    {person.specialties.map((s) => (
                      <li
                        key={s}
                        className="inline-flex h-6 items-center rounded-full px-2.5 text-[0.75rem] font-medium text-ink-2 ring-1 ring-ivory-line"
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
                          className="inline-flex h-9 items-center rounded-full bg-ivory-2 px-3.5 text-[0.875rem] font-medium"
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
                            className={buttonClass("outline", "sm")}
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
 * Everyone else: on phones a sideways reel of tall portraits (the next one peeking), from `sm` a
 * compact grid; each opens their own space.
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
      className="rounded-[28px] bg-ivory py-5 ring-[1.5px] ring-ivory-line ring-inset sm:p-6"
    >
      <h2
        id="also-title"
        className="px-5 font-display text-[2rem] leading-tight tracking-[-0.01em] sm:px-0"
      >
        Also on the team
      </h2>
      <ul className="mt-4 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:grid sm:grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] sm:gap-y-5 sm:overflow-visible sm:px-0">
        {people.map((p) => (
          <li key={p.id} className="w-[85%] shrink-0 snap-start sm:w-auto">
            <Link
              to="/a/$slug/team"
              params={{ slug }}
              search={searchFor(EVERYONE, preview)}
              hash={`coach-${p.id}`}
              viewTransition
              className="group block rounded-[20px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <TeamPortrait person={p} size="reel" transition className="rounded-[20px]" />
              <span className="mt-2 block text-[0.9375rem] leading-tight font-medium underline-offset-4 group-hover:underline">
                {p.name}
              </span>
              {p.title ? (
                <span className="mt-0.5 block text-[0.8125rem] text-ink-2">{p.title}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * "Meet the team" (Persuade, phone-first): parents meet coaches through the program their child
 * will join. The dark block holds the academy, the programs (`?program=`, Everyone last), when the
 * chosen one meets (on desktop also where, and its next session), and Enroll; on Everyone, desktop
 * adds the academy's contact details. The canvas gives each of its coaches a space led by a
 * half-body portrait, then the rest of the team, and on phones closes on Enroll again.
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
      <div className="mx-auto max-w-[1100px] px-3 pt-4 sm:px-6 lg:grid lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-4 lg:pt-10 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <aside className="dark-zone flex flex-col gap-6 rounded-[32px] bg-night px-5 pt-7 pb-7 text-night-ink sm:px-6 lg:sticky lg:top-[100px] lg:max-h-[calc(100dvh-116px)] lg:self-start lg:overflow-y-auto lg:p-6">
          <h1 className="font-display text-[2.5rem] leading-[1.02] tracking-[-0.02em] lg:text-[3rem]">
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
            <div className="mt-auto hidden border-t border-night-line pt-5 lg:block">
              <Link
                to="/a/$slug/rates"
                params={{ slug }}
                search={searchFor(undefined, preview)}
                className={buttonClass("night", "md")}
              >
                <Printer aria-hidden className="size-4.5" />
                Printable rates
              </Link>
            </div>
          ) : null}
        </aside>

        <div className="flex min-w-0 flex-col gap-4 pt-8 lg:pt-0">
          {people.length ? (
            <section aria-labelledby="team-title" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-3 px-1">
                <h2
                  id="team-title"
                  className="scroll-mt-28 font-display text-[2.5rem] leading-[1.05] tracking-[-0.02em] lg:text-[3rem]"
                >
                  {program ? `${program.name} coaches` : "The whole team"}
                </h2>
                <p className="num text-[0.875rem] text-ink-2">
                  {view.kind === "program"
                    ? teamCountLine(view.team)
                    : `${people.length} ${people.length === 1 ? "person" : "people"}`}
                </p>
              </div>
              <ol className="flex flex-col gap-3">
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
              className="rounded-[28px] bg-ivory p-5 ring-[1.5px] ring-ivory-line ring-inset sm:p-6"
            >
              <div className="flex size-12 items-center justify-center rounded-full bg-lime text-ink">
                <UsersRound aria-hidden className="size-5" />
              </div>
              <h2
                id="team-title"
                className="mt-3 font-display text-[2rem] leading-tight tracking-[-0.01em]"
              >
                The team is on its way
              </h2>
              <p className="mt-2 max-w-[60ch] text-ink-2">
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
              className={buttonClass("dark", "lg", "w-full lg:hidden")}
            >
              Enroll in {program.name}
              <ArrowRight aria-hidden className="size-5" />
            </Link>
          ) : null}
        </div>
      </div>
      <div className="pt-20 sm:pt-28">
        <QuestionsBox academy={academy} />
      </div>
    </SiteFrame>
  );
}
