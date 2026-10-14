import type { PaymentDto } from "@shared/api-types";
import { uuidv7 } from "@shared/ids";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ClientPicker } from "../../components/domain/lesson";
import { Button } from "../../components/ui/button";
import { Avatar } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { MoneyField, Segmented, SelectField, TextField } from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { fullName, useFormat } from "../../lib/format";
import { useMe } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { keys } from "../../lib/query";

export interface SelectedClient {
  id: string;
  firstName: string;
  lastName: string;
  photoKey?: string | null;
  balanceMinor?: number;
}

/** Everything that shows a balance, payment, or credit count. */
export function useInvalidateMoney() {
  const qc = useQueryClient();
  return (clientId?: string) => {
    void qc.invalidateQueries({ queryKey: ["money"] });
    void qc.invalidateQueries({ queryKey: keys.balances });
    void qc.invalidateQueries({ queryKey: ["payments"] });
    void qc.invalidateQueries({ queryKey: ["clients"] });
    void qc.invalidateQueries({ queryKey: keys.today });
    if (clientId) {
      void qc.invalidateQueries({ queryKey: keys.client(clientId) });
      void qc.invalidateQueries({ queryKey: keys.statement(clientId) });
      void qc.invalidateQueries({ queryKey: keys.ledger(clientId) });
    }
  };
}

export function ChosenClient({
  client,
  onClear,
  hint,
}: {
  client: SelectedClient;
  onClear?: () => void;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[22px] bg-panel p-3">
      <Avatar person={client} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{fullName(client)}</p>
        {hint ? <p className="truncate text-[0.8125rem] text-ink-2">{hint}</p> : null}
      </div>
      {onClear ? (
        <Button variant="ghost" size="sm" onPress={onClear}>
          Change
        </Button>
      ) : null}
    </div>
  );
}

export function PaymentMethodField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const methods = useMe().data?.settings.paymentMethods ?? ["Cash"];
  if (methods.length <= 3) {
    return (
      <Segmented
        label="Method"
        options={methods.map((m) => ({ id: m, label: m }))}
        value={value}
        onChange={onChange}
      />
    );
  }
  return (
    <SelectField
      label="Method"
      options={methods.map((m) => ({ id: m, label: m }))}
      value={value}
      onChange={onChange}
    />
  );
}

export function RecordPaymentSheet({
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
  const me = useMe().data;
  const invalidate = useInvalidateMoney();
  const firstMethod = me?.settings.paymentMethods[0] ?? "Cash";
  const [client, setClient] = useState<SelectedClient | null>(initialClient);
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState(firstMethod);
  const [paidOn, setPaidOn] = useState(fmt.today());
  const [reference, setReference] = useState("");
  const [idemKey, setIdemKey] = useState(uuidv7);

  // Reset each time the sheet opens so a second payment never reuses the first one's key.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-seed when the sheet opens.
  useEffect(() => {
    if (!isOpen) return;
    setClient(initialClient);
    setAmount(
      initialClient?.balanceMinor && initialClient.balanceMinor > 0
        ? initialClient.balanceMinor
        : null,
    );
    setMethod(firstMethod);
    setPaidOn(fmt.today());
    setReference("");
    setIdemKey(uuidv7());
  }, [isOpen]);

  const save = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      api.post<PaymentDto>(
        "/payments",
        {
          id: idemKey,
          clientId: client?.id,
          amountMinor: amount,
          method,
          paidOn,
          reference: reference.trim() || null,
        },
        { idempotencyKey: idemKey },
      ),
    onSuccess: (p) => {
      invalidate(p.clientId);
      notify({
        tone: "success",
        title: `${fmt.money(p.amountMinor)} recorded`,
        body: `From ${p.clientName} · ${p.method}`,
      });
      onOpenChange(false);
    },
  });
  const errs = fieldErrors(save.error);

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Record payment"
      description="Payments settle the oldest unpaid charges first."
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="dark"
            isDisabled={!client || !amount}
            isPending={save.isPending}
            onPress={() => save.mutate()}
          >
            {amount ? `Record ${fmt.money(amount)}` : "Record payment"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (client && amount) save.mutate();
        }}
      >
        {client ? (
          <ChosenClient
            client={client}
            hint={
              client.balanceMinor
                ? client.balanceMinor > 0
                  ? `Owes ${fmt.money(client.balanceMinor)}`
                  : `${fmt.money(-client.balanceMinor)} in credit`
                : "Nothing owed"
            }
            onClear={lockClient ? undefined : () => setClient(null)}
          />
        ) : (
          <ClientPicker
            label="Client"
            autoFocus
            onSelect={(c) => {
              setClient(c);
              if (c.balanceMinor > 0) setAmount(c.balanceMinor);
            }}
          />
        )}
        <MoneyField
          label="Amount"
          currency={fmt.currency}
          valueMinor={amount}
          onChange={setAmount}
          error={errs.amountMinor}
          autoFocus={Boolean(client)}
        />
        <PaymentMethodField value={method} onChange={setMethod} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Date"
            type="date"
            value={paidOn}
            onChange={setPaidOn}
            error={errs.paidOn}
          />
          <TextField
            label="Reference (optional)"
            value={reference}
            onChange={setReference}
            placeholder="Receipt or transfer no."
          />
        </div>
        {save.error ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
