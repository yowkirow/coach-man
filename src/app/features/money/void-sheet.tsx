import type { StatementDto } from "@shared/api-types";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { InlineError } from "../../components/ui/feedback";
import { TextField } from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { useFormat } from "../../lib/format";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { OfflineNote } from "../settings/offline";
import { balanceText, personOf } from "./money-data";
import { useInvalidateMoney } from "./record-payment-sheet";

export interface VoidTarget {
  type: "payment" | "charge";
  id: string;
  clientId: string;
  clientName: string;
  amountMinor: number;
  /** What the line was for, e.g. "Bank transfer" or "Ball fee". */
  detail: string;
}

/** Voids a payment or a manual charge. The line stays on record, struck through. */
export function VoidSheet({
  target,
  onOpenChange,
}: {
  target: VoidTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const invalidate = useInvalidateMoney();
  const [reason, setReason] = useState("");
  // Keep the last target while the sheet animates closed.
  const [shown, setShown] = useState<VoidTarget | null>(target);

  const run = useMutation({
    meta: { silent: true },
    mutationFn: (t: VoidTarget) =>
      api.post<StatementDto>(`/${t.type === "payment" ? "payments" : "charges"}/${t.id}/void`, {
        reason: reason.trim() || null,
      }),
    onSuccess: (statement, t) => {
      invalidate(t.clientId);
      notify({
        tone: "success",
        title: t.type === "payment" ? "Payment voided" : "Charge voided",
        body: balanceText(personOf(t.clientName).firstName, statement.balanceMinor, fmt),
      });
      onOpenChange(false);
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when a new line is chosen.
  useEffect(() => {
    if (!target) return;
    setShown(target);
    setReason("");
    run.reset();
  }, [target?.id]);

  const t = target ?? shown;
  const isPayment = t?.type === "payment";
  const first = t ? personOf(t.clientName).firstName : "";

  return (
    <Sheet
      isOpen={target !== null}
      onOpenChange={onOpenChange}
      title={isPayment ? "Void payment" : "Void charge"}
      description={t ? `${fmt.money(t.amountMinor)} · ${t.clientName} · ${t.detail}` : undefined}
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Keep it
          </Button>
          <Button
            variant="danger"
            isDisabled={!online || !t}
            isPending={run.isPending}
            onPress={() => t && run.mutate(t)}
          >
            {isPayment ? "Void payment" : "Void charge"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (t && online) run.mutate(t);
        }}
      >
        <p className="text-ink-2">
          {isPayment
            ? `It stays on record, struck through, and ${first}'s balance goes back up by ${t ? fmt.money(t.amountMinor) : ""}. Their other payments are re-applied to the oldest charges.`
            : `It stays on record, struck through, and comes off ${first}'s balance.`}
        </p>
        <TextField
          label="Reason (optional)"
          value={reason}
          onChange={setReason}
          placeholder={isPayment ? "Bounced transfer, recorded twice…" : "Entered by mistake…"}
          error={fieldErrors(run.error).reason}
        />
        {run.error ? <InlineError>{errorMessage(run.error)}</InlineError> : null}
        <OfflineNote>You're offline. Reconnect to void this.</OfflineNote>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
