import type {
  EnrollmentContextDto,
  PublicAcademyDto,
  PublicConsentDocumentDto,
  PublicPackageDto,
  PublicProgramDto,
  PublicSessionDto,
} from "@shared/api-types";
import {
  checkPeriod,
  type EnrollmentMode,
  findDuplicate,
  monthChoices,
  START_DATE_MAX_DAYS,
} from "@shared/enrollment";
import { addDays } from "@shared/time";
import { CalendarCheck, ClipboardCheck, Wallet } from "lucide-react";
import { Label, RadioGroup } from "react-aria-components";
import { buttonClass } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/feedback";
import { Checkbox, TextField } from "../../components/ui/field";
import { type Format, plural } from "../../lib/format";
import { ConsentText } from "../consents/consents";
import { MONTH_END_ADVICE, scheduleLines, sessionsLabel, validityLine } from "../public/text";
import { UNIFORM_WORDS } from "../public/tier-card";
import { PolicyLink } from "../public-info/legal-links";
import type { WizardDraft } from "./draft";
import type { StepProps } from "./steps-student";
import { chosenStudent } from "./steps-student";
import { ChoiceCard, Note } from "./wizard-ui";

const groupLabel = "text-[0.8125rem] font-medium text-ink-2";

const sessionLine = (s: PublicSessionDto, fmt: Format) =>
  [fmt.timeRange(s.startsAt, s.endsAt), s.venue?.name, s.court ? `Court ${s.court}` : null]
    .filter(Boolean)
    .join(" · ");

/** A repeat of a request already sent (or approved) for this student, tier, and period. */
export function duplicateOf(
  draft: WizardDraft,
  context: EnrollmentContextDto | undefined,
  tier: PublicPackageDto,
  mode: EnrollmentMode,
) {
  const student = chosenStudent(draft, context);
  if (!student || !context) return null;
  return findDuplicate(
    context.requests.map((r, i) => ({ ...r, id: `existing-${i}` })),
    {
      clientId: student.clientId,
      packageId: tier.id,
      startMonth: mode === "month" ? draft.startMonth || null : null,
      lessonId: mode === "session" ? draft.lessonId || null : null,
    },
  );
}

/** Problems with the "when" step. */
export function whenErrors(
  draft: WizardDraft,
  mode: EnrollmentMode,
  today: string,
  sessions: PublicSessionDto[] | undefined,
): Record<string, string> {
  const check = checkPeriod(
    mode,
    { startMonth: draft.startMonth, lessonId: draft.lessonId, startDate: draft.startDate },
    today,
  );
  if (!check.ok) return { when: check.message };
  if (mode === "session") {
    const s = sessions?.find((x) => x.id === draft.lessonId);
    if (!s) return { when: "Pick a session." };
    if (s.seatsLeft === 0) return { when: "That session is full. Pick another one." };
  }
  return {};
}

/** Step 4: the start month (month-end tiers), a session (a trial), or a start date. */
export function WhenStep({
  draft,
  update,
  errors,
  mode,
  tier,
  today,
  fmt,
  sessions,
  sessionsLoading,
  duplicateText,
}: StepProps & {
  mode: EnrollmentMode;
  tier: PublicPackageDto;
  today: string;
  fmt: Format;
  sessions: PublicSessionDto[] | undefined;
  sessionsLoading: boolean;
  duplicateText: string | null;
}) {
  const error = errors.when ? (
    <p className="text-[0.8125rem] font-medium text-[#b42318]">{errors.when}</p>
  ) : null;
  return (
    <div className="flex flex-col gap-5">
      {mode === "month" ? (
        <RadioGroup
          value={draft.startMonth}
          onChange={(v) => update((d) => ({ ...d, startMonth: v }))}
          isInvalid={Boolean(errors.when)}
          className="flex flex-col gap-2"
        >
          <Label className={groupLabel}>Start month</Label>
          {monthChoices(today).map((m) => (
            <ChoiceCard
              key={m.month}
              value={m.month}
              title={`${m.current ? "This month" : "Next month"}: ${fmt.month(m.month)}`}
              body={
                <span className="num">
                  Pays for sessions from {fmt.date(m.startsOn)}, valid until {fmt.date(m.expiresOn)}
                </span>
              }
            />
          ))}
          {error}
          <Note tone="sky">
            Valid until the end of the month, whenever you start. {MONTH_END_ADVICE}
          </Note>
        </RadioGroup>
      ) : mode === "session" ? (
        sessionsLoading ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <span className="sr-only">Loading sessions…</span>
            <Skeleton className="h-16 rounded-[22px]" />
            <Skeleton className="h-16 rounded-[22px]" />
            <Skeleton className="h-16 rounded-[22px]" />
          </div>
        ) : sessions?.length ? (
          <RadioGroup
            value={draft.lessonId}
            onChange={(v) => update((d) => ({ ...d, lessonId: v }))}
            isInvalid={Boolean(errors.when)}
            className="flex flex-col gap-2"
          >
            <Label className={groupLabel}>Upcoming sessions</Label>
            {sessions.map((s) => (
              <ChoiceCard
                key={s.id}
                value={s.id}
                isDisabled={s.seatsLeft === 0}
                title={fmt.longDay(s.date)}
                body={<span className="num">{sessionLine(s, fmt)}</span>}
                aside={
                  s.seatsLeft === null ? null : (
                    <span className="num text-[0.8125rem] font-medium">
                      {s.seatsLeft === 0 ? "Full" : `${plural(s.seatsLeft, "place")} left`}
                    </span>
                  )
                }
              />
            ))}
            {error}
          </RadioGroup>
        ) : (
          <Note title="No sessions to pick yet">
            There are no sessions scheduled in the next six weeks. Message the academy to ask when
            the next one is.
          </Note>
        )
      ) : (
        <TextField
          label="Start date"
          type="date"
          value={draft.startDate}
          min={today}
          max={addDays(today, START_DATE_MAX_DAYS)}
          onChange={(v) => update((d) => ({ ...d, startDate: v }))}
          description={
            draft.startDate && tier.validityDays
              ? `Valid until ${fmt.date(addDays(draft.startDate, tier.validityDays - 1))}.`
              : validityLine(tier)
          }
          error={errors.when}
        />
      )}
      {duplicateText ? (
        <Note tone="coral" title="Already asked for">
          {duplicateText}
        </Note>
      ) : null}
    </div>
  );
}

/** Problems with the consents step. */
export function consentErrors(
  draft: WizardDraft,
  docs: PublicConsentDocumentDto[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of docs) {
    if (!draft.agreed.includes(`${d.id}:${d.version}`)) {
      out[`doc:${d.id}`] = `Read “${d.title}” and tick that you agree.`;
    }
  }
  if (draft.signerName.trim().length < 2) out.signerName = "Type your full name to sign.";
  return out;
}

/** Step 5: read each form, agree, and sign by typing a name (a parent signs for a minor). */
export function ConsentsStep({
  draft,
  update,
  errors,
  docs,
  minor,
  whose,
}: StepProps & { docs: PublicConsentDocumentDto[]; minor: boolean; whose: string | null }) {
  const toggle = (key: string, on: boolean) =>
    update((d) => ({
      ...d,
      agreed: on ? [...new Set([...d.agreed, key])] : d.agreed.filter((k) => k !== key),
    }));
  return (
    <div className="flex flex-col gap-6">
      {docs.map((d) => {
        const key = `${d.id}:${d.version}`;
        return (
          <section
            key={d.id}
            aria-labelledby={`doc-${d.id}`}
            className="flex flex-col gap-3 rounded-[22px] border border-line p-4"
          >
            <h2 id={`doc-${d.id}`} className="text-[1.125rem] font-medium">
              {d.title}
            </h2>
            <section
              aria-label={`${d.title} text`}
              className="max-h-[42dvh] overflow-y-auto rounded-[18px] bg-panel p-4"
            >
              <ConsentText body={d.body} />
            </section>
            <Checkbox isSelected={draft.agreed.includes(key)} onChange={(on) => toggle(key, on)}>
              I've read and agree to “{d.title}”
            </Checkbox>
            {errors[`doc:${d.id}`] ? (
              <p className="text-[0.8125rem] font-medium text-[#b42318]">{errors[`doc:${d.id}`]}</p>
            ) : null}
          </section>
        );
      })}
      <TextField
        label="Type your full name to sign"
        value={draft.signerName}
        onChange={(v) => update((d) => ({ ...d, signerName: v }))}
        autoComplete="name"
        description={
          minor
            ? `You sign ${docs.length === 1 ? "it" : "them"} as ${whose ?? "your child"}'s parent or guardian, today. The academy keeps the date and time.`
            : `You sign ${docs.length === 1 ? "it" : "them"} for yourself, today. The academy keeps the date and time.`
        }
        error={errors.signerName}
      />
      <p className="text-[0.8125rem] text-ink-2">
        These forms are the academy's. How CoachMan keeps what you send:{" "}
        <PolicyLink to="/privacy">privacy policy</PolicyLink> and{" "}
        <PolicyLink to="/terms">terms of use</PolicyLink>.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-[0.875rem] text-ink-2">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** Step 6: everything at a glance before it's sent. */
export function ReviewStep({
  draft,
  academy,
  tier,
  program,
  mode,
  fmt,
  studentLabel,
  sessions,
  docs,
}: {
  draft: WizardDraft;
  academy: PublicAcademyDto;
  tier: PublicPackageDto;
  program: PublicProgramDto | null;
  mode: EnrollmentMode;
  fmt: Format;
  studentLabel: string;
  sessions: PublicSessionDto[] | undefined;
  docs: PublicConsentDocumentDto[];
}) {
  const session = sessions?.find((s) => s.id === draft.lessonId);
  const inclusions = [...tier.inclusions];
  if (tier.includesUniform && !inclusions.some((i) => UNIFORM_WORDS.test(i))) {
    inclusions.push("Training uniform");
  }
  const when =
    mode === "month" && draft.startMonth
      ? `${fmt.month(draft.startMonth)}: valid ${fmt.date(`${draft.startMonth}-01`)} to ${fmt.date(
          monthChoices(academy.today).find((m) => m.month === draft.startMonth)?.expiresOn ??
            `${draft.startMonth}-28`,
        )}`
      : mode === "session" && session
        ? `${fmt.longDay(session.date)} · ${sessionLine(session, fmt)}`
        : draft.startDate
          ? `From ${fmt.longDay(draft.startDate)}${
              tier.validityDays
                ? `, valid until ${fmt.date(addDays(draft.startDate, tier.validityDays - 1))}`
                : ""
            }`
          : "";
  const schedule = program ? scheduleLines(program, fmt) : [];
  const a = draft.answers;
  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-col divide-y divide-line">
        <Row label="Who's training">{studentLabel}</Row>
        <Row label="Package">
          <span className="font-medium">{tier.name}</span> · {sessionsLabel(tier)}
          {typeof tier.priceMinor === "number" ? (
            <span className="num block text-[1.375rem] font-light">
              {fmt.moneyShort(tier.priceMinor)}
              <span className="text-[0.875rem] text-ink-2"> per head</span>
            </span>
          ) : null}
        </Row>
        {program ? (
          <Row label="Program">
            {program.name}
            {schedule.length ? (
              <span className="num block text-[0.875rem] text-ink-2">{schedule.join(" · ")}</span>
            ) : null}
          </Row>
        ) : null}
        <Row label={mode === "session" ? "Session" : "When"}>
          <span className="num">{when}</span>
        </Row>
        {inclusions.length ? (
          <Row label="Included">
            <ul className="flex flex-col gap-1">
              {inclusions.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </Row>
        ) : null}
        {tier.asksSelfRating ? (
          <Row label="Level">
            {a.selfRating !== null ? (
              <span className="num">{a.selfRating.toFixed(1)}</span>
            ) : (
              "Not sure"
            )}
          </Row>
        ) : null}
        {tier.includesUniform ? <Row label="Shirt size">{a.shirtSize}</Row> : null}
        <Row label="Contact">
          <span className="num">{a.phone}</span>
          {a.email ? <span className="block">{a.email}</span> : null}
        </Row>
        <Row label="Emergency contact">
          {a.emergencyName} · <span className="num">{a.emergencyPhone}</span>
        </Row>
        {a.medicalNotes.trim() ? <Row label="Health notes">{a.medicalNotes}</Row> : null}
        {a.pickups.filter((p) => p.name.trim()).length ? (
          <Row label="May pick up">
            {a.pickups
              .filter((p) => p.name.trim())
              .map((p) => [p.name, p.relationship].filter(Boolean).join(", "))
              .join("; ")}
          </Row>
        ) : null}
        {docs.length ? (
          <Row label="Signed">
            {docs.map((d) => d.title).join(", ")}
            <span className="block text-[0.875rem] text-ink-2">by {draft.signerName}</span>
          </Row>
        ) : null}
      </dl>
      <Note tone="sky" title="Nothing to pay yet">
        {academy.name} reviews your request first. Once it's approved, the amount and how to pay
        show in your family portal.
      </Note>
    </div>
  );
}

/** After sending: what happens next, and the way to the family portal. */
export function DoneStep({
  academyName,
  studentLabel,
  tierName,
  periodLabel,
  onOpenPortal,
}: {
  academyName: string;
  studentLabel: string;
  tierName: string;
  periodLabel: string;
  onOpenPortal: () => void;
}) {
  const steps = [
    {
      icon: ClipboardCheck,
      text: `${academyName} reviews the request. You'll see where it stands in your family portal.`,
    },
    {
      icon: Wallet,
      text: `Once it's approved, the amount due shows there, with ${academyName}'s instructions for paying by e-wallet, bank transfer, or cash.`,
    },
    {
      icon: CalendarCheck,
      text: periodLabel ? `Training starts ${periodLabel}.` : "Then training starts.",
    },
  ];
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[2rem] leading-[1.1] font-light tracking-[-0.02em]">Request sent</h1>
        <p className="mt-2 max-w-[60ch] text-ink-2">
          {studentLabel === "You" ? "Your" : `${studentLabel}'s`} request for {tierName} is with{" "}
          {academyName}.
        </p>
      </header>
      <section aria-labelledby="next-title" className="rounded-[22px] bg-panel p-5">
        <h2 id="next-title" className="text-[1.125rem] font-medium">
          What happens next
        </h2>
        <ol className="mt-3 flex flex-col gap-3">
          {steps.map((s) => (
            <li key={s.text} className="flex items-start gap-3">
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-lime text-ink"
              >
                <s.icon className="size-4.5" />
              </span>
              <span className="pt-1.5">{s.text}</span>
            </li>
          ))}
        </ol>
      </section>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onOpenPortal}
          className={buttonClass("dark", "lg", "cursor-pointer")}
        >
          See it in My family
        </button>
      </div>
      <p className="text-[0.8125rem] text-ink-2">
        The request's status, the amount due once it's approved, and the training itself all live in
        your family portal.
      </p>
    </div>
  );
}
