import { Link } from "@tanstack/react-router";
import { ArrowRight, Printer } from "lucide-react";
import { publicFileUrl } from "../../lib/api";
import type { Format } from "../../lib/format";
import { FIELD, Panel, PhotoSticker, pillClass, WRAP } from "./pubmat";
import type { PublicPage } from "./queries";
import { ContactPanel, canEnroll, previewSearch, SiteFrame, useCurrentInView } from "./site";
import { PackageEnroll, PackageGroups, ProgramPanel, programWhen, StepsPanel } from "./site-blocks";
import { fromPriceMinor, heroPhoto } from "./site-data";
import { tiersOf } from "./text";

/**
 * Enroll now (`/a/$slug/enroll`): the packages the academy published in the admin site, by
 * program (`?program=`), as price stickers that each open the enrollment wizard; then how
 * enrolling works, the consents families sign, the printable rates, and the ways to ask first.
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
  const open = canEnroll(academy);
  const photo = heroPhoto(academy);
  const src = photo ? publicFileUrl(photo.key) : null;
  const tabs = useCurrentInView<HTMLAnchorElement>(
    programs.length > 1 ? (program?.id ?? null) : null,
  );
  const title = !academy.packages.length
    ? "Packages drop soon"
    : open && programs.length > 1
      ? "Pick a program, then a package"
      : open
        ? "Enroll now"
        : "Packages and rates";
  return (
    <SiteFrame page={page} slug={slug} current="enroll">
      <section aria-labelledby="enroll-title" className={`relative overflow-hidden ${FIELD.green}`}>
        <div
          className={`${WRAP} relative z-[1] pt-12 pb-12 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:items-center lg:gap-x-16 lg:pt-20 lg:pb-20`}
        >
          <div>
            <h1
              id="enroll-title"
              className="pm-d1 max-w-[11ch] text-[4rem] text-white lg:max-w-[14ch] lg:text-[7.5rem]"
            >
              {title}
            </h1>
            <p className="mt-6 max-w-[38ch] text-[1.25rem] leading-snug font-bold text-white lg:text-[1.5rem] lg:font-semibold">
              {!academy.packages.length
                ? `${academy.name} hasn't published its packages here yet.`
                : academy.enrollmentOpen
                  ? `${academy.name} reviews every request, then confirms your spot and how to pay.`
                  : `${academy.name} isn't taking enrollment requests right now. Message them to ask when it opens.`}
            </p>
            {!academy.packages.length ? (
              <Link
                to="/a/$slug"
                params={{ slug }}
                search={search}
                className={pillClass("white", "mt-8")}
              >
                Back to {academy.name}
                <ArrowRight aria-hidden className="size-5" />
              </Link>
            ) : null}
          </div>
          {programs.length > 1 ? (
            // Desktop: the choice fills the band's right side, each tab with when it meets and
            // its price from; phones keep a sideways row of name tabs under the line.
            <nav aria-label="Programs" className="mt-8 lg:mt-0">
              <ul
                ref={tabs.list}
                className="relative -mx-5 flex gap-3 overflow-x-auto px-5 pt-2 pb-3 [scrollbar-width:none] lg:mx-0 lg:flex-col lg:gap-4 lg:overflow-visible lg:px-0"
              >
                {programs.map((p, i) => {
                  const on = p.id === program?.id;
                  const when = programWhen(p, fmt)[0];
                  const from = fromPriceMinor(academy.packages, p.id);
                  return (
                    <li key={p.id} className="shrink-0">
                      <Link
                        ref={on ? tabs.current : undefined}
                        to="/a/$slug/enroll"
                        params={{ slug }}
                        search={{ ...search, program: p.id }}
                        replace
                        resetScroll={false}
                        aria-current={on ? "true" : undefined}
                        style={{ rotate: `${i % 2 ? 1.5 : -1.5}deg` }}
                        className={`pm-d2 flex min-h-12 items-center gap-4 rounded-[14px] border-[3px] px-4 text-[1.25rem] font-black whitespace-nowrap outline-none focus-visible:outline-[3px] focus-visible:outline-offset-[3px] lg:min-h-[5.25rem] lg:justify-between lg:px-6 lg:text-[1.75rem] ${
                          on
                            ? "border-white bg-club-ball text-club-ink"
                            : "border-white text-white hover:bg-white hover:text-club-ink lg:bg-club-deep lg:hover:bg-white"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{p.name}</span>
                          {when ? (
                            <span className="num mt-1 hidden text-[1rem] font-semibold not-italic normal-case [font-stretch:100%] lg:block">
                              {when.days} · {when.time}
                            </span>
                          ) : null}
                        </span>
                        {from != null ? (
                          <span className="hidden shrink-0 flex-col items-end lg:flex">
                            <span className="text-[0.875rem] font-extrabold">From</span>
                            <span className="pm-d1 num text-[2.5rem]">{fmt.moneyShort(from)}</span>
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ) : src ? (
            <div className="hidden lg:flex lg:justify-end">
              <PhotoSticker
                src={src}
                rot={3}
                framing={photo?.framing}
                className="aspect-[0.82] w-full max-w-[380px]"
              />
            </div>
          ) : null}
        </div>
      </section>

      {program ? (
        <ProgramPanel
          academy={academy}
          program={program}
          field="blue"
          slug={slug}
          preview={preview}
          fmt={fmt}
          level={2}
          action={false}
          wide
        />
      ) : null}

      {academy.packages.length ? (
        <Panel field="lime" labelledBy="tiers-title">
          <div className={`${WRAP} py-14 lg:pt-20 lg:pb-24`}>
            <h2 id="tiers-title" className="sr-only">
              {program ? `${program.name} packages` : "Packages"}
            </h2>
            <PackageGroups
              academy={academy}
              programs={program ? [program] : []}
              fmt={fmt}
              level={3}
              enroll={
                // Families enroll from each card; staff previewing their site see the cards.
                page.kind === "public"
                  ? (t) => <PackageEnroll academy={academy} tier={t} />
                  : undefined
              }
            />
            <div className="mt-12 flex flex-col items-start gap-5">
              {academy.consents.length && academy.enrollmentOpen ? (
                <p className="max-w-[56ch] text-[1.0625rem] font-semibold">
                  When you enroll, you'll read and sign:{" "}
                  {academy.consents.map((c) => c.title).join(", ")}.
                </p>
              ) : null}
              <Link
                to="/a/$slug/rates"
                params={{ slug }}
                search={search}
                className={pillClass("outlineInk")}
              >
                <Printer aria-hidden className="size-5" />
                Printable rates
              </Link>
            </div>
          </div>
        </Panel>
      ) : null}

      <StepsPanel academy={academy} slug={slug} preview={preview} actions={false} />
      <ContactPanel academy={academy} />
    </SiteFrame>
  );
}
