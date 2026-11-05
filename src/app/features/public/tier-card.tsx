import type { PublicPackageDto } from "@shared/api-types";
import { CalendarRange, Check, Shirt, Star } from "lucide-react";
import type { ReactNode } from "react";
import type { Format } from "../../lib/format";
import { MONTH_END_ADVICE, sessionsLabel, validityLine } from "./text";

/** Inclusions that already name the uniform (so it isn't listed twice). */
export const UNIFORM_WORDS = /uniform|shirt|jersey/i;

/**
 * One package tier as families see it, on the public page and in the staff editor's preview:
 * price per head, sessions, validity, what's included, who it's for. The tier the academy
 * features is the lime card. `enroll` is where WS4b puts the Enroll button.
 */
export function TierCard({
  tier,
  fmt,
  headingLevel = 3,
  enroll,
  surface = "card",
  className = "",
}: {
  tier: PublicPackageDto;
  fmt: Format;
  headingLevel?: 2 | 3 | 4;
  enroll?: ReactNode;
  /** The card's own tone when it isn't the featured tier: white, or panel grey on white. */
  surface?: "card" | "panel";
  className?: string;
}) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  const featured = tier.highlight;
  const headingId = `tier-${tier.id}`;
  const quiet = featured ? "text-ink/75" : "text-ink-2";
  const inclusions = [...tier.inclusions];
  if (tier.includesUniform && !inclusions.some((i) => UNIFORM_WORDS.test(i))) {
    inclusions.push("Training uniform included");
  }
  return (
    <article
      aria-labelledby={headingId}
      className={`flex flex-col rounded-[28px] p-5 sm:p-6 ${featured ? "bg-lime" : surface === "panel" ? "bg-panel" : "bg-card"} ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <Heading
          id={headingId}
          className="min-w-0 text-[1.375rem] leading-tight font-light tracking-[-0.01em] break-words"
        >
          {tier.name}
        </Heading>
        {featured ? (
          <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-card px-2.5 text-[0.75rem] font-medium text-ink">
            <Star aria-hidden className="size-3" strokeWidth={2.25} />
            Featured
          </span>
        ) : null}
      </div>
      <p className={`num mt-1 text-[0.875rem] ${quiet}`}>
        {sessionsLabel(tier)}
        {tier.coach ? ` · with ${tier.coach.name}` : ""}
      </p>

      {/* Coaches see tiers without prices (the staff API leaves money out for them). */}
      {typeof tier.priceMinor === "number" ? (
        <p className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="num text-[2.75rem] leading-none font-light tracking-[-0.03em]">
            {fmt.moneyShort(tier.priceMinor)}
          </span>
          <span className={`text-[0.9375rem] ${quiet}`}>per head</span>
        </p>
      ) : null}
      <p className="mt-3 text-[0.875rem] font-medium">
        {validityLine(tier)}
        {tier.validityMode === "month_end" ? (
          <span className={`block font-normal ${quiet}`}>{MONTH_END_ADVICE}</span>
        ) : null}
      </p>

      {inclusions.length ? (
        <ul aria-label={`Included in ${tier.name}`} className="mt-5 flex flex-col gap-2.5">
          {inclusions.map((item) => (
            <li key={item} className="flex items-start gap-3 text-[0.9375rem]">
              <span
                aria-hidden
                className={`mt-px flex size-5.5 shrink-0 items-center justify-center rounded-full ${featured ? "bg-ink text-lime" : "bg-ink text-white"}`}
              >
                {UNIFORM_WORDS.test(item) ? (
                  <Shirt className="size-3" strokeWidth={2.25} />
                ) : (
                  <Check className="size-3.5" strokeWidth={3} />
                )}
              </span>
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {tier.audience || tier.commitmentNote || tier.asksSelfRating ? (
        <div
          className={`mt-5 flex flex-col gap-3 rounded-[22px] p-4 ${featured ? "bg-white/45" : surface === "panel" ? "bg-card" : "bg-panel"}`}
        >
          {tier.audience ? (
            <div>
              <p className={`text-[0.8125rem] font-medium ${quiet}`}>Who it's for</p>
              <p className="mt-0.5 text-[0.9375rem]">{tier.audience}</p>
            </div>
          ) : null}
          {tier.commitmentNote ? (
            <p className="flex items-start gap-2 text-[0.9375rem]">
              <CalendarRange aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{tier.commitmentNote}</span>
            </p>
          ) : null}
          {tier.asksSelfRating ? (
            <p className={`text-[0.8125rem] ${quiet}`}>
              Enrolling asks you to rate your own level, so the coaches can place you.
            </p>
          ) : null}
        </div>
      ) : null}

      {enroll ? <div className="mt-auto pt-5">{enroll}</div> : null}
    </article>
  );
}
