import type { PackageBalanceDto } from "@shared/api-types";
import { LESSON_KIND_LABELS } from "@shared/domain";
import { uuidv7 } from "@shared/ids";
import { addDays } from "@shared/time";
import { firstDayOf, lastDayOf, monthOf, startMonthChoices } from "@shared/validity";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Label, Radio, RadioGroup } from "react-aria-components";
import { ClientPicker } from "../../components/domain/lesson";
import { Button } from "../../components/ui/button";
import { InlineError } from "../../components/ui/feedback";
import { MoneyField, Segmented, Switch, TextField } from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { fullName, plural, useFormat } from "../../lib/format";
import { useMe, usePackageTemplates } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import {
  ChosenClient,
  PaymentMethodField,
  type SelectedClient,
  useInvalidateMoney,
} from "../money/record-payment-sheet";
import { OfflineNote } from "../settings/offline";
import { templateValidityText } from "./catalog";

export function SellPackageSheet({
  isOpen,
  onOpenChange,
  client: initialClient = null,
  lockClient = false,
  templateId: initialTemplate = null,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  client?: SelectedClient | null;
  lockClient?: boolean;
  templateId?: string | null;
}) {
  const fmt = useFormat();
  const me = useMe().data;
  const online = useOnline();
  const templates = usePackageTemplates();
  const invalidate = useInvalidateMoney();
  const active = useMemo(() => (templates.data ?? []).filter((t) => t.active), [templates.data]);
  const [client, setClient] = useState<SelectedClient | null>(initialClient);
  const [templateId, setTemplateId] = useState<string | null>(initialTemplate);
  const [price, setPrice] = useState<number | null>(null);
  const [purchasedOn, setPurchasedOn] = useState(fmt.today());
  const [startMonth, setStartMonth] = useState(monthOf(fmt.today()));
  const [uniformSize, setUniformSize] = useState("");
  const [paidNow, setPaidNow] = useState(true);
  const [paidAmount, setPaidAmount] = useState<number | null>(null);
  const [method, setMethod] = useState(me?.settings.paymentMethods[0] ?? "Cash");
  const [idemKey, setIdemKey] = useState(uuidv7);

  const template = active.find((t) => t.id === templateId) ?? null;

  // Picking a package sets its list price; the coach can still discount it.
  const pick = (id: string | null) => {
    setTemplateId(id);
    const t = active.find((x) => x.id === id);
    setPrice(t ? t.priceMinor : null);
    setPaidAmount(t ? t.priceMinor : null);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-seed when the sheet opens.
  useEffect(() => {
    if (!isOpen) return;
    setClient(initialClient);
    pick(initialTemplate ?? null);
    setPurchasedOn(fmt.today());
    setStartMonth(monthOf(fmt.today()));
    setUniformSize("");
    setPaidNow(true);
    setMethod(me?.settings.paymentMethods[0] ?? "Cash");
    setIdemKey(uuidv7());
  }, [isOpen]);

  // Month-end packages run for a calendar month (this one or next), from the 1st to the last day.
  const monthEnd = template?.validityMode === "month_end";
  const months = startMonthChoices(fmt.today());
  const expiresOn = monthEnd
    ? lastDayOf(startMonth)
    : template?.validityDays
      ? addDays(purchasedOn, template.validityDays - 1)
      : null;

  const sell = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      api.post<PackageBalanceDto>(
        `/clients/${client?.id}/packages`,
        {
          id: idemKey,
          packageId: templateId,
          priceMinor: price ?? undefined,
          purchasedOn,
          startMonth: monthEnd ? startMonth : undefined,
          uniformSize:
            template?.includesUniform && uniformSize.trim() ? uniformSize.trim() : undefined,
          payment: paidNow && paidAmount ? { amountMinor: paidAmount, method } : undefined,
        },
        { idempotencyKey: idemKey },
      ),
    onSuccess: (p) => {
      if (client) invalidate(client.id);
      notify({
        tone: "success",
        title: `${p.name} sold`,
        body: `${client ? `${client.firstName} now has ` : ""}${plural(p.remaining, "credit")}${p.expiresOn ? ` until ${fmt.date(p.expiresOn)}` : ""}.`,
      });
      onOpenChange(false);
    },
  });
  const errs = fieldErrors(sell.error);
  const canSell = Boolean(client && templateId && price !== null);

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="lg"
      title="Sell a package"
      description="Credits are used automatically at check-in, earliest expiry first."
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="dark"
            isDisabled={!canSell || !online}
            isPending={sell.isPending}
            onPress={() => sell.mutate()}
          >
            {template && client ? `Sell to ${client.firstName}` : "Sell package"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        {client ? (
          <ChosenClient client={client} onClear={lockClient ? undefined : () => setClient(null)} />
        ) : (
          <ClientPicker label="Client" autoFocus onSelect={(c) => setClient(c)} />
        )}

        {templates.isPending ? (
          <p className="text-ink-2">Loading packages…</p>
        ) : active.length === 0 ? (
          <p className="text-ink-2">
            No packages yet.{" "}
            <Link
              to="/packages"
              className="font-medium text-ink underline underline-offset-4"
              onClick={() => onOpenChange(false)}
            >
              Create one in Packages &amp; rates
            </Link>
            .
          </p>
        ) : (
          <RadioGroup value={templateId} onChange={pick} className="flex flex-col gap-2">
            <Label className="text-[0.8125rem] font-medium text-ink-2">Package</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {active.map((t) => (
                <Radio
                  key={t.id}
                  value={t.id}
                  className={({ isSelected, isFocusVisible }) =>
                    `flex cursor-pointer items-start gap-3 rounded-[22px] p-4 text-left outline-none transition-colors ${
                      isSelected ? "bg-lime" : "bg-panel hover:bg-line"
                    } ${isFocusVisible ? "outline-2 outline-offset-2 outline-ink" : ""}`
                  }
                >
                  {({ isSelected }) => (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{t.name}</span>
                        <span className="mt-0.5 block text-[0.8125rem] text-ink-2">
                          {t.sessionsLabel ? `${t.sessionsLabel} · ` : ""}
                          {plural(t.credits, "credit")} · {templateValidityText(t).toLowerCase()}
                          {t.lessonKinds.length
                            ? ` · ${t.lessonKinds.map((k) => LESSON_KIND_LABELS[k]).join(", ")}`
                            : ""}
                        </span>
                        <span className="num mt-2 block text-[1.25rem] font-light">
                          {fmt.money(t.priceMinor)}
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${isSelected ? "bg-ink text-lime" : "border border-line-strong bg-card"}`}
                      >
                        {isSelected ? <Check className="size-3.5" strokeWidth={3} /> : null}
                      </span>
                    </>
                  )}
                </Radio>
              ))}
            </div>
          </RadioGroup>
        )}

        {template ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyField
                label="Price"
                currency={fmt.currency}
                valueMinor={price}
                onChange={(v) => {
                  setPrice(v);
                  setPaidAmount(v);
                }}
                description={
                  price !== null && price < template.priceMinor
                    ? `${fmt.money(template.priceMinor - price)} discount`
                    : undefined
                }
                error={errs.priceMinor}
              />
              <TextField
                label={monthEnd ? "Sold on" : "Starts on"}
                type="date"
                value={purchasedOn}
                onChange={setPurchasedOn}
                description={
                  monthEnd
                    ? undefined
                    : expiresOn
                      ? `Expires ${fmt.date(expiresOn)}`
                      : "Never expires"
                }
              />
            </div>
            {monthEnd ? (
              <div className="flex flex-col gap-1.5">
                <Segmented
                  label="For the month of"
                  value={startMonth}
                  onChange={setStartMonth}
                  options={months.map((m, i) => ({
                    id: m,
                    label: `${fmt.month(m)}${i === 0 ? "" : " (next)"}`,
                  }))}
                />
                <p className="num text-[0.8125rem] text-ink-2">
                  Pays for sessions from {fmt.date(firstDayOf(startMonth))}. Valid until{" "}
                  {fmt.date(lastDayOf(startMonth))}.
                </p>
                {errs.startMonth ? (
                  <p className="text-[0.8125rem] font-medium text-[#b42318]">{errs.startMonth}</p>
                ) : null}
              </div>
            ) : null}
            {template.includesUniform ? (
              <TextField
                label="Uniform size (optional)"
                value={uniformSize}
                onChange={setUniformSize}
                placeholder="e.g. M"
                description="It includes the training uniform. You can add the size later."
                error={errs.uniformSize}
                className="sm:max-w-[16rem]"
              />
            ) : null}
            <div className="rounded-[22px] bg-panel px-4 py-2">
              <Switch
                isSelected={paidNow}
                onChange={setPaidNow}
                description={paidNow ? undefined : "The price is added to their balance."}
              >
                Paid now
              </Switch>
              {paidNow ? (
                <div className="grid gap-4 pt-2 pb-3 sm:grid-cols-2">
                  <MoneyField
                    label="Amount received"
                    currency={fmt.currency}
                    valueMinor={paidAmount}
                    onChange={setPaidAmount}
                  />
                  <PaymentMethodField value={method} onChange={setMethod} />
                </div>
              ) : null}
            </div>
          </>
        ) : null}
        {sell.error ? <InlineError>{errorMessage(sell.error)}</InlineError> : null}
        <OfflineNote>You're offline. Reconnect to sell this package.</OfflineNote>
        {client && template ? (
          <p className="text-[0.875rem] text-ink-2">
            {fullName(client)} gets {plural(template.credits, "credit")}
            {monthEnd ? ` for ${fmt.month(startMonth)}` : ""}
            {paidNow && paidAmount
              ? `, paying ${fmt.money(paidAmount)} by ${method.toLowerCase()}`
              : ", added to their balance"}
            .
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
