import type { PublicAcademyDto, PublicPackageDto, PublicProgramDto } from "@shared/api-types";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check } from "lucide-react";
import type { ReactNode } from "react";
import { Radio } from "react-aria-components";
import type { Format } from "../../lib/format";
import { AcademyLogo } from "../public/academy-page";
import { scheduleLines, sessionsLabel } from "../public/text";

export interface WizardStep {
  id: string;
  label: string;
}

/** The step list on the dark panel (desktop): done steps checked, the current one lime. */
function StepList({ steps, current }: { steps: WizardStep[]; current: string }) {
  const at = steps.findIndex((s) => s.id === current);
  return (
    <ol aria-label="Steps" className="hidden flex-col gap-2 lg:flex">
      {steps.map((s, i) => {
        const done = at > i || current === "done";
        const now = s.id === current;
        return (
          <li
            key={s.id}
            aria-current={now ? "step" : undefined}
            className={`flex items-center gap-3 rounded-[24px] px-3 py-2.5 text-[0.9375rem] ${now ? "bg-lime text-ink" : "text-night-ink"}`}
          >
            <span
              aria-hidden
              className={`num flex size-8 shrink-0 items-center justify-center rounded-full text-[0.8125rem] font-semibold ${
                now
                  ? "bg-ink text-lime"
                  : done
                    ? "bg-night-3 text-lime"
                    : "bg-night-2 text-night-ink-2"
              }`}
            >
              {done && !now ? <Check className="size-4" strokeWidth={2.5} /> : i + 1}
            </span>
            <span>
              {s.label}
              {done && !now ? <span className="sr-only"> (done)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Phone: "Step 2 of 5 · Details" and a bar. */
function StepProgress({ steps, current }: { steps: WizardStep[]; current: string }) {
  const at = steps.findIndex((s) => s.id === current);
  if (at < 0) return null;
  const pct = ((at + 1) / steps.length) * 100;
  return (
    <div className="lg:hidden">
      <p className="num text-[0.875rem] text-night-ink-2">
        Step {at + 1} of {steps.length} · <span className="text-night-ink">{steps[at]?.label}</span>
      </p>
      <span aria-hidden className="mt-2 block h-1.5 overflow-hidden rounded-full bg-night-3">
        <span
          className="block h-full rounded-full bg-lime transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </span>
    </div>
  );
}

/**
 * The wizard's frame (an Operate surface inside the academy's public world): the dark panel holds
 * the academy, the tier being enrolled in, and the steps; the white card holds one question.
 */
export function WizardFrame({
  academy,
  slug,
  tier,
  program,
  fmt,
  steps = [],
  current = "",
  children,
}: {
  academy: PublicAcademyDto;
  slug: string;
  tier: PublicPackageDto | null;
  program: PublicProgramDto | null;
  fmt: Format;
  steps?: WizardStep[];
  current?: string;
  children: ReactNode;
}) {
  const schedule = program ? scheduleLines(program, fmt) : [];
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:gap-3 lg:p-3 xl:grid-cols-[420px_minmax(0,1fr)]">
      <aside className="dark-zone flex flex-col gap-5 rounded-b-[32px] bg-night px-4 pt-[calc(env(safe-area-inset-top)+16px)] pb-6 text-night-ink sm:px-6 lg:sticky lg:top-3 lg:max-h-[calc(100dvh-24px)] lg:overflow-y-auto lg:rounded-[32px] lg:p-6">
        <Link
          to="/a/$slug"
          params={{ slug }}
          className="inline-flex min-h-11 items-center gap-3 self-start rounded-[16px] pr-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime"
        >
          <ArrowLeft aria-hidden className="size-4.5 text-night-ink-2" />
          <AcademyLogo name={academy.name} logoKey={academy.logoKey} size={48} />
          <span className="min-w-0 text-[1rem] font-medium break-words">{academy.name}</span>
        </Link>
        {tier ? (
          <div>
            <p className="text-[1.75rem] leading-tight font-light tracking-[-0.01em] break-words">
              {tier.name}
            </p>
            <p className="num mt-1 text-[0.9375rem] text-night-ink-2">
              {typeof tier.priceMinor === "number"
                ? `${fmt.moneyShort(tier.priceMinor)} per head · `
                : ""}
              {sessionsLabel(tier)}
            </p>
            {program ? (
              <p className="mt-3 text-[0.9375rem]">
                {program.name}
                {schedule.length ? (
                  <span className="num block text-night-ink-2">{schedule.join(" · ")}</span>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}
        <StepProgress steps={steps} current={current} />
        <StepList steps={steps} current={current} />
      </aside>
      <main
        id="main"
        className="flex min-w-0 justify-center px-3 pt-4 pb-10 sm:px-6 lg:items-start lg:px-1 lg:pt-1"
      >
        <div className="w-full max-w-2xl rounded-[28px] bg-card p-5 sm:p-8">{children}</div>
      </main>
    </div>
  );
}

/** The step's question (the page's one h1) and a line under it. */
export function StepHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-[2rem] leading-[1.1] font-light tracking-[-0.02em]">{title}</h1>
      {children ? <div className="mt-2 max-w-[60ch] text-ink-2">{children}</div> : null}
    </header>
  );
}

/** A radio option as a card (selected lime, with a check), inside a React Aria RadioGroup. */
export function ChoiceCard({
  value,
  title,
  body,
  aside,
  isDisabled,
}: {
  value: string;
  title: ReactNode;
  body?: ReactNode;
  aside?: ReactNode;
  isDisabled?: boolean;
}) {
  return (
    <Radio
      value={value}
      isDisabled={isDisabled}
      className={({ isSelected, isFocusVisible, isDisabled: off }) =>
        `flex min-h-14 cursor-pointer items-start gap-3 rounded-[22px] p-4 text-left outline-none transition-colors ${
          isSelected ? "bg-lime" : off ? "cursor-not-allowed bg-panel" : "bg-panel hover:bg-line"
        } ${isFocusVisible ? "outline-2 outline-offset-2 outline-ink" : ""}`
      }
    >
      {({ isSelected, isDisabled: off }) => (
        <>
          <span
            aria-hidden
            className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${
              isSelected ? "bg-ink text-lime" : "border border-line-strong bg-card"
            }`}
          >
            {isSelected ? <Check className="size-3.5" strokeWidth={3} /> : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block font-medium ${off ? "text-ink-2" : ""}`}>{title}</span>
            {body ? (
              <span
                className={`mt-0.5 block text-[0.875rem] ${isSelected ? "text-ink/75" : "text-ink-2"}`}
              >
                {body}
              </span>
            ) : null}
          </span>
          {aside ? <span className="shrink-0 text-right">{aside}</span> : null}
        </>
      )}
    </Radio>
  );
}

/** An advisory to read (amber wash), or a hard stop (coral wash). */
export function Note({
  tone = "amber",
  title,
  children,
}: {
  tone?: "amber" | "coral" | "sky";
  title?: string;
  children: ReactNode;
}) {
  const fill = { amber: "bg-amber-soft", coral: "bg-coral-soft", sky: "bg-sky-soft" }[tone];
  return (
    <div role="note" className={`rounded-[18px] px-4 py-3 text-[0.9375rem] text-ink ${fill}`}>
      {title ? <p className="font-medium">{title}</p> : null}
      <div className={title ? "mt-0.5 text-ink/80" : ""}>{children}</div>
    </div>
  );
}

/** Back and Continue (or Send) under a step; on phones they stay in reach. */
export function StepActions({ back, next }: { back?: ReactNode; next: ReactNode }) {
  return (
    <div className="mt-8 flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">{back}</div>
      <div className="flex shrink-0 flex-col sm:flex-row">{next}</div>
    </div>
  );
}
