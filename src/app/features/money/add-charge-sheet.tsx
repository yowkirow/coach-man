import type { StatementDto } from "@shared/api-types";
import { uuidv7 } from "@shared/ids";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ClientPicker } from "../../components/domain/lesson";
import { Button } from "../../components/ui/button";
import { InlineError } from "../../components/ui/feedback";
import { MoneyField, Segmented, TextField } from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { fullName, useFormat } from "../../lib/format";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { OfflineNote } from "../settings/offline";
import { balanceText } from "./money-data";
import { ChosenClient, type SelectedClient, useInvalidateMoney } from "./record-payment-sheet";

type ChargeType = "other" | "credit" | "debit";

const TYPES = [
  { id: "other", label: "Charge" },
  { id: "credit", label: "Credit" },
  { id: "debit", label: "Correction" },
] as const;

const PLACEHOLDERS: Record<ChargeType, string> = {
  other: "Ball fee, court booking, paddle…",
  credit: "Discount, goodwill, refund owed…",
  debit: "Missed fee, price correction…",
};

/**
 * Adds a one-off line to a client's balance: a charge ("other"), or an adjustment that raises
 * (correction) or lowers (credit) what they owe.
 */
export function AddChargeSheet({
  isOpen,
  onOpenChange,
  client: initialClient = null,
  lockClient = false,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  client?: SelectedClient | null;
  lockClient?: boolean;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const invalidate = useInvalidateMoney();
  const [client, setClient] = useState<SelectedClient | null>(initialClient);
  const [type, setType] = useState<ChargeType>("other");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [occurredOn, setOccurredOn] = useState(fmt.today());
  const [id, setId] = useState(uuidv7);

  const magnitude = amount === null ? null : Math.abs(amount);
  const signed = magnitude === null ? null : type === "credit" ? -magnitude : magnitude;

  const save = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      api.post<StatementDto>("/charges", {
        id,
        clientId: client?.id,
        kind: type === "other" ? "other" : "adjustment",
        description: description.trim(),
        amountMinor: signed,
        occurredOn,
      }),
    onSuccess: (statement) => {
      if (client) invalidate(client.id);
      notify({
        tone: "success",
        title:
          type === "credit"
            ? `${fmt.money(magnitude ?? 0)} credit added`
            : `${fmt.money(magnitude ?? 0)} charge added`,
        body: client ? balanceText(client.firstName, statement.balanceMinor, fmt) : undefined,
      });
      onOpenChange(false);
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when the sheet opens.
  useEffect(() => {
    if (!isOpen) return;
    setClient(initialClient);
    setType("other");
    setDescription("");
    setAmount(null);
    setOccurredOn(fmt.today());
    setId(uuidv7());
    save.reset();
  }, [isOpen]);

  const errs = fieldErrors(save.error);
  const ready = Boolean(client && description.trim() && magnitude);
  const projected =
    client?.balanceMinor !== undefined && signed !== null && magnitude
      ? client.balanceMinor + signed
      : null;

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Add charge"
      description="For anything outside sessions and packages. It goes on the client's balance."
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="dark"
            isDisabled={!ready || !online}
            isPending={save.isPending}
            onPress={() => save.mutate()}
          >
            {magnitude
              ? type === "credit"
                ? `Credit ${fmt.money(magnitude)}`
                : `Charge ${fmt.money(magnitude)}`
              : "Add charge"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && online) save.mutate();
        }}
      >
        {client ? (
          <ChosenClient
            client={client}
            hint={
              client.balanceMinor === undefined
                ? undefined
                : client.balanceMinor > 0
                  ? `Owes ${fmt.money(client.balanceMinor)}`
                  : client.balanceMinor < 0
                    ? `${fmt.money(-client.balanceMinor)} in credit`
                    : "Nothing owed"
            }
            onClear={lockClient ? undefined : () => setClient(null)}
          />
        ) : (
          <ClientPicker label="Client" autoFocus onSelect={(c) => setClient(c)} />
        )}
        <Segmented
          label="Type"
          options={TYPES.map((t) => ({ id: t.id, label: t.label }))}
          value={type}
          onChange={(v) => setType(v as ChargeType)}
        />
        <p className="-mt-3 text-[0.8125rem] text-ink-2">
          {type === "other"
            ? "Adds to what they owe."
            : type === "credit"
              ? "Takes an amount off what they owe."
              : "Fixes a balance that's too low. Adds to what they owe."}
        </p>
        <TextField
          label="What it's for"
          value={description}
          onChange={setDescription}
          placeholder={PLACEHOLDERS[type]}
          error={errs.description}
          autoFocus={Boolean(client)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            label="Amount"
            currency={fmt.currency}
            valueMinor={magnitude}
            onChange={setAmount}
            error={errs.amountMinor}
          />
          <TextField
            label="Date"
            type="date"
            value={occurredOn}
            onChange={setOccurredOn}
            error={errs.occurredOn}
          />
        </div>
        {client && projected !== null ? (
          <p className="rounded-2xl bg-panel px-4 py-3 text-[0.875rem] text-ink-2">
            {projected > 0
              ? `${fullName(client)} will owe ${fmt.money(projected)}.`
              : projected < 0
                ? `${fullName(client)} will have ${fmt.money(-projected)} in credit.`
                : `${fullName(client)} will be all paid up.`}
          </p>
        ) : null}
        {save.error ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
        <OfflineNote>You're offline. Reconnect to add this charge.</OfflineNote>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
