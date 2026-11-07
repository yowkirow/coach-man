import type { PaymentProofDto, ProofDuplicateDto } from "@shared/api-types";
import { FAMILY_RELATION_LABELS } from "@shared/domain";
import { isReviewableProof, PROOF_REJECT_REASONS } from "@shared/payment-proofs";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, ReceiptText, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Pill } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { MoneyField, SelectField, TextAreaField, TextField } from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors, fileUrl } from "../../lib/api";
import { type Format, fullName } from "../../lib/format";
import { useMe } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { periodText } from "../enrollment/text";
import { balanceText } from "../money/money-data";
import { useInvalidateMoney } from "../money/record-payment-sheet";
import { OfflineNote } from "../settings/offline";
import { ProofThumb } from "./proof-image";
import { useInvalidateProofs } from "./queries";
import { proofStatusPill } from "./text";

// Reviewing payment proofs (owners and admins): one dense row per proof with the screenshot, what
// the family says they paid, who sent it, what it pays, duplicate warnings, and Confirm (records
// the payment) or Not accepted (with the reason the family reads).

/** Where a proof list sits: the Money queue shows everything, a student's or a request's less. */
export type ProofContext = "queue" | "client" | "request";

function who(p: PaymentProofDto): string {
  const relation = p.submitter.relation;
  if (relation === "self") return `${p.submitter.name}, the student`;
  if (relation === "guardian")
    return `${p.submitter.name}, ${FAMILY_RELATION_LABELS.guardian.toLowerCase()}`;
  return p.submitter.name;
}

/**
 * "Same reference as Ana Cruz's recorded payment (₱1,500.00 · GCash · Thu 5 Nov)", or "Same
 * student, amount, and date as another proof (GCash · Ref GC-4243 · Pending review)".
 */
function duplicateText(d: ProofDuplicateDto, fmt: Format): string {
  const what = d.kind === "proof" ? "proof" : "recorded payment";
  const status =
    d.kind === "proof"
      ? proofStatusPill(d.status === "recorded" ? "confirmed" : d.status).label
      : null;
  if (d.reason === "reference") {
    const facts = [fmt.money(d.amountMinor), d.method, fmt.day(d.paidOn), status];
    return `Same reference as ${d.clientName}'s ${what} (${facts.filter(Boolean).join(" · ")})`;
  }
  const facts = [d.method, d.reference ? `Ref ${d.reference}` : "no reference", status];
  return `Same student, amount, and date as another ${what} (${facts.filter(Boolean).join(" · ")})`;
}

function Callout({ tone, children }: { tone: "amber" | "coral" | "panel"; children: ReactNode }) {
  const bg = tone === "amber" ? "bg-amber-soft" : tone === "coral" ? "bg-coral-soft" : "bg-panel";
  return (
    <div className={`mt-2.5 flex gap-2 rounded-2xl px-3.5 py-2.5 text-[0.875rem] ${bg}`}>
      {tone === "panel" ? null : <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** One proof: everything needed to decide it at a glance, and the decision or the actions. */
export function ProofItem({
  proof: p,
  fmt,
  context,
  onConfirm,
  onReject,
}: {
  proof: PaymentProofDto;
  fmt: Format;
  context: ProofContext;
  onConfirm: (p: PaymentProofDto) => void;
  onReject: (p: PaymentProofDto) => void;
}) {
  const online = useOnline();
  const status = proofStatusPill(p.status);
  const name = fullName(p.student);
  const reviewable = isReviewableProof(p.status);
  const headingId = `proof-${p.id}`;
  const facts = [
    p.method,
    p.reference ? `Ref ${p.reference}` : "No reference",
    `Paid ${fmt.day(p.paidOn)}`,
  ];
  const by = p.reviewedBy?.name;
  const when = p.reviewedAt ? fmt.day(fmt.dayOf(p.reviewedAt)) : null;
  return (
    <li>
      <article aria-labelledby={headingId} className="flex gap-3 py-4 sm:gap-4">
        <ProofThumb
          src={fileUrl(p.proofKey)}
          label={`${name}'s payment screenshot`}
          description={`${fmt.money(p.amountMinor)} · ${facts.join(" · ")}`}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <h3 id={headingId} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              {context === "queue" ? (
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: p.student.clientId }}
                  search={{ tab: "money" }}
                  className="rounded-md font-medium underline decoration-line-strong underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink"
                >
                  {name}
                </Link>
              ) : (
                <span className="sr-only">{name}: </span>
              )}
              <span className="num text-[1rem] font-medium">{fmt.money(p.amountMinor)}</span>
              <Pill tone={status.tone}>{status.label}</Pill>
              {p.duplicates.length ? <Pill tone="amber">Possible duplicate</Pill> : null}
            </h3>
          </div>
          <p className="num mt-1 text-[0.875rem] text-ink-2">{facts.join(" · ")}</p>
          <p className="num text-[0.8125rem] text-ink-2">
            {p.proofKey ? "Screenshot from " : "Cash at the court, says "}
            {who(p)} · sent {fmt.day(fmt.dayOf(p.createdAt))}, {fmt.time(p.createdAt)}
          </p>
          {context !== "request" && p.enrollment ? (
            <p className="num text-[0.8125rem] text-ink-2">
              For{" "}
              <Link
                to="/enrollments/$requestId"
                params={{ requestId: p.enrollment.id }}
                className="rounded-sm font-medium text-ink underline decoration-line-strong underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink"
              >
                {p.enrollment.tierName} · {periodText(p.enrollment, fmt)}
              </Link>
              {p.enrollment.payment
                ? ` · ${
                    p.enrollment.payment.dueMinor > 0
                      ? `${fmt.money(p.enrollment.payment.dueMinor)} still due`
                      : "paid"
                  }`
                : ""}
            </p>
          ) : null}
          {context === "queue" ? (
            <p className="num text-[0.8125rem] text-ink-2">
              {balanceText(p.student.firstName, p.student.balanceMinor, fmt)}
            </p>
          ) : null}
          {p.note ? (
            <p className="mt-1.5 max-w-[60ch] text-[0.875rem] whitespace-pre-line">“{p.note}”</p>
          ) : null}
          {p.resubmitOf ? (
            <p className="mt-1 text-[0.8125rem] text-ink-2">
              Sent again after an earlier proof wasn't accepted
              {p.resubmitOf.rejectReason ? `: “${p.resubmitOf.rejectReason}”` : ""}
            </p>
          ) : null}
          {reviewable && p.duplicates.length ? (
            <Callout tone="amber">
              <p className="font-medium">Check this isn't counted already</p>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {p.duplicates.map((d) => (
                  <li key={`${d.kind}-${d.id}`} className="num">
                    {duplicateText(d, fmt)}
                  </li>
                ))}
              </ul>
            </Callout>
          ) : null}
          {p.status === "voided" ? (
            <Callout tone="amber">
              The payment confirming it recorded
              {p.payment ? ` (${fmt.money(p.payment.amountMinor)})` : ""} was voided. Confirm it
              again to record a new payment, or mark it not accepted.
            </Callout>
          ) : null}
          {p.status === "rejected" ? (
            <Callout tone="coral">
              Not accepted{by ? ` by ${by}` : ""}
              {when ? ` on ${when}` : ""}: “{p.rejectReason}”
              {p.resubmittedBy ? (
                <span className="block text-ink-2">The family sent a new proof.</span>
              ) : null}
            </Callout>
          ) : null}
          {p.status === "confirmed" ? (
            <p className="num mt-2 flex flex-wrap items-center gap-x-1.5 text-[0.8125rem] text-ink-2">
              <Check aria-hidden className="size-4 text-ink" />
              Confirmed{by ? ` by ${by}` : ""}
              {when ? ` on ${when}` : ""}
              {p.payment
                ? ` · ${fmt.money(p.payment.amountMinor)} recorded as paid ${fmt.day(p.payment.paidOn)}`
                : ""}
            </p>
          ) : null}
          {p.status === "withdrawn" ? (
            <p className="mt-2 text-[0.8125rem] text-ink-2">Withdrawn by the family.</p>
          ) : null}
          {reviewable ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="dark"
                size="sm"
                icon={<Check aria-hidden className="size-4" />}
                isDisabled={!online}
                onPress={() => onConfirm(p)}
              >
                {p.status === "voided" ? "Confirm again" : "Confirm"}
              </Button>
              <Button variant="light" size="sm" isDisabled={!online} onPress={() => onReject(p)}>
                Not accepted
              </Button>
            </div>
          ) : null}
        </div>
      </article>
    </li>
  );
}

/** A list of proofs with the confirm and not-accepted sheets they open. */
export function ProofList({
  proofs,
  fmt,
  context,
}: {
  proofs: PaymentProofDto[];
  fmt: Format;
  context: ProofContext;
}) {
  const [confirming, setConfirming] = useState<PaymentProofDto | null>(null);
  const [rejecting, setRejecting] = useState<PaymentProofDto | null>(null);
  return (
    <>
      <ul className="flex flex-col divide-y divide-line">
        {proofs.map((p) => (
          <ProofItem
            key={p.id}
            proof={p}
            fmt={fmt}
            context={context}
            onConfirm={setConfirming}
            onReject={setRejecting}
          />
        ))}
      </ul>
      <ConfirmProofSheet proof={confirming} fmt={fmt} onClose={() => setConfirming(null)} />
      <RejectProofSheet proof={rejecting} fmt={fmt} onClose={() => setRejecting(null)} />
    </>
  );
}

/** Keeps the last proof while a sheet animates closed. */
function useShown(proof: PaymentProofDto | null) {
  const [shown, setShown] = useState(proof);
  useEffect(() => {
    if (proof) setShown(proof);
  }, [proof]);
  return proof ?? shown;
}

/**
 * Confirming records the payment: what the family sent, unless the screenshot shows something
 * else. Amount, method, date, and reference can change here; the note is for staff only.
 */
export function ConfirmProofSheet({
  proof,
  fmt,
  onClose,
}: {
  proof: PaymentProofDto | null;
  fmt: Format;
  onClose: () => void;
}) {
  const online = useOnline();
  const methods = useMe().data?.settings.paymentMethods ?? [];
  const invalidateMoney = useInvalidateMoney();
  const invalidateProofs = useInvalidateProofs();
  const p = useShown(proof);
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const run = useMutation({
    meta: { silent: true },
    mutationFn: (target: PaymentProofDto) =>
      api.post<PaymentProofDto>(`/payment-proofs/${target.id}/confirm`, {
        amountMinor: amount ?? undefined,
        method,
        paidOn,
        reference: reference.trim() || null,
        note: note.trim() || null,
      }),
    onSuccess: (done) => {
      invalidateMoney(done.student.clientId);
      invalidateProofs();
      notify({
        tone: "success",
        title: `${fmt.money(done.payment?.amountMinor ?? amount ?? 0)} recorded`,
        body: balanceText(done.student.firstName, done.student.balanceMinor, fmt),
      });
      onClose();
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when another proof opens.
  useEffect(() => {
    if (!proof) return;
    setAmount(proof.amountMinor);
    setMethod(proof.method);
    // Cash at the court is confirmed once it's handed over: today by default.
    setPaidOn(proof.proofKey ? proof.paidOn : fmt.today());
    setReference(proof.reference ?? "");
    setNote("");
    run.reset();
  }, [proof?.id]);

  const options = [...new Set([...methods, ...(p ? [p.method] : [])])].map((m) => ({
    id: m,
    label: m,
  }));
  const errs = fieldErrors(run.error);
  const changed = p && amount !== null && amount !== p.amountMinor;
  const first = p?.student.firstName ?? "";
  const submit = () => p && amount && online && run.mutate(p);
  return (
    <Sheet
      isOpen={proof !== null}
      onOpenChange={(o) => !o && onClose()}
      title={`Confirm ${first}'s payment`}
      description="Records the payment. It settles the oldest unpaid charges first."
      footer={
        <>
          <Button variant="light" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="dark"
            isDisabled={!amount || !online || !method || !paidOn}
            isPending={run.isPending}
            onPress={submit}
          >
            {amount ? `Record ${fmt.money(amount)}` : "Record payment"}
          </Button>
        </>
      }
    >
      {p ? (
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex items-center gap-3 rounded-[22px] bg-panel p-3">
            <ProofThumb
              src={fileUrl(p.proofKey)}
              label={`${fullName(p.student)}'s payment screenshot`}
              size="sm"
            />
            <div className="min-w-0 text-[0.875rem]">
              <p className="font-medium">
                {fullName(p.student)} sent <span className="num">{fmt.money(p.amountMinor)}</span>
              </p>
              <p className="num text-ink-2">
                {[p.method, p.reference ? `Ref ${p.reference}` : null, fmt.day(p.paidOn)]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="num text-ink-2">
                {balanceText(p.student.firstName, p.student.balanceMinor, fmt)}
              </p>
            </div>
          </div>
          {p.duplicates.length ? (
            <Callout tone="amber">
              <p className="font-medium">Check this isn't counted already</p>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {p.duplicates.map((d) => (
                  <li key={`${d.kind}-${d.id}`} className="num">
                    {duplicateText(d, fmt)}
                  </li>
                ))}
              </ul>
            </Callout>
          ) : null}
          <MoneyField
            label="Amount received"
            currency={fmt.currency}
            valueMinor={amount}
            onChange={setAmount}
            error={errs.amountMinor}
            description={
              changed
                ? `Different from the ${fmt.money(p.amountMinor)} the family sent. They'll see what you record.`
                : "What the screenshot shows. Change it if it says otherwise."
            }
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Method"
              options={options}
              value={method}
              onChange={setMethod}
              error={errs.method}
            />
            <TextField
              label="Date paid"
              type="date"
              value={paidOn}
              onChange={setPaidOn}
              max={fmt.today()}
              error={errs.paidOn}
            />
          </div>
          <TextField
            label="Reference (optional)"
            value={reference}
            onChange={setReference}
            error={errs.reference}
          />
          <TextField
            label="Note for staff (optional)"
            value={note}
            onChange={setNote}
            description="Kept with the payment. The family doesn't see it."
          />
          {run.error && !Object.keys(errs).length ? (
            <InlineError>{errorMessage(run.error)}</InlineError>
          ) : null}
          <OfflineNote>You're offline. Reconnect to record this payment.</OfflineNote>
          <button type="submit" hidden />
        </form>
      ) : null}
    </Sheet>
  );
}

/** Not accepted, with a reason the family reads (and can act on: a clearer screenshot, say). */
export function RejectProofSheet({
  proof,
  fmt,
  onClose,
}: {
  proof: PaymentProofDto | null;
  fmt: Format;
  onClose: () => void;
}) {
  const online = useOnline();
  const invalidateProofs = useInvalidateProofs();
  const p = useShown(proof);
  const [reason, setReason] = useState("");
  const run = useMutation({
    meta: { silent: true },
    mutationFn: (target: PaymentProofDto) =>
      api.post<PaymentProofDto>(`/payment-proofs/${target.id}/reject`, { reason: reason.trim() }),
    onSuccess: (done) => {
      invalidateProofs();
      notify({
        tone: "success",
        title: "Marked not accepted",
        body: `${done.student.firstName}'s family sees your reason and can send a new proof.`,
      });
      onClose();
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when another proof opens.
  useEffect(() => {
    if (!proof) return;
    setReason("");
    run.reset();
  }, [proof?.id]);
  const ready = reason.trim().length >= 2 && online;
  const submit = () => p && ready && run.mutate(p);
  return (
    <Sheet
      isOpen={proof !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Not accepted"
      description={
        p
          ? `${fullName(p.student)} · ${fmt.money(p.amountMinor)} · ${p.method}. The family sees your reason and can send a new proof.`
          : undefined
      }
      footer={
        <>
          <Button variant="light" onPress={onClose}>
            Keep it
          </Button>
          <Button variant="dark" isDisabled={!ready} isPending={run.isPending} onPress={submit}>
            Mark not accepted
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[0.8125rem] font-medium text-ink-2">Common reasons</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {PROOF_REJECT_REASONS.map((r) => (
              <Button
                key={r}
                variant={reason === r ? "dark" : "light"}
                size="sm"
                className="h-auto min-h-9 py-1.5 text-left whitespace-normal"
                onPress={() => setReason(r)}
              >
                {r}
              </Button>
            ))}
          </div>
        </fieldset>
        <TextAreaField
          label="Reason the family sees"
          value={reason}
          onChange={setReason}
          rows={3}
          error={fieldErrors(run.error).reason}
        />
        {run.error && !fieldErrors(run.error).reason ? (
          <InlineError>{errorMessage(run.error)}</InlineError>
        ) : null}
        <OfflineNote>You're offline. Reconnect to answer the family.</OfflineNote>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/** Empty lists say what lands there. */
export function NoProofs({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-3 py-2 text-[0.9375rem] text-ink-2">
      <ReceiptText aria-hidden className="mt-0.5 size-4.5 shrink-0" />
      <span className="max-w-[60ch]">{children}</span>
    </p>
  );
}
