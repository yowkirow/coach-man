import type { PortalPaymentProofDto } from "@shared/api-types";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Pill } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { ConfirmSheet } from "../../components/ui/overlay";
import { errorMessage, portalApi, portalFileUrl } from "../../lib/api";
import type { Format } from "../../lib/format";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { ProofThumb } from "../payment-proofs/proof-image";
import { usePortalProofs, useRefreshPortalPayments } from "../payment-proofs/queries";
import { proofStatusPill } from "../payment-proofs/text";
import { PortalCard } from "./bits";

const inlineLink =
  "inline-flex items-center gap-1 rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ink";

/** One proof the family sent: what, where it stands, and what they can do next. */
export function PortalProofRow({
  proof: p,
  fmt,
  academyName,
}: {
  proof: PortalPaymentProofDto;
  fmt: Format;
  academyName: string;
}) {
  const online = useOnline();
  const refresh = useRefreshPortalPayments();
  const [confirming, setConfirming] = useState(false);
  const withdraw = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      portalApi.post<PortalPaymentProofDto>(
        `/students/${encodeURIComponent(p.clientId)}/payment-proofs/${encodeURIComponent(p.id)}/withdraw`,
      ),
    onSuccess: () => {
      setConfirming(false);
      notify({ tone: "success", title: "Proof withdrawn" });
      refresh();
    },
  });
  const pill = proofStatusPill(p.status);
  const headingId = `portal-proof-${p.id}`;
  const sent = fmt.day(fmt.dayOf(p.createdAt));
  const facts = [
    p.reference ? `Ref ${p.reference}` : p.proofKey ? null : "Cash at the court",
    `Paid ${fmt.day(p.paidOn)}`,
    p.sentBy.you ? "sent by you" : `sent by ${p.sentBy.name}`,
  ].filter(Boolean);
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <article aria-labelledby={headingId} className="flex gap-3">
        <ProofThumb
          src={portalFileUrl(p.proofKey)}
          label={`Payment screenshot sent ${sent}`}
          description={`${fmt.money(p.amountMinor)} · ${p.method}`}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 id={headingId} className="num font-medium">
              {fmt.money(p.amountMinor)} · {p.method}
            </h3>
            <Pill tone={pill.tone}>{pill.label}</Pill>
          </div>
          <p className="num text-[0.8125rem] text-ink-2">{facts.join(" · ")}</p>
          {p.status === "pending" ? (
            <p className="mt-1 text-[0.875rem]">
              Sent {sent}. {academyName} checks it, then records your payment.
            </p>
          ) : p.status === "confirmed" ? (
            <p className="num mt-1 text-[0.875rem]">
              Confirmed{p.decidedAt ? ` ${fmt.day(fmt.dayOf(p.decidedAt))}` : ""}.
              {p.recorded && p.recorded.amountMinor !== p.amountMinor
                ? ` ${academyName} recorded ${fmt.money(p.recorded.amountMinor)}.`
                : " It's in your payment history."}
            </p>
          ) : p.status === "rejected" ? (
            <div className="mt-1.5 flex flex-col gap-1.5">
              <p className="rounded-[14px] bg-coral-soft px-3 py-2 text-[0.875rem]">
                {academyName}'s reason: <span className="font-medium">{p.rejectReason}</span>
              </p>
              {p.resubmitted ? (
                <p className="text-[0.8125rem] text-ink-2">You sent a new proof for it.</p>
              ) : (
                <Link
                  to="/my/$clientId/pay"
                  params={{ clientId: p.clientId }}
                  search={{
                    resubmit: p.id,
                    ...(p.enrollmentId ? { request: p.enrollmentId } : {}),
                  }}
                  className={`${inlineLink} self-start text-[0.875rem]`}
                >
                  Send a new proof
                  <ArrowUpRight aria-hidden className="size-4" />
                </Link>
              )}
            </div>
          ) : p.status === "voided" ? (
            <p className="mt-1.5 rounded-[14px] bg-amber-soft px-3 py-2 text-[0.875rem]">
              {academyName} voided the payment it recorded for this proof. They'll review it again
              or get in touch.
            </p>
          ) : (
            <p className="mt-1 text-[0.875rem] text-ink-2">
              Withdrawn{p.sentBy.you ? " by you" : ""}.
            </p>
          )}
          {p.canWithdraw ? (
            <div className="mt-2">
              <Button
                variant="light"
                size="sm"
                isDisabled={!online}
                onPress={() => setConfirming(true)}
              >
                Withdraw
              </Button>
            </div>
          ) : null}
        </div>
      </article>
      <ConfirmSheet
        isOpen={confirming}
        onOpenChange={(o) => {
          setConfirming(o);
          if (!o) withdraw.reset();
        }}
        title="Withdraw this proof?"
        body={
          <div className="flex flex-col gap-3">
            <p>
              {academyName} won't review your {fmt.money(p.amountMinor)} proof. You can send a new
              one any time.
            </p>
            {withdraw.error ? <InlineError>{errorMessage(withdraw.error)}</InlineError> : null}
          </div>
        }
        confirmLabel="Withdraw"
        isPending={withdraw.isPending}
        onConfirm={() => withdraw.mutate()}
      />
    </li>
  );
}

/** "Payment proofs" on Payments: every proof sent for the student, newest first. */
export function PortalProofsCard({
  clientId,
  fmt,
  academyName,
}: {
  clientId: string;
  fmt: Format;
  academyName: string;
}) {
  const q = usePortalProofs(clientId);
  const proofs = q.data?.proofs ?? [];
  if (!proofs.length) return null;
  return (
    <PortalCard title="Payment proofs">
      <ul className="flex flex-col divide-y divide-line">
        {proofs.map((p) => (
          <PortalProofRow key={p.id} proof={p} fmt={fmt} academyName={academyName} />
        ))}
      </ul>
    </PortalCard>
  );
}
