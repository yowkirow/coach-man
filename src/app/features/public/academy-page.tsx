import type {
  PublicAcademyDto,
  PublicCoachDto,
  PublicPackageDto,
  PublicProgramDto,
} from "@shared/api-types";
import { ACADEMY_SOCIAL_LABELS, ACADEMY_SOCIALS } from "@shared/domain";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  CalendarClock,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Printer,
  SearchX,
  Ticket,
  UsersRound,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { BallMark } from "../../components/brand";
import { buttonClass, tapArea } from "../../components/ui/button";
import { publicFileUrl } from "../../lib/api";
import { type Format, initials } from "../../lib/format";
import { LegalLinks } from "../public-info/legal-links";
import { orderedWeekdays, weekdayName } from "../schedule/dates";
import type { PublicPage } from "./queries";
import {
  agesLabel,
  type ContactAction,
  contactActions,
  directionsUrl,
  scheduleLines,
  sessionLength,
  tiersOf,
  trainingDays,
} from "./text";
import { TierCard } from "./tier-card";

/**
 * Where WS4b plugs in enrolling: given a tier (and its program), return the Enroll control to
 * show on its card, or nothing. The page renders no enroll button of its own.
 */
export type RenderEnroll = (ctx: {
  academy: PublicAcademyDto;
  tier: PublicPackageDto;
  program: PublicProgramDto | null;
}) => ReactNode;

/** The academy's own logo on a white tile (never recolored), else its initials. */
export function AcademyLogo({
  name,
  logoKey,
  size = 64,
  onLight = false,
}: {
  name: string;
  logoKey: string | null;
  size?: 48 | 64 | 80;
  /** On a white surface (the rates sheet): a hairline keeps the white tile visible. */
  onLight?: boolean;
}) {
  const src = publicFileUrl(logoKey);
  const box = `${
    size === 80
      ? "size-20 rounded-[24px]"
      : size === 64
        ? "size-16 rounded-[22px]"
        : "size-12 rounded-[16px]"
  }${onLight ? " ring-1 ring-line-strong" : ""}`;
  const [first = "", second = ""] = name.trim().split(/\s+/);
  return src ? (
    <img
      src={src}
      alt={`${name} logo`}
      width={size}
      height={size}
      className={`${box} shrink-0 bg-card object-contain p-1.5`}
    />
  ) : (
    <span
      aria-hidden
      className={`${box} flex shrink-0 items-center justify-center bg-card text-[1.125rem] font-semibold text-ink`}
    >
      {initials({ firstName: first, lastName: second })}
    </span>
  );
}

const actionIcon: Record<ContactAction["id"], ReactNode> = {
  messenger: <MessageCircle aria-hidden className="size-4.5" />,
  text: <MessageCircle aria-hidden className="size-4.5" />,
  call: <Phone aria-hidden className="size-4.5" />,
  email: <Mail aria-hidden className="size-4.5" />,
};

/** The most direct way to reach the academy, and a call when it has a phone (else the next way). */
function contactPair(actions: ContactAction[]): ContactAction[] {
  const primary = actions[0];
  if (!primary) return [];
  const second = actions.find((a) => a.id === "call" && a !== primary) ?? actions[1];
  return second ? [primary, second] : [primary];
}

/**
 * The primary way to reach the academy (lime) and a second one (charcoal), on the dark block. With
 * `enroll` (phones only, while the academy takes enrollments) Enroll leads in lime and the contacts
 * turn charcoal, with shorter labels on phones so the three fit one row; from lg the contact leads.
 */
function ContactButtons({
  actions,
  enroll,
  className = "",
}: {
  actions: ContactAction[];
  enroll?: ReactNode;
  className?: string;
}) {
  const [primary, second] = contactPair(actions);
  if (!primary && !enroll) return null;
  const short = Boolean(enroll);
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {enroll ? <span className="contents lg:hidden">{enroll}</span> : null}
      {primary ? (
        <a
          href={primary.href}
          className={
            enroll
              ? buttonClass("night", "md", "lg:bg-lime lg:text-ink lg:hover:bg-lime-strong")
              : buttonClass("lime", "md")
          }
        >
          {actionIcon[primary.id]}
          {primary.id === "messenger" ? (
            short ? (
              <span>
                Message<span className="hidden lg:inline"> us</span>
              </span>
            ) : (
              "Message us"
            )
          ) : primary.id === "text" ? (
            short ? (
              <span>
                Text<span className="hidden lg:inline"> us</span>
              </span>
            ) : (
              "Text us"
            )
          ) : (
            primary.label
          )}
        </a>
      ) : null}
      {second ? (
        <a href={second.href} className={buttonClass("night", "md")}>
          {actionIcon[second.id]}
          {second.id === "call" ? "Call" : second.label}
        </a>
      ) : null}
    </div>
  );
}

/** Seven day tiles in the academy's week order; the days the program meets are lit. */
function WeekStrip({ days, fmt }: { days: number[]; fmt: Format }) {
  const on = new Set(days);
  const names = days.map((d) => weekdayName(d, fmt.locale, "long"));
  return (
    <div>
      <p className="sr-only">Meets every {names.join(" and ")}</p>
      <ol aria-hidden className="grid grid-cols-7 gap-1.5">
        {orderedWeekdays(fmt.weekStartsOn).map((d) => (
          <li
            key={d}
            className={`flex h-12 flex-col items-center justify-center rounded-[14px] text-[0.8125rem] font-medium ${
              on.has(d) ? "bg-lime text-ink" : "bg-night-2 text-night-ink-2"
            }`}
          >
            {weekdayName(d, fmt.locale, "short")}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The program pass: when and where it meets, who coaches, and when it next meets. */
function ProgramPass({ program, fmt }: { program: PublicProgramDto; fmt: Format }) {
  const days = trainingDays(program, fmt.weekStartsOn);
  const lines = scheduleLines(program, fmt);
  const venue = program.schedule.find((s) => s.venue)?.venue ?? program.venue;
  const ages = agesLabel(program.ageMin, program.ageMax);
  const length = program.schedule[0]?.durationMinutes;
  const chips = [program.level, ages, length ? sessionLength(length) : null].filter(
    (c): c is string => Boolean(c),
  );
  return (
    <section aria-labelledby="pass-title" className="flex flex-col gap-4">
      <div>
        <h2 id="pass-title" className="text-[1.375rem] leading-tight font-light tracking-[-0.01em]">
          {program.name}
        </h2>
        {chips.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Who it's for">
            {chips.map((c) => (
              <li
                key={c}
                className="inline-flex h-6 items-center rounded-full bg-night-3 px-2.5 text-[0.75rem] font-medium text-night-ink"
              >
                {c}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {days.length ? <WeekStrip days={days} fmt={fmt} /> : null}
      {lines.length ? (
        <div className="flex flex-col gap-1">
          {lines.map((l) => (
            <p key={l} className="num text-[1.75rem] leading-tight font-light tracking-[-0.01em]">
              {l}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-[0.9375rem] text-night-ink-2">
          Ask the academy for this program's days and times.
        </p>
      )}
      <dl className="flex flex-col gap-3 text-[0.9375rem]">
        {venue ? (
          <div className="flex items-start gap-3">
            <dt className="sr-only">Where</dt>
            <MapPin aria-hidden className="mt-0.5 size-4.5 shrink-0 text-night-ink-2" />
            <dd className="min-w-0">
              <span className="block">{venue.name}</span>
              {venue.address ? (
                <span className="block text-night-ink-2">{venue.address}</span>
              ) : null}
              <a
                href={directionsUrl(venue)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-full text-[0.875rem] font-medium text-night-ink underline underline-offset-4"
              >
                Directions
                <ArrowUpRight aria-hidden className="size-4" />
              </a>
            </dd>
          </div>
        ) : null}
        {program.nextSessionAt ? (
          <div className="flex items-start gap-3">
            <dt className="sr-only">Next session</dt>
            <CalendarClock aria-hidden className="mt-0.5 size-4.5 shrink-0 text-night-ink-2" />
            <dd className="num">
              Next session {fmt.day(fmt.dayOf(program.nextSessionAt))} ·{" "}
              {fmt.time(program.nextSessionAt)}
            </dd>
          </div>
        ) : null}
        {program.coaches.length ? (
          <div className="flex items-start gap-3">
            <dt className="sr-only">Coaches</dt>
            <UsersRound aria-hidden className="mt-0.5 size-4.5 shrink-0 text-night-ink-2" />
            <dd className="min-w-0">{program.coaches.map((c) => c.name).join(", ")}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

/** Programs as dark list tiles (the selected one lime), for academies with more than one. */
function ProgramPicker({
  programs,
  selected,
  slug,
  preview,
}: {
  programs: PublicProgramDto[];
  selected: string | null;
  slug: string;
  preview: boolean;
}) {
  if (programs.length < 2) return null;
  return (
    <nav aria-label="Programs">
      <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] lg:flex-col lg:overflow-visible">
        {programs.map((p) => {
          const on = p.id === selected;
          return (
            <li key={p.id} className="shrink-0">
              <Link
                to="/a/$slug"
                params={{ slug }}
                search={{ program: p.id, ...(preview ? { preview: 1 as const } : {}) }}
                replace
                resetScroll={false}
                aria-current={on ? "true" : undefined}
                className={`flex h-11 items-center rounded-full px-4 text-[0.9375rem] whitespace-nowrap outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime lg:h-12 lg:rounded-[24px] ${
                  on ? "bg-lime text-ink" : "bg-night-2 text-night-ink hover:bg-night-3"
                }`}
              >
                {p.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SectionCard({
  id,
  title,
  children,
  className = "",
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={`rounded-[28px] bg-card p-5 sm:p-6 ${className}`}>
      <h2 id={id} className="text-[1.375rem] leading-tight font-light tracking-[-0.01em]">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function CoachPhoto({ coach }: { coach: PublicCoachDto }) {
  const src = publicFileUrl(coach.photoKey);
  const [first = "", ...rest] = coach.name.split(/\s+/);
  if (src) {
    return (
      <img
        src={src}
        alt={coach.name}
        width={64}
        height={64}
        loading="lazy"
        className="size-16 shrink-0 rounded-full bg-panel object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-16 shrink-0 items-center justify-center rounded-full bg-lavender-soft text-[1.125rem] font-semibold text-ink"
    >
      {initials({ firstName: first, lastName: rest.join(" ") })}
    </span>
  );
}

function CoachCard({ coach }: { coach: PublicCoachDto }) {
  const facts = [
    coach.yearsCoaching ? `${coach.yearsCoaching} years coaching` : null,
    coach.duprRating ? `DUPR ${coach.duprRating.toFixed(2)}` : null,
    coach.languages.length ? coach.languages.join(", ") : null,
  ].filter(Boolean);
  return (
    <li className="flex items-start gap-4">
      <CoachPhoto coach={coach} />
      <div className="min-w-0 flex-1">
        <h3 className="text-[1.125rem] font-medium">{coach.name}</h3>
        {coach.title ? <p className="text-[0.875rem] text-ink-2">{coach.title}</p> : null}
        {coach.certifications.length || coach.specialties.length ? (
          <ul
            className="mt-2 flex flex-wrap gap-1.5"
            aria-label={`${coach.name}'s certifications and specialties`}
          >
            {coach.certifications.map((c) => (
              <li
                key={`c-${c}`}
                className="inline-flex h-6 items-center rounded-full bg-sky px-2.5 text-[0.75rem] font-medium text-ink"
              >
                {c}
              </li>
            ))}
            {coach.specialties.map((s) => (
              <li
                key={`s-${s}`}
                className="inline-flex h-6 items-center rounded-full ring-1 ring-line-strong px-2.5 text-[0.75rem] font-medium text-ink-2"
              >
                {s}
              </li>
            ))}
          </ul>
        ) : null}
        {coach.bio ? (
          <p className="mt-2 max-w-[65ch] text-[0.9375rem] whitespace-pre-line">{coach.bio}</p>
        ) : null}
        {facts.length ? (
          <p className="num mt-1.5 text-[0.8125rem] text-ink-2">{facts.join(" · ")}</p>
        ) : null}
      </div>
    </li>
  );
}

const linkCls = `${tapArea} rounded-sm font-medium underline decoration-line-strong underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink`;

function ContactCard({ academy }: { academy: PublicAcademyDto }) {
  const socials = ACADEMY_SOCIALS.filter((k) => academy.socials[k]);
  const phone = academy.contactPhone;
  const hasAny = phone || academy.contactEmail || academy.address || socials.length;
  if (!hasAny) return null;
  return (
    <SectionCard id="contact-title" title="Contact">
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {phone ? (
          <div className="flex flex-col gap-0.5">
            <dt className="text-[0.8125rem] text-ink-2">Phone</dt>
            <dd className="flex flex-wrap gap-x-3">
              <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className={`${linkCls} num`}>
                {phone}
              </a>
              <a href={`sms:${phone.replace(/[^\d+]/g, "")}`} className={linkCls}>
                Send a text
              </a>
            </dd>
          </div>
        ) : null}
        {academy.contactEmail ? (
          <div className="flex flex-col gap-0.5">
            <dt className="text-[0.8125rem] text-ink-2">Email</dt>
            <dd>
              <a href={`mailto:${academy.contactEmail}`} className={`${linkCls} break-all`}>
                {academy.contactEmail}
              </a>
            </dd>
          </div>
        ) : null}
        {academy.address ? (
          <div className="flex flex-col gap-0.5 sm:col-span-2">
            <dt className="text-[0.8125rem] text-ink-2">Address</dt>
            <dd className="flex flex-col items-start gap-1">
              <span>{academy.address}</span>
              {academy.mapUrl ? (
                <a
                  href={academy.mapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${linkCls} inline-flex items-center gap-1`}
                >
                  Open the map
                  <ArrowUpRight aria-hidden className="size-4" />
                </a>
              ) : null}
            </dd>
          </div>
        ) : null}
        {socials.length ? (
          <div className="flex flex-col gap-1 sm:col-span-2">
            <dt className="text-[0.8125rem] text-ink-2">Follow</dt>
            <dd>
              <ul className="flex flex-wrap gap-2">
                {socials.map((k) => (
                  <li key={k}>
                    <a
                      href={academy.socials[k]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonClass("light", "sm")}
                    >
                      {ACADEMY_SOCIAL_LABELS[k]}
                      <ArrowUpRight aria-hidden className="size-4" />
                    </a>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
      </dl>
    </SectionCard>
  );
}

/** The tiers of the program on show (and the packages in no program), as cards. */
function Rates({
  academy,
  program,
  fmt,
  renderEnroll,
}: {
  academy: PublicAcademyDto;
  program: PublicProgramDto | null;
  fmt: Format;
  renderEnroll?: RenderEnroll;
}) {
  const tiers = program ? tiersOf(academy.packages, program.id) : [];
  const others = tiersOf(academy.packages, null);
  const card = (t: PublicPackageDto, p: PublicProgramDto | null) => (
    <TierCard
      key={t.id}
      tier={t}
      fmt={fmt}
      enroll={renderEnroll?.({ academy, tier: t, program: p })}
    />
  );
  return (
    <>
      {program ? (
        <section aria-labelledby="rates-title" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-2 px-1">
            <h2
              id="rates-title"
              className="scroll-mt-4 text-[2rem] leading-tight font-light tracking-[-0.02em] lg:text-[2.5rem]"
            >
              Rates
            </h2>
            <p className="text-[0.875rem] text-ink-2">{program.name} · prices per head</p>
          </div>
          {tiers.length ? (
            <div className="grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(17rem,1fr))]">
              {tiers.map((t) => card(t, program))}
            </div>
          ) : (
            <p className="rounded-[22px] bg-panel px-4 py-3 text-[0.9375rem] text-ink-2">
              Rates for {program.name} aren't published yet. Message the academy to ask.
            </p>
          )}
        </section>
      ) : null}
      {others.length ? (
        // Without a program this is the page's Rates (what "Skip to rates" and Enroll lead to).
        <section
          aria-labelledby={program ? "packages-title" : "rates-title"}
          className="flex flex-col gap-3"
        >
          <h2
            id={program ? "packages-title" : "rates-title"}
            className="scroll-mt-4 px-1 text-[2rem] leading-tight font-light tracking-[-0.02em] lg:text-[2.5rem]"
          >
            {program ? "Other packages" : "Rates"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(17rem,1fr))]">
            {others.map((t) => card(t, null))}
          </div>
        </section>
      ) : null}
    </>
  );
}

/** Shown to staff looking at their own page through Settings (never to families). */
export function PreviewBanner({
  listed,
  publicUrl,
}: {
  listed: boolean;
  publicUrl: string | null;
}) {
  return (
    <div
      role="note"
      className="mb-3 rounded-[22px] bg-amber-soft px-4 py-3 text-[0.875rem] text-ink lg:mb-0"
    >
      <p className="font-medium">Preview of your academy page</p>
      <p className="mt-0.5 text-ink/80">
        {listed && publicUrl
          ? `Families see this page at ${publicUrl}. It shows only published programs and tiers.`
          : "Only your team can see this. Turn on “Show the academy page” in Settings, Academy profile, to share it."}{" "}
        <Link
          to="/settings"
          hash="academy-profile"
          className="font-medium underline underline-offset-4"
        >
          Academy profile
        </Link>
      </p>
    </div>
  );
}

export function NotFoundPage({
  title = "This academy page isn't available",
  children = "The address may be mistyped, or the academy hasn't published its page. Ask the academy for its link.",
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-md rounded-[32px] bg-card p-6 sm:p-8">
        <div className="flex size-12 items-center justify-center rounded-full bg-lime text-ink">
          <SearchX aria-hidden className="size-5" />
        </div>
        <h1 className="mt-4 text-[2rem] leading-tight font-light tracking-[-0.02em]">{title}</h1>
        <p className="mt-3 text-ink-2">{children}</p>
        <p className="mt-6 inline-flex items-center gap-2 text-[0.8125rem] text-ink-2">
          <BallMark className="size-5" holes="#111111" />
          CoachMan
        </p>
      </div>
    </main>
  );
}

/**
 * The public academy page (Persuade, phone-first): the academy's own name, logo, and words; the
 * program on show as a pass (days, times, venue, coaches, next session) on the dark block; its
 * tiers as cards; then about, coaches, contact, and policies. One program at a time when there
 * are several (`?program=`).
 */
export function AcademyPage({
  page,
  slug,
  programId,
  fmt,
  renderEnroll,
  enroll,
}: {
  page: PublicPage;
  slug: string;
  programId?: string;
  fmt: Format;
  /** WS4b: the Enroll control for a tier card (the page has none of its own). */
  renderEnroll?: RenderEnroll;
  /** The dark block's first action on phones while enrollment is open (down to the rates). */
  enroll?: ReactNode;
}) {
  const academy = page.academy;
  const preview = page.kind === "preview";
  const program = academy.programs.find((p) => p.id === programId) ?? academy.programs[0] ?? null;
  const actions = contactActions(academy);
  const nothing = !academy.programs.length && !academy.packages.length;
  // The phone's contact bar joins once the block's own buttons have scrolled away, so the first
  // screen has one set of actions and the rates start at the fold.
  const contactRef = useRef<HTMLDivElement>(null);
  const [barShown, setBarShown] = useState(false);
  useEffect(() => {
    const el = contactRef.current;
    if (!el || !actions.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry) setBarShown(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [actions.length]);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-3 lg:p-3 xl:grid-cols-[440px_minmax(0,1fr)]">
      <a
        href="#rates-title"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-70 focus:rounded-full focus:bg-lime focus:px-5 focus:py-2.5 focus:font-semibold focus:text-ink"
      >
        Skip to rates
      </a>
      <aside className="dark-zone flex flex-col gap-6 rounded-b-[32px] bg-night px-4 pt-[calc(env(safe-area-inset-top)+20px)] pb-7 text-night-ink sm:px-6 lg:sticky lg:top-3 lg:max-h-[calc(100dvh-24px)] lg:overflow-y-auto lg:rounded-[32px] lg:p-6">
        <header className="flex flex-col gap-4">
          <AcademyLogo name={academy.name} logoKey={academy.logoKey} size={64} />
          <div>
            <h1 className="text-[2rem] leading-[1.08] font-light tracking-[-0.02em] break-words lg:text-[2.5rem]">
              {academy.name}
            </h1>
            {academy.tagline ? (
              <p className="mt-2 text-[1rem] text-night-ink-2">{academy.tagline}</p>
            ) : null}
          </div>
        </header>
        <ProgramPicker
          programs={academy.programs}
          selected={program?.id ?? null}
          slug={slug}
          preview={preview}
        />
        {program ? <ProgramPass key={program.id} program={program} fmt={fmt} /> : null}
        {actions.length || enroll ? (
          <div ref={contactRef}>
            <ContactButtons actions={actions} enroll={enroll} />
          </div>
        ) : null}
        {academy.packages.length ? (
          <div className="mt-auto hidden border-t border-night-line pt-5 lg:block">
            <Link
              to="/a/$slug/rates"
              params={{ slug }}
              search={preview ? { preview: 1 } : {}}
              className={buttonClass("night", "md")}
            >
              <Printer aria-hidden className="size-4.5" />
              Printable rates
            </Link>
          </div>
        ) : null}
      </aside>

      <main
        id="main"
        className={`flex min-w-0 flex-col gap-4 px-3 pt-4 sm:px-6 lg:px-1 lg:pt-1 ${actions.length ? "pb-[calc(104px+env(safe-area-inset-bottom))] lg:pb-6" : "pb-8"}`}
      >
        {preview ? (
          <PreviewBanner listed={page.academy.listed} publicUrl={page.academy.publicUrl} />
        ) : null}
        {nothing ? (
          <section aria-labelledby="rates-title" className="rounded-[28px] bg-card p-5 sm:p-6">
            <div className="flex size-12 items-center justify-center rounded-full bg-lime text-ink">
              <Ticket aria-hidden className="size-5" />
            </div>
            <h2 id="rates-title" className="mt-3 text-[1.375rem] leading-tight font-light">
              Programs and rates are on their way
            </h2>
            <p className="mt-2 max-w-[60ch] text-ink-2">
              {academy.name} hasn't published its programs and rates here yet.
              {actions.length ? " Message or call them to ask." : ""}
            </p>
          </section>
        ) : (
          <Rates academy={academy} program={program} fmt={fmt} renderEnroll={renderEnroll} />
        )}

        {academy.about || program?.description ? (
          <SectionCard id="about-title" title={`About ${academy.name}`}>
            <div className="flex max-w-[65ch] flex-col gap-3 text-[0.9375rem]">
              {program?.description ? (
                <p className="whitespace-pre-line">
                  <span className="font-medium">{program.name}: </span>
                  {program.description}
                </p>
              ) : null}
              {academy.about ? <p className="whitespace-pre-line">{academy.about}</p> : null}
            </div>
          </SectionCard>
        ) : null}

        {academy.coaches.length ? (
          <SectionCard id="coaches-title" title="Coaches">
            <ul className="flex flex-col gap-6">
              {academy.coaches.map((c) => (
                <CoachCard key={c.id} coach={c} />
              ))}
            </ul>
          </SectionCard>
        ) : null}

        <ContactCard academy={academy} />

        {academy.policies ? (
          <SectionCard id="policies-title" title="Policies">
            <p className="max-w-[65ch] text-[0.9375rem] whitespace-pre-line">{academy.policies}</p>
          </SectionCard>
        ) : null}

        <footer className="flex flex-wrap items-center justify-between gap-3 px-1 pt-2">
          {academy.packages.length ? (
            <Link
              to="/a/$slug/rates"
              params={{ slug }}
              search={preview ? { preview: 1 } : {}}
              className={buttonClass("light", "md")}
            >
              <Printer aria-hidden className="size-4.5" />
              View printable rates
            </Link>
          ) : (
            <span />
          )}
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Link
              to="/about"
              className="inline-flex items-center gap-2 rounded-full text-[0.8125rem] text-ink-2 outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <BallMark className="size-5" holes="#111111" />
              Made with CoachMan
            </Link>
            <LegalLinks about={false} label="CoachMan policies" />
          </div>
        </footer>
      </main>

      {actions.length ? (
        <nav
          aria-label={`Contact ${academy.name}`}
          inert={!barShown}
          className={`dark-zone fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 rounded-full bg-night p-1.5 shadow-pop transition-[translate,opacity] duration-200 ease-out lg:hidden ${
            barShown ? "" : "pointer-events-none translate-y-[calc(100%+24px)] opacity-0"
          }`}
        >
          <ul className="flex gap-1.5">
            {contactPair(actions).map((a, i) => (
              <li key={a.id} className="min-w-0 flex-1">
                <a
                  href={a.href}
                  className={`flex h-12 w-full items-center justify-center gap-2 rounded-full text-[0.9375rem] font-medium outline-none focus-visible:outline-2 focus-visible:outline-lime ${
                    i === 0 ? "bg-lime text-ink" : "bg-night-3 text-night-ink"
                  }`}
                >
                  {actionIcon[a.id]}
                  {a.id === "messenger"
                    ? "Message"
                    : a.id === "text"
                      ? "Text"
                      : a.id === "call"
                        ? "Call"
                        : "Email"}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
