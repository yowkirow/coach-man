import type { PublicProgramDto } from "@shared/api-types";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Printer } from "lucide-react";
import { buttonClass } from "../../components/ui/button";
import type { Format } from "../../lib/format";
import { EnrollSlot } from "../enrollment/enroll-slot";
import { TeamFace } from "./people";
import { ProgramPlaceRows } from "./public-ui";
import type { PublicPage } from "./queries";
import {
  canEnroll,
  previewSearch,
  QuestionsBox,
  ScheduleText,
  SiteFrame,
  useCurrentInView,
} from "./site";
import { headlineParts } from "./site-data";
import { programTeams } from "./team";
import { agesLabel, scheduleLines, sessionLength, tiersOf } from "./text";
import { TierCard } from "./tier-card";

const display = "font-display tracking-[-0.02em]";

/** The chosen program on a black card: who it's for, when and where, and who coaches it. */
function ProgramCard({
  academy,
  program,
  slug,
  preview,
  fmt,
}: {
  academy: PublicPage["academy"];
  program: PublicProgramDto;
  slug: string;
  preview: boolean;
  fmt: Format;
}) {
  const lines = scheduleLines(program, fmt);
  const length = program.schedule[0]?.durationMinutes;
  const chips = [
    program.level,
    agesLabel(program.ageMin, program.ageMax),
    length ? sessionLength(length) : null,
  ].filter((c): c is string => Boolean(c));
  const people = programTeams({ programs: [program], coaches: academy.coaches })[0]?.people ?? [];
  return (
    <section
      aria-labelledby="program-title"
      className="dark-zone grid gap-8 rounded-[32px] bg-night p-6 text-white sm:p-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] lg:gap-12"
    >
      <div className="min-w-0">
        <h2
          id="program-title"
          className={`${display} text-[2rem] leading-tight break-words sm:text-[2.5rem]`}
        >
          {program.name}
        </h2>
        {chips.length ? (
          <ul aria-label="Who it's for" className="mt-3 flex flex-wrap gap-1.5">
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
          <p className="mt-5 max-w-[52ch] text-[1rem] whitespace-pre-line text-night-ink-2">
            {program.description}
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        {lines.length ? (
          <div className="flex flex-col gap-1">
            {lines.map((l) => (
              <p
                key={l}
                className="num text-[1.5rem] leading-tight font-light tracking-[-0.01em] sm:text-[1.75rem]"
              >
                <ScheduleText line={l} />
              </p>
            ))}
          </div>
        ) : null}
        <dl className="flex flex-col gap-3 text-[0.9375rem]">
          <ProgramPlaceRows program={program} fmt={fmt} />
        </dl>
        {people.length ? (
          <Link
            to="/a/$slug/team"
            params={{ slug }}
            search={{ ...previewSearch(preview), program: program.id }}
            className="group flex items-center gap-3 self-start rounded-full py-1 pr-3 outline-none focus-visible:outline-2 focus-visible:outline-lime"
          >
            <span aria-hidden className="flex">
              {people.slice(0, 4).map((p, i) => (
                <TeamFace
                  key={p.id}
                  person={p}
                  className={`ring-2 ring-night ${i ? "-ml-2" : ""}`}
                />
              ))}
            </span>
            <span className="text-[0.9375rem] underline decoration-night-ink-2 underline-offset-4 group-hover:decoration-white">
              Coached by {people.map((p) => p.name).join(", ")}
            </span>
          </Link>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Enroll now (`/a/$slug/enroll`): the packages the academy published in the admin site, by
 * program (`?program=`), each card opening the enrollment wizard; then the consents families
 * sign, the printable rates, and the ways to ask first.
 */
export function EnrollNowPage({
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
  const search = previewSearch(preview);
  const programs = academy.programs.filter((p) => tiersOf(academy.packages, p.id).length);
  const program = programs.find((p) => p.id === programId) ?? programs[0] ?? null;
  const tiers = program ? tiersOf(academy.packages, program.id) : [];
  const others = tiersOf(academy.packages, null);
  const open = canEnroll(academy);
  const pills = useCurrentInView<HTMLAnchorElement>(
    programs.length > 1 ? (program?.id ?? null) : null,
  );
  const { quiet, strong } = headlineParts(
    !academy.packages.length
      ? "Packages are on their way"
      : open && programs.length > 1
        ? "Pick a program, then a package"
        : open
          ? "Enroll now, in a few steps"
          : "Packages and rates",
  );
  // Families enroll from each card; staff previewing their site see the cards as they are.
  const slot = (tier: (typeof tiers)[number]) =>
    page.kind === "public" ? <EnrollSlot academy={academy} tier={tier} /> : undefined;
  return (
    <SiteFrame page={page} slug={slug} current="enroll">
      <section
        aria-labelledby="enroll-title"
        className="mx-auto max-w-[1100px] px-4 pt-14 pb-10 text-center sm:px-6 sm:pt-20 sm:pb-14"
      >
        <h1
          id="enroll-title"
          className={`${display} text-[2.75rem] leading-[1.02] sm:text-[4.5rem]`}
        >
          {quiet ? <span className="text-ink-3">{quiet} </span> : null}
          {strong}
        </h1>
        <p className="mx-auto mt-6 max-w-[40rem] text-[1rem] text-balance sm:text-[1.125rem]">
          {!academy.packages.length
            ? `${academy.name} hasn't published its packages here yet. Message them to ask.`
            : academy.enrollmentOpen
              ? `${academy.name} reviews every request, then confirms your spot and how to pay.`
              : `${academy.name} isn't taking enrollment requests right now. Message them to ask when it opens.`}
        </p>
        {programs.length > 1 ? (
          <nav aria-label="Programs" className="mt-9">
            <ul
              ref={pills.list}
              className="relative -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0"
            >
              {programs.map((p) => {
                const on = p.id === program?.id;
                return (
                  <li key={p.id} className="shrink-0">
                    <Link
                      ref={on ? pills.current : undefined}
                      to="/a/$slug/enroll"
                      params={{ slug }}
                      search={{ ...search, program: p.id }}
                      replace
                      resetScroll={false}
                      aria-current={on ? "true" : undefined}
                      className={`flex h-11 items-center rounded-full px-4.5 text-[0.9375rem] font-medium whitespace-nowrap ring-[1.5px] outline-none ring-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                        on ? "bg-lime text-ink ring-lime" : "text-ink ring-ink hover:bg-ink/6"
                      }`}
                    >
                      {p.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}
      </section>

      <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-3 sm:px-6">
        {program ? (
          <>
            <ProgramCard
              academy={academy}
              program={program}
              slug={slug}
              preview={preview}
              fmt={fmt}
            />
            <section aria-labelledby="tiers-title">
              <h2 id="tiers-title" className="sr-only">
                {program.name} packages
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {tiers.map((t) => (
                  <TierCard key={t.id} tier={t} fmt={fmt} surface="ivory" enroll={slot(t)} />
                ))}
              </div>
            </section>
          </>
        ) : null}

        {others.length ? (
          <section aria-labelledby="others-title" className="mt-10 flex flex-col gap-4">
            <h2
              id="others-title"
              className={`${display} px-1 text-[2rem] leading-tight sm:text-[2.5rem]`}
            >
              {program ? "More packages" : "Packages"}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {others.map((t) => (
                <TierCard key={t.id} tier={t} fmt={fmt} surface="ivory" enroll={slot(t)} />
              ))}
            </div>
          </section>
        ) : null}

        {academy.packages.length ? (
          <div className="mt-8 flex flex-col items-center gap-4 text-center">
            {academy.consents.length && academy.enrollmentOpen ? (
              <p className="max-w-[56ch] text-[0.9375rem] text-ink-2">
                When you enroll, you'll read and sign:{" "}
                {academy.consents.map((c) => c.title).join(", ")}.
              </p>
            ) : null}
            <Link
              to="/a/$slug/rates"
              params={{ slug }}
              search={search}
              className={buttonClass("outline", "md")}
            >
              <Printer aria-hidden className="size-4.5" />
              Printable rates
            </Link>
          </div>
        ) : (
          <div className="flex justify-center">
            <Link
              to="/a/$slug"
              params={{ slug }}
              search={search}
              className={buttonClass("outline", "md")}
            >
              Back to {academy.name}
              <ArrowRight aria-hidden className="size-4.5" />
            </Link>
          </div>
        )}
      </div>

      <div className="pt-20 sm:pt-28">
        <QuestionsBox academy={academy} />
      </div>
    </SiteFrame>
  );
}
