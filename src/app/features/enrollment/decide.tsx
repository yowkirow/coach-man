import type { ClientListItemDto, EnrollmentDetailDto } from "@shared/api-types";
import type { EnrollmentApproveInput } from "@shared/schemas";
import { useMutation } from "@tanstack/react-query";
import { Link2, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ClientPicker } from "../../components/domain/lesson";
import { Button } from "../../components/ui/button";
import { Avatar } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { Checkbox, SelectField, TextAreaField, TextField } from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { ApiRequestError, api, errorMessage, fieldErrors } from "../../lib/api";
import { type Format, fullName, plural, useFormat } from "../../lib/format";
import { notify } from "../../lib/notify";
import { keys, queryClient } from "../../lib/query";
import { STATUS_LABELS } from "../clients/client-utils";

// The three decisions on a request: approve (sell, enroll, activate), waitlist, decline. Each is a
// sheet; errors stay in the sheet, beside what caused them.

type Detail = EnrollmentDetailDto;

interface LinkTarget {
  clientId: string;
  firstName: string;
  lastName: string;
  hint: string | null;
}

function refreshAfterDecision(d: Detail, approved: boolean) {
  if (approved) {
    // Approving sells a package, adds a charge, and changes the student, the program, and maybe a
    // session: everything active refreshes.
    void queryClient.invalidateQueries();
    return;
  }
  void queryClient.invalidateQueries({ queryKey: ["enrollments"] });
  void queryClient.invalidateQueries({ queryKey: keys.enrollment(d.id) });
  void queryClient.invalidateQueries({ queryKey: keys.enrollmentCount });
  void queryClient.invalidateQueries({ queryKey: keys.today });
}

function Note({ tone, children }: { tone: "amber" | "panel"; children: ReactNode }) {
  return (
    <div
      className={`flex gap-2.5 rounded-2xl px-4 py-3 text-[0.875rem] ${tone === "amber" ? "bg-amber-soft text-ink" : "bg-panel text-ink"}`}
    >
      {tone === "amber" ? <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** What approving will do, in the order it happens. */
function approveEffects(
  d: Detail,
  fmt: Format,
  choice: {
    month: string;
    session: Detail["options"]["sessions"][number] | null;
    startDate: string;
  },
  name: string,
): string[] {
  const out: string[] = [];
  const tier = d.tier;
  if (tier) {
    const price = tier.priceMinor > 0 ? ` for ${fmt.money(tier.priceMinor)}` : " (free)";
    if (d.mode === "month") {
      const end = d.options.startMonths.find((m) => m.month === choice.month)?.expiresOn;
      out.push(
        `Sells ${tier.name}${price} for ${fmt.month(choice.month)}${end ? `, valid to ${fmt.date(end)}` : ""}`,
      );
    } else if (d.mode === "session") {
      out.push(`Sells ${tier.name}${price}`);
    } else {
      const days = tier.validityDays;
      out.push(
        `Sells ${tier.name}${price}, starting ${fmt.day(choice.startDate)}${days ? ` and valid for ${plural(days, "day")}` : ""}`,
      );
    }
  }
  if (d.mode === "session" && choice.session) {
    out.push(
      `Books ${name} on ${fmt.day(fmt.dayOf(choice.session.startsAt))} at ${fmt.time(choice.session.startsAt)}`,
    );
  } else if (d.program && !d.capacity?.alreadyIn) {
    out.push(`Adds ${name} to ${d.program.name}`);
  }
  if (d.student.status !== "active") out.push(`Makes ${name} an active student`);
  if (d.answers.selfRating !== null && !d.renewal) {
    out.push(`Saves their self-rating of ${d.answers.selfRating.toFixed(1)}`);
  }
  if (tier && tier.priceMinor > 0) out.push(`Adds a ${fmt.money(tier.priceMinor)} charge to pay`);
  return out;
}

function sessionLabel(s: Detail["options"]["sessions"][number], fmt: Format) {
  return `${fmt.day(fmt.dayOf(s.startsAt))} · ${fmt.timeRange(s.startsAt, s.endsAt)}`;
}

function seatsText(left: number | null) {
  if (left === null) return "No size limit";
  if (left <= 0) return "Full";
  return `${plural(left, "place")} left`;
}

/**
 * Approve: sells the tier (with the month or session staff confirm here), adds the student to the
 * program or books the session, and makes them active. New students can instead be matched to
 * someone already training here, with a clear confirmation of what that shares.
 */
export function ApproveSheet({
  d,
  fmt,
  isOpen,
  onOpenChange,
}: {
  d: Detail;
  fmt: Format;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const months = d.options.startMonths;
  const sessions = d.options.sessions;
  const initialMonth =
    months.find((m) => m.month === d.period.startMonth)?.month ?? months[0]?.month ?? "";
  const initialSession =
    sessions.find((s) => s.lessonId === d.period.session?.lessonId)?.lessonId ??
    sessions[0]?.lessonId ??
    "";
  const [month, setMonth] = useState(initialMonth);
  const [lessonId, setLessonId] = useState(initialSession);
  const [startDate, setStartDate] = useState(d.period.startDate ?? fmt.today());
  const [link, setLink] = useState<LinkTarget | null>(null);
  const [linkConfirmed, setLinkConfirmed] = useState(false);
  const [force, setForce] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // A fresh start each time it opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the sheet opens.
  useEffect(() => {
    if (!isOpen) return;
    setMonth(initialMonth);
    setLessonId(initialSession);
    setStartDate(d.period.startDate ?? fmt.today());
    setLink(null);
    setLinkConfirmed(false);
    setForce(false);
    setError(null);
  }, [isOpen]);

  const session = sessions.find((s) => s.lessonId === lessonId) ?? null;
  const sessionFull =
    d.mode === "session" && session?.seatsLeft !== null && (session?.seatsLeft ?? 1) <= 0;
  const serverFull = error instanceof ApiRequestError && error.code === "session_full";
  const needsForce = sessionFull || serverFull;
  const student = link ?? d.student;
  const name = student.firstName;

  const approve = useMutation({
    mutationFn: () => {
      const body: EnrollmentApproveInput = {};
      if (d.mode === "month" && month) body.startMonth = month;
      if (d.mode === "session" && lessonId) body.lessonId = lessonId;
      if (d.mode === "date" && startDate) body.startDate = startDate;
      if (link) body.linkClientId = link.clientId;
      if (needsForce && force) body.force = true;
      return api.post<Detail>(`/enrollments/${encodeURIComponent(d.id)}/approve`, body);
    },
    meta: { silent: true },
    onSuccess: (res) => {
      onOpenChange(false);
      notify({
        tone: "success",
        title: `${fullName(res.student)} is enrolled`,
        body: res.warnings?.length
          ? res.warnings.join(" ")
          : res.payment && res.payment.dueMinor > 0
            ? `${fmt.money(res.payment.dueMinor)} to pay. The family sees it in their portal.`
            : "The family sees it in their portal.",
      });
      refreshAfterDecision(d, true);
    },
    onError: setError,
  });

  const blocked =
    (link !== null && !linkConfirmed) ||
    (needsForce && !force) ||
    (d.mode === "month" && !month) ||
    (d.mode === "session" && !lessonId) ||
    (d.mode === "date" && !startDate);
  const fields = fieldErrors(error);
  const programFull =
    d.capacity?.kind === "program" && d.capacity.capacity !== null && d.capacity.left !== null
      ? d.capacity.left <= 0 && !d.capacity.alreadyIn
      : false;

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={`Approve ${d.student.firstName}?`}
      description={d.tier ? `${d.tier.name}${d.program ? ` · ${d.program.name}` : ""}` : undefined}
      size="lg"
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Not yet
          </Button>
          <Button
            variant="dark"
            onPress={() => {
              setError(null);
              approve.mutate();
            }}
            isPending={approve.isPending}
            isDisabled={blocked}
          >
            {link ? "Link and approve" : "Approve"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {d.mode === "month" ? (
          <SelectField
            label="Month"
            options={months.map((m) => ({
              id: m.month,
              label: fmt.month(m.month),
              description: `Valid to ${fmt.date(m.expiresOn)}`,
            }))}
            value={month || null}
            onChange={setMonth}
            description={
              d.period.startMonth && d.period.startMonth !== month
                ? `They asked for ${fmt.month(d.period.startMonth)}.`
                : "The month they asked for."
            }
            error={fields.startMonth}
          />
        ) : null}

        {d.mode === "session" ? (
          sessions.length ? (
            <SelectField
              label="Session"
              options={sessions.map((s) => ({
                id: s.lessonId,
                label: sessionLabel(s, fmt),
                description: seatsText(s.seatsLeft),
              }))}
              value={lessonId || null}
              onChange={(v) => {
                setLessonId(v);
                setForce(false);
                setError(null);
              }}
              description={
                d.period.session && d.period.session.lessonId !== lessonId
                  ? `They picked ${fmt.day(fmt.dayOf(d.period.session.startsAt))} at ${fmt.time(d.period.session.startsAt)}.`
                  : session
                    ? seatsText(session.seatsLeft)
                    : undefined
              }
              error={fields.lessonId}
            />
          ) : (
            <InlineError>
              There's no upcoming session of {d.program?.name ?? "this program"} to book. Add one on
              the schedule first, or decline with a note.
            </InlineError>
          )
        ) : null}

        {d.mode === "date" ? (
          <TextField
            label="Start date"
            type="date"
            value={startDate}
            onChange={setStartDate}
            min={fmt.today()}
            description="The package's validity counts from this day."
            error={fields.startDate}
          />
        ) : null}

        {d.student.isNew ? (
          <LinkSection
            d={d}
            link={link}
            onLink={(t) => {
              setLink(t);
              setLinkConfirmed(false);
              setError(null);
            }}
            confirmed={linkConfirmed}
            onConfirm={setLinkConfirmed}
          />
        ) : null}

        <section aria-label="What approving does" className="flex flex-col gap-2">
          <h3 className="text-[0.9375rem] font-medium">Approving will</h3>
          <ul className="flex flex-col gap-1.5 text-[0.9375rem] text-ink-2">
            {approveEffects(d, fmt, { month, session, startDate }, name).map((t) => (
              <li key={t} className="flex gap-2">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-ink" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </section>

        {programFull && d.capacity ? (
          <Note tone="amber">
            {d.program?.name ?? "The program"} is full: {d.capacity.taken} of {d.capacity.capacity}{" "}
            places. You can still approve; it adds one more.
          </Note>
        ) : null}
        {d.ageNote ? <Note tone="amber">{d.ageNote}</Note> : null}
        {d.consentsMissing > 0 ? (
          <Note tone="amber">
            {plural(d.consentsMissing, "required consent")} still to sign. The family sees it in
            their portal.
          </Note>
        ) : null}

        {needsForce ? (
          <div className="flex flex-col gap-2 rounded-2xl bg-amber-soft px-4 py-3">
            <p className="flex gap-2.5 text-[0.875rem]">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                {serverFull
                  ? errorMessage(error)
                  : "That session is full. Pick another, or book one over the limit."}
              </span>
            </p>
            <Checkbox isSelected={force} onChange={setForce}>
              Book one over the limit
            </Checkbox>
          </div>
        ) : null}

        {error && !serverFull ? <InlineError>{errorMessage(error)}</InlineError> : null}
      </div>
    </Sheet>
  );
}

/** New students: approve onto the record of someone already training here instead. */
function LinkSection({
  d,
  link,
  onLink,
  confirmed,
  onConfirm,
}: {
  d: Detail;
  link: LinkTarget | null;
  onLink: (t: LinkTarget | null) => void;
  confirmed: boolean;
  onConfirm: (v: boolean) => void;
}) {
  const [picking, setPicking] = useState(false);
  const fmt = useFormat();
  const lead = fullName(d.student);
  const submitter = d.submitter.name;
  const pick = (c: ClientListItemDto | Detail["matches"][number]) => {
    onLink({
      clientId: "clientId" in c ? c.clientId : c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      hint: c.phone ?? null,
    });
    setPicking(false);
  };

  if (link) {
    const target = fullName(link);
    return (
      <section
        aria-label="Already training here"
        className="flex flex-col gap-3 rounded-[22px] bg-panel p-4"
      >
        <div className="flex items-center gap-3">
          <Avatar person={link} size="md" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">This is {target}, who already trains here</p>
            <p className="text-[0.8125rem] text-ink-2">
              The request, its consents and pickups move to {link.firstName}'s record, and the new
              record for {lead} is removed.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 rounded-2xl bg-amber-soft px-4 py-3">
          <p className="flex gap-2.5 text-[0.875rem]">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              {submitter} will see {link.firstName}'s record in their family portal: sessions,
              packages, payments, progress, and notes you share. Only link if you're sure.
            </span>
          </p>
          <Checkbox isSelected={confirmed} onChange={onConfirm}>
            {d.submitter.relation === "self"
              ? `Yes, ${submitter} is ${target}`
              : `Yes, ${submitter} is ${target}'s parent or guardian`}
          </Checkbox>
        </div>
        <Button variant="light" size="sm" onPress={() => onLink(null)} className="self-start">
          Keep as a new student
        </Button>
      </section>
    );
  }

  return (
    <section aria-label="Already training here?" className="flex flex-col gap-3">
      <div>
        <h3 className="text-[0.9375rem] font-medium">Already training here?</h3>
        <p className="text-[0.875rem] text-ink-2">
          {d.matches.length
            ? `${plural(d.matches.length, "person", "people")} on your books may be ${lead}.`
            : `If ${lead} is already on your books, approve onto their record instead of a new one.`}
        </p>
      </div>
      {d.matches.length ? (
        <ul className="flex flex-col gap-2">
          {d.matches.map((m) => (
            <li key={m.clientId}>
              <button
                type="button"
                onClick={() => pick(m)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-2xl bg-panel px-3 py-2.5 text-left outline-none hover:bg-line focus-visible:outline-2 focus-visible:outline-ink"
              >
                <Avatar person={m} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">This is {fullName(m)}</span>
                  <span className="num block truncate text-[0.8125rem] text-ink-2">
                    {[
                      m.birthDate ? `Born ${fmt.date(m.birthDate)}` : null,
                      m.phone,
                      STATUS_LABELS[m.status],
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <Link2 aria-hidden className="size-4 shrink-0 text-ink-2" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {picking ? (
        <ClientPicker
          label="Find them"
          placeholder="Name, phone, or email"
          exclude={[d.student.clientId]}
          onSelect={pick}
          autoFocus
        />
      ) : (
        <Button variant="light" size="sm" onPress={() => setPicking(true)} className="self-start">
          {d.matches.length ? "Someone else" : "Find them"}
        </Button>
      )}
    </section>
  );
}

/** Waitlist, with an optional note the family sees. */
export function WaitlistSheet({
  d,
  isOpen,
  onOpenChange,
}: {
  d: Detail;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!isOpen) return;
    setNote("");
    setError(null);
  }, [isOpen]);
  const waitlist = useMutation({
    mutationFn: () =>
      api.post<Detail>(`/enrollments/${encodeURIComponent(d.id)}/waitlist`, {
        note: note.trim() || undefined,
      }),
    meta: { silent: true },
    onSuccess: () => {
      onOpenChange(false);
      notify({
        tone: "success",
        title: `${d.student.firstName} is on the waitlist`,
        body: "Approve or decline it later from Waitlisted.",
      });
      refreshAfterDecision(d, false);
    },
    onError: setError,
  });
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={`Waitlist ${d.student.firstName}?`}
      description="The request stays open; approve it when a place frees up."
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Not yet
          </Button>
          <Button variant="dark" onPress={() => waitlist.mutate()} isPending={waitlist.isPending}>
            Waitlist
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextAreaField
          label="Note for the family (optional)"
          value={note}
          onChange={setNote}
          placeholder="For example: a place usually opens at the start of the month."
          description="They see this in their portal."
          error={fieldErrors(error).note}
          autoFocus
        />
        {error && !fieldErrors(error).note ? (
          <InlineError>{errorMessage(error)}</InlineError>
        ) : null}
      </div>
    </Sheet>
  );
}

/** Decline, with the reason the family sees. */
export function DeclineSheet({
  d,
  isOpen,
  onOpenChange,
}: {
  d: Detail;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    setReason("");
    setError(null);
    setTouched(false);
  }, [isOpen]);
  const decline = useMutation({
    mutationFn: () =>
      api.post<Detail>(`/enrollments/${encodeURIComponent(d.id)}/decline`, {
        reason: reason.trim(),
      }),
    meta: { silent: true },
    onSuccess: () => {
      onOpenChange(false);
      notify({
        tone: "success",
        title: "Request declined",
        body: "The family sees your reason in their portal.",
      });
      refreshAfterDecision(d, false);
    },
    onError: setError,
  });
  const tooShort = reason.trim().length < 2;
  const fieldError =
    fieldErrors(error).reason ??
    (touched && tooShort ? "Say why, so the family knows." : undefined);
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={`Decline ${d.student.firstName}'s request?`}
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Not yet
          </Button>
          <Button
            variant="danger"
            onPress={() => {
              setTouched(true);
              if (tooShort) return;
              decline.mutate();
            }}
            isPending={decline.isPending}
          >
            Decline
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextAreaField
          label="Reason"
          value={reason}
          onChange={setReason}
          placeholder="For example: this program is for ages 10 and up."
          description="The family sees this in their portal. Be kind and specific."
          error={fieldError}
          autoFocus
        />
        {error && !fieldErrors(error).reason ? (
          <InlineError>{errorMessage(error)}</InlineError>
        ) : null}
      </div>
    </Sheet>
  );
}
