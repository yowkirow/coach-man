import type { EnrollmentDetailDto } from "@shared/api-types";
import { type ConsentSignerRelation, FAMILY_RELATION_LABELS } from "@shared/domain";
import { selfRatingHint } from "@shared/enrollment";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button, buttonClass } from "../../components/ui/button";
import { Avatar, Card, CardHeader, KeyValue, Meter, Pill } from "../../components/ui/display";
import { ErrorState, Skeleton } from "../../components/ui/feedback";
import { ApiRequestError, errorMessage } from "../../lib/api";
import { type Format, fullName, plural, useFormat } from "../../lib/format";
import { useOnline } from "../../lib/offline";
import { templateValidityText } from "../packages/catalog";
import { ProofList } from "../payment-proofs/review";
import { requestPayPill } from "../payment-proofs/text";
import { ApproveSheet, DeclineSheet, WaitlistSheet } from "./decide";
import { useEnrollment, useEnrollments } from "./queries";
import { enrollmentStatusPill, periodText } from "./text";

type Detail = EnrollmentDetailDto;
type SheetName = "approve" | "waitlist" | "decline";

const SIGNER: Record<ConsentSignerRelation, string> = {
  self: "the student",
  guardian: "parent or guardian",
  staff: "staff",
};

/** A request, everything needed to decide it, and the decision. */
export function RequestDetail({ requestId }: { requestId: string }) {
  const fmt = useFormat();
  const q = useEnrollment(requestId);
  const [sheet, setSheet] = useState<SheetName | null>(null);

  if (q.isPending) return <DetailSkeleton />;
  if (!q.data) {
    const missing = q.error instanceof ApiRequestError && q.error.status === 404;
    return (
      <div className="flex flex-col gap-2">
        <ErrorState
          title={missing ? "Request not found" : "Couldn't load this request"}
          message={
            missing
              ? "It may be from another academy, or the link is wrong."
              : errorMessage(q.error)
          }
          onRetry={missing ? undefined : () => void q.refetch()}
        />
        <Link to="/enrollments" className={buttonClass("light", "md", "self-start")}>
          All requests
        </Link>
      </div>
    );
  }
  const d = q.data;
  const open = d.status === "requested" || d.status === "waitlisted";
  const close = (isOpen: boolean) => {
    if (!isOpen) setSheet(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <DetailHeader d={d} fmt={fmt} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <DecisionCard d={d} fmt={fmt} onSheet={setSheet} />
          <StudentCard d={d} fmt={fmt} />
          <AnswersCard d={d} />
          {d.student.minor || d.pickups.length ? <PickupsCard d={d} /> : null}
        </div>
        <div className="flex flex-col gap-4">
          <PackageCard d={d} fmt={fmt} />
          {d.capacity ? <CapacityCard d={d} fmt={fmt} /> : null}
          <PaymentCard d={d} fmt={fmt} />
          <ConsentsCard d={d} fmt={fmt} />
        </div>
      </div>
      {open ? (
        <>
          <ApproveSheet d={d} fmt={fmt} isOpen={sheet === "approve"} onOpenChange={close} />
          <WaitlistSheet d={d} isOpen={sheet === "waitlist"} onOpenChange={close} />
          <DeclineSheet d={d} isOpen={sheet === "decline"} onOpenChange={close} />
        </>
      ) : null}
    </div>
  );
}

function DetailHeader({ d, fmt }: { d: Detail; fmt: Format }) {
  const pill = enrollmentStatusPill(d.status);
  const period = periodText(
    {
      mode: d.mode,
      startMonth: d.period.startMonth,
      startDate: d.period.startDate,
      sessionStartsAt: d.period.session?.startsAt ?? null,
    },
    fmt,
  );
  return (
    <header className="flex min-w-0 items-start gap-3">
      <Link
        to="/enrollments"
        activeOptions={{ exact: true }}
        aria-label="All enrollment requests"
        className="mt-1 flex size-11 shrink-0 items-center justify-center rounded-full bg-card text-ink outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink lg:hidden"
      >
        <ArrowLeft aria-hidden className="size-5" />
      </Link>
      <div className="min-w-0">
        <h1 className="text-[2rem] leading-[1.08] font-light tracking-[-0.02em] break-words lg:text-[2.75rem]">
          {fullName(d.student)}
        </h1>
        <p className="num mt-2 text-[0.9375rem] text-ink-2">
          {[
            d.tier?.name ?? "Package removed",
            period,
            d.program?.name,
            `sent ${fmt.date(fmt.dayOf(d.createdAt))}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Pill tone={pill.tone}>{pill.label}</Pill>
          {d.student.isNew ? <Pill tone="violet">New student</Pill> : null}
          {d.renewal ? <Pill tone="outline">Renewal</Pill> : null}
          {d.student.minor ? (
            <Pill tone="outline">
              <span className="num">
                {d.student.age !== null ? `Junior, ${d.student.age}` : "Junior"}
              </span>
            </Pill>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function Warn({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2.5 rounded-2xl bg-amber-soft px-4 py-3 text-[0.875rem]">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** The decision: the actions while it's open, or what was decided and by whom. */
function DecisionCard({
  d,
  fmt,
  onSheet,
}: {
  d: Detail;
  fmt: Format;
  onSheet: (s: SheetName) => void;
}) {
  const online = useOnline();
  const queue = useEnrollments("requested");
  const next = queue.data?.items.find((i) => i.id !== d.id) ?? null;
  const open = d.status === "requested" || d.status === "waitlisted";
  const by = d.decidedBy?.name;
  const when = d.decidedAt ? fmt.date(fmt.dayOf(d.decidedAt)) : null;

  if (open) {
    return (
      <Card label="Decision" className="flex flex-col gap-4 p-5">
        <div>
          <h2 className="text-[1.125rem] font-medium">
            {d.status === "waitlisted" ? "On the waitlist" : "Waiting for you"}
          </h2>
          <p className="mt-1 text-[0.9375rem] text-ink-2">
            {d.status === "waitlisted"
              ? `Waitlisted${when ? ` ${when}` : ""}${by ? ` by ${by}` : ""}. Approve when a place frees up.`
              : "Approving sells the package and adds the charge. The family sees every decision in their portal."}
          </p>
        </div>
        {d.status === "waitlisted" && d.decisionNote ? (
          <p className="rounded-2xl bg-panel px-4 py-3 text-[0.9375rem]">
            <span className="block text-[0.8125rem] text-ink-2">Note to the family</span>
            {d.decisionNote}
          </p>
        ) : null}
        {d.tier && !d.tier.active ? (
          <Warn>{d.tier.name} isn't for sale any more. Decline, or make it active again.</Warn>
        ) : null}
        {d.capacity?.over ? (
          <Warn>
            {d.capacity.kind === "session" ? "That session" : (d.program?.name ?? "The program")} is
            full ({d.capacity.taken} of {d.capacity.capacity}). You can still approve.
          </Warn>
        ) : null}
        {d.ageNote ? <Warn>{d.ageNote}</Warn> : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            variant="dark"
            icon={<Check aria-hidden className="size-4.5" />}
            onPress={() => onSheet("approve")}
            isDisabled={!online || !d.tier}
          >
            Approve
          </Button>
          <div className="flex gap-2 *:flex-1 sm:*:flex-none">
            {d.status === "requested" ? (
              <Button variant="light" onPress={() => onSheet("waitlist")} isDisabled={!online}>
                Waitlist
              </Button>
            ) : null}
            <Button variant="light" onPress={() => onSheet("decline")} isDisabled={!online}>
              Decline
            </Button>
          </div>
        </div>
        {!online ? (
          <p className="text-[0.8125rem] text-ink-2">Decisions need a connection.</p>
        ) : null}
      </Card>
    );
  }

  const headline =
    d.status === "approved"
      ? "Approved"
      : d.status === "declined"
        ? "Declined"
        : "Cancelled by the family";
  return (
    <Card label="Decision" className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-[1.125rem] font-medium">{headline}</h2>
        <p className="mt-1 text-[0.9375rem] text-ink-2">
          {[when, by ? `by ${by}` : null].filter(Boolean).join(" ") || "—"}
        </p>
      </div>
      {d.status === "declined" && d.decisionNote ? (
        <p className="rounded-2xl bg-panel px-4 py-3 text-[0.9375rem]">
          <span className="block text-[0.8125rem] text-ink-2">Reason the family sees</span>
          {d.decisionNote}
        </p>
      ) : null}
      {d.warnings?.length ? d.warnings.map((w) => <Warn key={w}>{w}</Warn>) : null}
      <div className="flex flex-wrap gap-2">
        {d.status === "approved" ? (
          <Link
            to="/clients/$clientId"
            params={{ clientId: d.student.clientId }}
            className={buttonClass("light", "md")}
          >
            Open {d.student.firstName}'s profile
          </Link>
        ) : null}
        {next ? (
          <Link
            to="/enrollments/$requestId"
            params={{ requestId: next.id }}
            className={buttonClass("dark", "md", "gap-2")}
          >
            Next request
            <ArrowRight aria-hidden className="size-4.5" />
          </Link>
        ) : null}
      </div>
    </Card>
  );
}

function StudentCard({ d, fmt }: { d: Detail; fmt: Format }) {
  const s = d.student;
  const sub = d.submitter;
  return (
    <Card label="Student">
      <CardHeader
        title="Student"
        action={
          s.isNew ? (
            <Pill tone="violet">New to the academy</Pill>
          ) : (
            <Pill tone="panel">Already training here</Pill>
          )
        }
      />
      <div className="flex flex-col gap-4 px-5 pb-5">
        <div className="flex items-center gap-3">
          <Avatar person={s} size="md" />
          <div className="min-w-0">
            {s.isNew ? (
              <p className="font-medium">{fullName(s)}</p>
            ) : (
              <Link
                to="/clients/$clientId"
                params={{ clientId: s.clientId }}
                className="rounded font-medium underline decoration-line-strong underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink"
              >
                {fullName(s)}
              </Link>
            )}
            <p className="num text-[0.8125rem] text-ink-2">
              {s.birthDate
                ? `Born ${fmt.date(s.birthDate)}${s.age !== null ? ` · ${s.age} years old` : ""}`
                : "No birth date"}
            </p>
          </div>
        </div>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <KeyValue label="Phone">
            <span className="num">{s.phone ?? "—"}</span>
          </KeyValue>
          <KeyValue label="Email">
            <span className="break-all">{s.email ?? "—"}</span>
          </KeyValue>
          {s.minor ? (
            <KeyValue label="Parent or guardian">
              <span className="num">
                {[s.guardianName, s.guardianPhone].filter(Boolean).join(" · ") || "—"}
              </span>
            </KeyValue>
          ) : null}
          <KeyValue label="Sent by">
            {sub.name}
            <span className="block text-[0.8125rem] text-ink-2">
              {sub.relation ? FAMILY_RELATION_LABELS[sub.relation] : "Family"} ·{" "}
              {sub.signIn === "google" ? (sub.email ?? "Google") : "Passkey account"}
            </span>
          </KeyValue>
        </dl>
        {s.isNew && d.matches.length && (d.status === "requested" || d.status === "waitlisted") ? (
          <Warn>
            {plural(d.matches.length, "person", "people")} already training here may be{" "}
            {s.firstName}: {d.matches.map((m) => fullName(m)).join(", ")}. You can approve onto
            their record from Approve.
          </Warn>
        ) : null}
      </div>
    </Card>
  );
}

function AnswersCard({ d }: { d: Detail }) {
  const a = d.answers;
  const rating =
    a.selfRating !== null
      ? `${a.selfRating.toFixed(1)} · ${selfRatingHint(a.selfRating)}`
      : a.selfRatingUnsure
        ? "Not sure"
        : null;
  const emergency = [a.emergencyName, a.emergencyPhone].filter(Boolean).join(" · ");
  return (
    <Card label="Answers">
      <CardHeader title="Answers" />
      <dl className="grid gap-x-6 gap-y-3 px-5 pb-5 sm:grid-cols-2">
        {d.tier?.asksSelfRating || rating ? (
          <KeyValue label="Self-rating" className="sm:col-span-2">
            <span className="num">{rating ?? "—"}</span>
          </KeyValue>
        ) : null}
        {d.tier?.includesUniform || a.shirtSize ? (
          <KeyValue label="Uniform size">{a.shirtSize ?? "—"}</KeyValue>
        ) : null}
        <KeyValue label="Emergency contact">
          <span className="num">{emergency || "—"}</span>
        </KeyValue>
        <KeyValue label="Medical notes" className="sm:col-span-2">
          <span className="whitespace-pre-line">{a.medicalNotes ?? "None given"}</span>
        </KeyValue>
        {a.notes ? (
          <KeyValue label="Anything else" className="sm:col-span-2">
            <span className="whitespace-pre-line">{a.notes}</span>
          </KeyValue>
        ) : null}
      </dl>
    </Card>
  );
}

function PickupsCard({ d }: { d: Detail }) {
  return (
    <Card label="Authorized pickups">
      <CardHeader
        title="Authorized pickups"
        action={d.pickups.length ? <Pill tone="panel">{d.pickups.length}</Pill> : null}
      />
      {d.pickups.length ? (
        <ul className="flex flex-col divide-y divide-line px-5 pb-4">
          {d.pickups.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2.5">
              <span className="font-medium">
                {p.name}
                {p.relationship ? (
                  <span className="font-normal text-ink-2"> · {p.relationship}</span>
                ) : null}
              </span>
              <span className="num text-[0.875rem] text-ink-2">{p.phone ?? "No phone"}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 pb-5 text-[0.9375rem] text-ink-2">
          No one besides the parent or guardian.
        </p>
      )}
    </Card>
  );
}

function PackageCard({ d, fmt }: { d: Detail; fmt: Format }) {
  const t = d.tier;
  const s = d.period.session;
  return (
    <Card label="Package">
      <CardHeader
        title="Package"
        action={t ? <span className="num text-[1.125rem]">{fmt.money(t.priceMinor)}</span> : null}
      />
      {t ? (
        <div className="flex flex-col gap-4 px-5 pb-5">
          <div>
            <p className="font-medium">{t.name}</p>
            <p className="num text-[0.875rem] text-ink-2">
              {[
                t.sessionsLabel ?? plural(t.credits, "session"),
                templateValidityText(t),
                t.includesUniform ? "Uniform included" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {t.inclusions.length ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {t.inclusions.map((i) => (
                  <li key={i}>
                    <Pill tone="outline">{i}</Pill>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <KeyValue label="Program">{d.program?.name ?? "—"}</KeyValue>
            {d.mode === "month" ? (
              <KeyValue label="Month">
                <span className="num">
                  {d.period.startMonth ? fmt.month(d.period.startMonth) : "—"}
                  {d.period.expiresOn ? (
                    <span className="block text-[0.8125rem] text-ink-2">
                      Valid to {fmt.date(d.period.expiresOn)}
                    </span>
                  ) : null}
                </span>
              </KeyValue>
            ) : d.mode === "session" ? (
              <KeyValue label="Session">
                {s ? (
                  <span className="num">
                    <span className="whitespace-nowrap">{fmt.day(fmt.dayOf(s.startsAt))}</span> ·{" "}
                    <span className="whitespace-nowrap">{fmt.timeRange(s.startsAt, s.endsAt)}</span>
                    <span className="block text-[0.8125rem] text-ink-2">
                      {s.venueName || (s.court ? null : "Venue to confirm")}
                      {s.court ? (
                        <span className="whitespace-nowrap">
                          {s.venueName ? " · " : ""}Court {s.court}
                        </span>
                      ) : null}
                      {s.status !== "scheduled" ? ` · ${s.status}` : ""}
                    </span>
                  </span>
                ) : (
                  "—"
                )}
              </KeyValue>
            ) : (
              <KeyValue label="Starts">
                <span className="num">
                  {d.period.startsOn ? fmt.date(d.period.startsOn) : "—"}
                  {d.period.expiresOn ? (
                    <span className="block text-[0.8125rem] text-ink-2">
                      Valid to {fmt.date(d.period.expiresOn)}
                    </span>
                  ) : null}
                </span>
              </KeyValue>
            )}
          </dl>
        </div>
      ) : (
        <p className="px-5 pb-5 text-[0.9375rem] text-ink-2">
          The package this request was for was deleted.
        </p>
      )}
    </Card>
  );
}

function CapacityCard({ d, fmt }: { d: Detail; fmt: Format }) {
  const c = d.capacity;
  if (!c) return null;
  const what = c.kind === "session" ? "Session" : "Program";
  return (
    <Card label={`${what} places`}>
      <CardHeader
        title={`${what} places`}
        action={
          c.over ? <Pill tone="coral">Full</Pill> : c.alreadyIn ? <Pill tone="mint">In</Pill> : null
        }
      />
      <div className="flex flex-col gap-2 px-5 pb-5">
        {c.capacity === null ? (
          <p className="num text-[0.9375rem]">
            No size limit ·{" "}
            {plural(
              c.taken,
              c.kind === "session" ? "booked" : "member",
              c.kind === "session" ? "booked" : "members",
            )}
          </p>
        ) : (
          <>
            <p className="num text-[0.9375rem]">
              {c.taken} of {c.capacity} {c.kind === "session" ? "booked" : "places taken"}
              <span className="text-ink-2">
                {" · "}
                {c.left !== null && c.left > 0 ? `${c.left} left` : "none left"}
              </span>
            </p>
            <Meter value={c.taken} max={c.capacity} tone={c.over ? "coral" : "ink"} />
          </>
        )}
        {c.alreadyIn ? (
          <p className="text-[0.875rem] text-ink-2">
            {d.student.firstName} is already {c.kind === "session" ? "booked" : "a member"}.
          </p>
        ) : null}
        {c.kind === "session" && d.period.session ? (
          <p className="num text-[0.8125rem] text-ink-2">
            {fmt.day(fmt.dayOf(d.period.session.startsAt))}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * What's owed: before approval, what approving charges; after, the charge, how much payments
 * cover, and the proofs the family sent for it (confirm or not accept them right here).
 */
function PaymentCard({ d, fmt }: { d: Detail; fmt: Format }) {
  const p = d.payment;
  const proofs = d.proofs ?? [];
  const pill = p ? requestPayPill(p, proofs) : null;
  return (
    <Card label="Payment">
      <CardHeader
        title="Payment"
        action={pill ? <Pill tone={pill.tone}>{pill.label}</Pill> : null}
      />
      <div className="flex flex-col gap-3 px-5 pb-5">
        {p ? (
          <>
            <dl className="grid grid-cols-3 gap-3">
              <KeyValue label="Charged">
                <span className="num">{fmt.money(p.amountMinor)}</span>
              </KeyValue>
              <KeyValue label="Paid">
                <span className="num">{fmt.money(p.paidMinor)}</span>
              </KeyValue>
              <KeyValue label="To pay">
                <span className="num font-medium">{fmt.money(p.dueMinor)}</span>
              </KeyValue>
            </dl>
            {proofs.length ? (
              <section aria-label="Payment proofs" className="border-t border-line pt-3">
                <h3 className="text-[0.9375rem] font-medium">From the family</h3>
                <ProofList proofs={proofs} fmt={fmt} context="request" />
              </section>
            ) : p.dueMinor > 0 ? (
              <p className="text-[0.875rem] text-ink-2">
                The family sees the amount and your payment instructions in their portal. A
                screenshot they send shows here to confirm; you can also record a payment from{" "}
                {d.student.firstName}'s profile or Money.
              </p>
            ) : null}
          </>
        ) : d.status === "approved" ? (
          <p className="text-[0.9375rem] text-ink-2">Nothing to pay for this one.</p>
        ) : d.tier && d.tier.priceMinor > 0 ? (
          <p className="text-[0.9375rem] text-ink-2">
            Not charged yet. Approving adds a{" "}
            <span className="num text-ink">{fmt.money(d.tier.priceMinor)}</span> charge.
          </p>
        ) : (
          <p className="text-[0.9375rem] text-ink-2">Free: approving adds no charge.</p>
        )}
      </div>
    </Card>
  );
}

function ConsentsCard({ d, fmt }: { d: Detail; fmt: Format }) {
  return (
    <Card label="Consents">
      <CardHeader
        title="Consents"
        action={d.consents.length ? <Pill tone="panel">{d.consents.length}</Pill> : null}
      />
      <div className="flex flex-col gap-3 px-5 pb-5">
        {d.consents.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {d.consents.map((c) => (
              <li key={`${c.documentId}-${c.version}`} className="py-2.5 first:pt-0">
                <p className="font-medium">
                  {c.title} <span className="num font-normal text-ink-2">v{c.version}</span>
                </p>
                <p className="num text-[0.8125rem] text-ink-2">
                  Signed by {c.signerName}, {SIGNER[c.relation]} · {fmt.date(fmt.dayOf(c.signedAt))}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.9375rem] text-ink-2">
            None signed with this request
            {d.consentsMissing ? "" : ": nothing was required, or it was already on file"}.
          </p>
        )}
        {d.consentsMissing > 0 ? (
          <Warn>
            {plural(d.consentsMissing, "required document")} still to sign (added or changed since
            the request).
          </Warn>
        ) : null}
      </div>
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-11 w-72" />
        <Skeleton className="h-4 w-60" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-56 rounded-[28px]" />
        <Skeleton className="h-56 rounded-[28px]" />
      </div>
    </div>
  );
}
