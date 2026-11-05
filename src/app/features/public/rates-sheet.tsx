import type { PublicAcademyDto, PublicPackageDto, PublicProgramDto } from "@shared/api-types";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Printer } from "lucide-react";
import { Button, buttonClass } from "../../components/ui/button";
import type { Format } from "../../lib/format";
import { AcademyLogo, PreviewBanner } from "./academy-page";
import type { PublicPage } from "./queries";
import {
  agesLabel,
  MONTH_END_NOTE,
  scheduleLines,
  sessionLength,
  sessionsLabel,
  tiersOf,
} from "./text";
import { UNIFORM_WORDS } from "./tier-card";

function TierSection({
  tier,
  program,
  fmt,
}: {
  tier: PublicPackageDto;
  program: PublicProgramDto | null;
  fmt: Format;
}) {
  const id = `sheet-tier-${tier.id}`;
  const schedule = program ? scheduleLines(program, fmt) : [];
  const length = program?.schedule[0]?.durationMinutes;
  const notes = [
    tier.audience ? `For: ${tier.audience}` : null,
    tier.commitmentNote,
    tier.includesUniform && !tier.inclusions.some((i) => UNIFORM_WORDS.test(i))
      ? "Includes the official training uniform."
      : null,
    tier.asksSelfRating ? "Open to every level: enrolling asks for your self-rating." : null,
    tier.coach ? `With ${tier.coach.name}.` : null,
  ].filter((n): n is string => Boolean(n));
  return (
    <section
      aria-labelledby={id}
      className="rates-tier break-inside-avoid border-t border-line py-6 first:border-t-0"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 id={id} className="text-[1.375rem] leading-tight font-light tracking-[-0.01em]">
          {tier.name}
          {tier.highlight ? (
            <span className="ml-2 align-middle text-[0.75rem] font-medium text-ink-2">
              · Featured
            </span>
          ) : null}
        </h3>
        <p className="num">
          <span className="text-[1.75rem] leading-none font-light tracking-[-0.02em]">
            {fmt.moneyShort(tier.priceMinor)}
          </span>{" "}
          <span className="text-[0.875rem] text-ink-2">per head</span>
        </p>
      </div>
      <dl className="mt-4 grid gap-x-8 gap-y-3 text-[0.9375rem] sm:grid-cols-[11rem_minmax(0,1fr)]">
        <dt className="text-[0.8125rem] font-medium text-ink-2">Rates and schedule</dt>
        <dd className="num">
          {fmt.moneyShort(tier.priceMinor)} per head · {sessionsLabel(tier)}
          {length ? ` · ${sessionLength(length)}` : ""}
          {schedule.length ? <span className="block">{schedule.join(" · ")}</span> : null}
        </dd>
        <dt className="text-[0.8125rem] font-medium text-ink-2">Validity</dt>
        <dd>
          {tier.validityMode === "month_end"
            ? MONTH_END_NOTE
            : tier.validityDays
              ? `Valid for ${tier.validityDays} days from the start date.`
              : "No expiry."}
        </dd>
        {tier.inclusions.length ? (
          <>
            <dt className="text-[0.8125rem] font-medium text-ink-2">Inclusions</dt>
            <dd>
              <ul className="flex flex-col gap-1.5">
                {tier.inclusions.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2.75} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        ) : null}
        {notes.length ? (
          <>
            <dt className="text-[0.8125rem] font-medium text-ink-2">Notes</dt>
            <dd className="flex flex-col gap-1">
              {notes.map((n) => (
                <p key={n}>{n}</p>
              ))}
            </dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}

function ProgramBlock({
  academy,
  program,
  fmt,
}: {
  academy: PublicAcademyDto;
  program: PublicProgramDto;
  fmt: Format;
}) {
  const tiers = tiersOf(academy.packages, program.id);
  if (!tiers.length) return null;
  const venue = program.schedule.find((s) => s.venue)?.venue ?? program.venue;
  const meta = [
    ...scheduleLines(program, fmt),
    venue ? [venue.name, venue.address].filter(Boolean).join(", ") : null,
    program.level,
    agesLabel(program.ageMin, program.ageMax),
  ].filter(Boolean);
  const id = `sheet-program-${program.id}`;
  return (
    <section aria-labelledby={id} className="rates-program mt-8 first:mt-0">
      <div className="break-after-avoid rounded-[22px] bg-panel px-5 py-4 print:rounded-none print:bg-transparent print:px-0">
        <h2 id={id} className="text-[1.75rem] leading-tight font-light tracking-[-0.01em]">
          {program.name}
        </h2>
        {meta.length ? (
          <p className="num mt-1 text-[0.9375rem] text-ink-2">{meta.join(" · ")}</p>
        ) : null}
      </div>
      <div className="px-1">
        {tiers.map((t) => (
          <TierSection key={t.id} tier={t} program={program} fmt={fmt} />
        ))}
      </div>
    </section>
  );
}

/**
 * The printable rates sheet, generated from the live catalog: a formal rate document with the
 * academy's letterhead, then each program's tiers with their rates and schedule, validity,
 * inclusions, and notes. "Print or save as PDF" uses the browser's own print dialog; the print
 * styles drop the toolbar and keep each tier on one page.
 */
export function RatesSheet({ page, slug, fmt }: { page: PublicPage; slug: string; fmt: Format }) {
  const academy = page.academy;
  const preview = page.kind === "preview";
  const others = tiersOf(academy.packages, null);
  const contact = [academy.contactPhone, academy.contactEmail, academy.address].filter(Boolean);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <div className="min-h-dvh px-3 py-4 sm:px-6 sm:py-6 print:p-0">
      <div className="mx-auto flex max-w-[880px] flex-col gap-3 print:max-w-none">
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <Link
            to="/a/$slug"
            params={{ slug }}
            search={preview ? { preview: 1 } : {}}
            className={buttonClass("light", "md", "max-w-full min-w-0")}
          >
            <ArrowLeft aria-hidden className="size-4.5 shrink-0" />
            <span className="min-w-0 truncate">{academy.name}</span>
          </Link>
          <Button
            variant="dark"
            icon={<Printer aria-hidden className="size-4.5" />}
            onPress={() => window.print()}
          >
            Print or save as PDF
          </Button>
        </div>
        {preview ? (
          <div className="print:hidden">
            <PreviewBanner listed={page.academy.listed} publicUrl={page.academy.publicUrl} />
          </div>
        ) : null}

        <article
          aria-labelledby="sheet-title"
          className="rates-sheet rounded-[28px] bg-card p-6 sm:p-10 print:rounded-none print:p-0"
        >
          <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-6">
            <div className="flex min-w-0 items-center gap-4">
              <AcademyLogo name={academy.name} logoKey={academy.logoKey} size={64} onLight />
              <div className="min-w-0">
                <p className="text-[1.375rem] leading-tight font-light tracking-[-0.01em] break-words">
                  {academy.name}
                </p>
                {academy.tagline ? (
                  <p className="mt-1 text-[0.9375rem] text-ink-2">{academy.tagline}</p>
                ) : null}
              </div>
            </div>
            {contact.length ? (
              <address className="text-[0.8125rem] text-ink-2 not-italic sm:text-right">
                {contact.map((c) => (
                  <span key={c} className="num block">
                    {c}
                  </span>
                ))}
              </address>
            ) : null}
          </header>

          <div className="py-6">
            <h1
              id="sheet-title"
              className="text-[2.5rem] leading-[1.1] font-light tracking-[-0.02em]"
            >
              Rates and packages
            </h1>
            <p className="mt-2 text-[0.9375rem] text-ink-2">
              As of {fmt.month(academy.today.slice(0, 7))} · Prices per head in {academy.currency}
            </p>
          </div>

          {academy.packages.length ? (
            <>
              {academy.programs.map((p) => (
                <ProgramBlock key={p.id} academy={academy} program={p} fmt={fmt} />
              ))}
              {others.length ? (
                <section aria-labelledby="sheet-others" className="rates-program mt-8">
                  <div className="rounded-[22px] bg-panel px-5 py-4 print:rounded-none print:bg-transparent print:px-0">
                    <h2
                      id="sheet-others"
                      className="text-[1.75rem] leading-tight font-light tracking-[-0.01em]"
                    >
                      {academy.programs.length ? "Other packages" : "Packages"}
                    </h2>
                  </div>
                  <div className="px-1">
                    {others.map((t) => (
                      <TierSection key={t.id} tier={t} program={null} fmt={fmt} />
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : (
            <p className="text-ink-2">No rates are published yet.</p>
          )}

          <footer className="mt-8 border-t border-line pt-4 text-[0.8125rem] text-ink-2">
            Generated from {academy.name}'s live catalog on {fmt.date(academy.today)}.
            {origin ? (
              <span className="block break-all">
                {origin}/a/{academy.slug}
              </span>
            ) : null}
          </footer>
        </article>
      </div>
    </div>
  );
}
