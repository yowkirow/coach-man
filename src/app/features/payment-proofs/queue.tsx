import { PROOF_STATUS_LABELS } from "@shared/payment-proofs";
import { useState } from "react";
import { Pill } from "../../components/ui/display";
import { ErrorState, RowsSkeleton } from "../../components/ui/feedback";
import { errorMessage } from "../../lib/api";
import type { Format } from "../../lib/format";
import { type ProofFilter, usePaymentProofs } from "./queries";
import { NoProofs, ProofList } from "./review";

const FILTER_LABELS: Record<"pending" | "voided" | "all", string> = {
  pending: "To review",
  voided: PROOF_STATUS_LABELS.voided,
  all: "All recent",
};

/**
 * "Payments to review" on the Money page: proofs families sent from the portal, oldest first, each
 * confirmed (a payment is recorded) or not accepted right here. Proofs whose payment was voided
 * get their own list, and "All recent" is the history.
 */
export function ProofQueue({ fmt }: { fmt: Format }) {
  const [filter, setFilter] = useState<"pending" | "voided" | "all">("pending");
  const list = usePaymentProofs(filter as ProofFilter);
  const counts = list.data?.counts;
  const pending = counts?.pending ?? 0;
  const voided = counts?.voided ?? 0;
  const filters = (["pending", "voided", "all"] as const).filter(
    (f) => f !== "voided" || voided > 0 || filter === "voided",
  );
  const chip = (on: boolean) =>
    `inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-4 text-[0.875rem] font-medium whitespace-nowrap outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
      on ? "bg-ink text-white" : "bg-panel text-ink hover:bg-line"
    }`;
  return (
    <section
      id="payments-to-review"
      aria-labelledby="payments-to-review-heading"
      className="scroll-mt-4 rounded-[28px] bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-2">
        <div className="flex items-center gap-2.5">
          <h2 id="payments-to-review-heading" className="text-[1.125rem] font-medium">
            Payments to review
          </h2>
          {pending ? (
            <Pill tone="sky">
              <span className="num">{pending}</span> waiting
            </Pill>
          ) : null}
        </div>
        <ul aria-label="Show" className="flex flex-wrap gap-1.5">
          {filters.map((f) => {
            const n = f === "pending" ? counts?.pending : f === "voided" ? counts?.voided : null;
            return (
              <li key={f}>
                <button
                  type="button"
                  aria-pressed={filter === f}
                  className={chip(filter === f)}
                  onClick={() => setFilter(f)}
                >
                  {FILTER_LABELS[f]}
                  {n !== null && n !== undefined ? (
                    <span className={`num ${filter === f ? "text-white/70" : "text-ink-2"}`}>
                      {n}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="px-5 pb-3">
        {list.isPending && !list.data ? (
          <RowsSkeleton rows={2} />
        ) : !list.data ? (
          <ErrorState
            title="Couldn't load payment proofs"
            message={errorMessage(list.error)}
            onRetry={() => void list.refetch()}
          />
        ) : list.data.items.length ? (
          <div aria-busy={list.isPlaceholderData}>
            <ProofList proofs={list.data.items} fmt={fmt} context="queue" />
          </div>
        ) : (
          <div className="pb-2">
            <NoProofs>
              {filter === "pending"
                ? "Nothing to review. When a family sends a payment screenshot, or says they'll pay cash at the court, it waits here for you to confirm."
                : filter === "voided"
                  ? "No proofs with a voided payment."
                  : "No payment proofs yet. Families send them from Payments in their portal."}
            </NoProofs>
          </div>
        )}
      </div>
    </section>
  );
}
