import type { ChargeDto, PaymentDto, StatementDto } from "@shared/api-types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleDollarSign, Ellipsis, Receipt, Ticket, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, IconButton } from "../../components/ui/button";
import { Card, Pill } from "../../components/ui/display";
import { EmptyState, ErrorState, InlineError } from "../../components/ui/feedback";
import { TextField } from "../../components/ui/field";
import { ActionMenu, Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { plural, useFormat } from "../../lib/format";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { useInvalidateMoney } from "../money/record-payment-sheet";
import { ClientProofsCard } from "../payment-proofs/client-card";
import { CardSkeleton, OfflineHint, SectionHead } from "./bits";
import { CHARGE_KIND_LABELS } from "./client-utils";
import { useRefreshClient, useStatement } from "./queries";

interface VoidTarget {
  kind: "charge" | "payment";
  id: string;
  amountMinor: number;
  label: string;
}

export function MoneyTab({
  clientId,
  firstName,
  onPay,
  onSell,
}: {
  clientId: string;
  firstName: string;
  onPay: () => void;
  onSell: () => void;
}) {
  const q = useStatement(clientId);
  const fmt = useFormat();
  const [voiding, setVoiding] = useState<VoidTarget | null>(null);
  if (q.isPending && q.fetchStatus === "paused") {
    return (
      <Card className="px-6 py-2">
        <EmptyState
          icon={<WifiOff aria-hidden className="size-5" />}
          title="Money needs a connection"
          body={`${firstName}'s statement isn't saved on this device. Reconnect to see charges and payments.`}
        />
      </Card>
    );
  }
  if (q.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <CardSkeleton rows={2} />
        <CardSkeleton rows={3} />
      </div>
    );
  }
  if (!q.data) {
    return (
      <Card className="px-6 py-2">
        <ErrorState
          title="Couldn't load the statement"
          message={errorMessage(q.error)}
          onRetry={() => void q.refetch()}
        />
      </Card>
    );
  }
  const s = q.data;
  return (
    <div className="flex flex-col gap-4">
      <StatementHero statement={s} firstName={firstName} onPay={onPay} onSell={onSell} />
      <ClientProofsCard clientId={clientId} fmt={fmt} />
      <ChargesCard charges={s.charges} onVoid={setVoiding} />
      <PaymentsCard payments={s.payments} onVoid={setVoiding} onPay={onPay} />
      <VoidSheet
        target={voiding}
        clientId={clientId}
        firstName={firstName}
        onClose={() => setVoiding(null)}
      />
    </div>
  );
}

function StatementHero({
  statement,
  firstName,
  onPay,
  onSell,
}: {
  statement: StatementDto;
  firstName: string;
  onPay: () => void;
  onSell: () => void;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const balance = statement.balanceMinor;
  const live = statement.charges.filter((c) => !c.voidedAt);
  const unpaid = live.filter((c) => c.paidMinor < c.amountMinor);
  const oldest = unpaid.map((c) => c.occurredOn).sort()[0];
  const charged = live.reduce((n, c) => n + c.amountMinor, 0);
  const paid = statement.payments.filter((p) => !p.voidedAt).reduce((n, p) => n + p.amountMinor, 0);
  return (
    <Card className="p-5 sm:p-6" label="Balance">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-[1.125rem] font-medium">
              {balance > 0 ? "Balance due" : balance < 0 ? "In credit" : "Balance"}
            </h2>
            {balance > 0 ? (
              <Pill tone="coral">Owes</Pill>
            ) : balance < 0 ? (
              <Pill tone="mint">In credit</Pill>
            ) : (
              <Pill tone="mint">Paid up</Pill>
            )}
          </div>
          <p className="num mt-3 text-[2.75rem] leading-none font-light tracking-[-0.02em] lg:text-[3.25rem]">
            {fmt.money(Math.abs(balance))}
          </p>
          <p className="mt-3 max-w-[56ch] text-[0.9375rem] text-ink-2">
            {balance > 0
              ? `From ${plural(unpaid.length, "unpaid charge")}${oldest ? `, the oldest from ${fmt.date(oldest)}` : ""}. Payments settle the oldest first.`
              : balance < 0
                ? `${firstName} has paid ${fmt.money(-balance)} ahead. It goes toward the next charge automatically.`
                : live.length
                  ? "Every charge is paid."
                  : "No charges yet. Selling a package or a pay-per-session check-in adds one."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="dark"
            isDisabled={!online}
            icon={<CircleDollarSign aria-hidden className="size-4.5" />}
            onPress={onPay}
          >
            Record payment
          </Button>
          <Button
            variant="light"
            isDisabled={!online}
            icon={<Ticket aria-hidden className="size-4.5" />}
            onPress={onSell}
          >
            Sell package
          </Button>
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-[repeat(2,minmax(0,13rem))]">
        <div>
          <dt className="text-[0.8125rem] text-ink-2">Charged</dt>
          <dd className="num text-[1.125rem]">{fmt.money(charged)}</dd>
        </div>
        <div>
          <dt className="text-[0.8125rem] text-ink-2">Paid</dt>
          <dd className="num text-[1.125rem]">{fmt.money(paid)}</dd>
        </div>
      </dl>
      <div className="mt-4 empty:hidden">
        <OfflineHint>You're offline. Reconnect to record payments or sell packages.</OfflineHint>
      </div>
    </Card>
  );
}

function chargeState(c: ChargeDto, money: (m: number) => string) {
  if (c.voidedAt) return <Pill tone="outline">Voided</Pill>;
  if (c.amountMinor <= 0) return <Pill tone="panel">Credit</Pill>;
  if (c.paidMinor >= c.amountMinor) return <Pill tone="mint">Paid</Pill>;
  if (c.paidMinor > 0)
    return (
      <Pill tone="amber">
        <span className="num">{money(c.amountMinor - c.paidMinor)} due</span>
      </Pill>
    );
  return <Pill tone="coral">Unpaid</Pill>;
}

function ChargesCard({
  charges,
  onVoid,
}: {
  charges: ChargeDto[];
  onVoid: (t: VoidTarget) => void;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const [all, setAll] = useState(false);
  const rows = [...charges].sort(
    (a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.id.localeCompare(a.id),
  );
  const shown = all ? rows : rows.slice(0, 10);
  return (
    <Card label="Charges">
      <SectionHead title="Charges" count={charges.length || undefined} />
      {rows.length ? (
        <ul className="flex flex-col divide-y divide-line px-5 pb-3">
          {shown.map((c) => {
            const voided = Boolean(c.voidedAt);
            return (
              <li key={c.id} className="flex items-center gap-3 py-3">
                <span className="num w-[5.5rem] shrink-0 text-[0.875rem] text-ink-2 sm:w-[6.5rem]">
                  {fmt.date(c.occurredOn)}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate font-medium ${voided ? "text-ink-2 line-through" : ""}`}
                  >
                    {c.description}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-ink-2">
                    {CHARGE_KIND_LABELS[c.kind]}
                    {chargeState(c, fmt.moneyShort)}
                  </span>
                </span>
                <span
                  className={`num shrink-0 text-right text-[1rem] ${voided ? "text-ink-2 line-through" : "font-medium"}`}
                >
                  {fmt.money(c.amountMinor)}
                </span>
                {voided ? (
                  <span className="size-11 shrink-0" />
                ) : (
                  <ActionMenu
                    label={`Actions for ${c.description}`}
                    trigger={
                      <IconButton
                        label={`Actions for ${c.description}`}
                        isDisabled={!online}
                        className="shrink-0"
                      >
                        <Ellipsis aria-hidden className="size-5" />
                      </IconButton>
                    }
                    actions={[
                      {
                        id: "void",
                        label: c.attendanceId
                          ? "Void (change the check-in instead)"
                          : "Void charge",
                        tone: "danger",
                        isDisabled: Boolean(c.attendanceId),
                        onAction: () =>
                          onVoid({
                            kind: "charge",
                            id: c.id,
                            amountMinor: c.amountMinor,
                            label: c.description,
                          }),
                      },
                    ]}
                  />
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="flex items-center gap-2 px-5 pb-5 text-ink-2">
          <Receipt aria-hidden className="size-4.5 shrink-0" />
          No charges yet.
        </p>
      )}
      {rows.length > shown.length ? (
        <div className="px-5 pb-4">
          <Button variant="ghost" size="sm" onPress={() => setAll(true)}>
            Show {rows.length - shown.length} older charges
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function PaymentsCard({
  payments,
  onVoid,
  onPay,
}: {
  payments: PaymentDto[];
  onVoid: (t: VoidTarget) => void;
  onPay: () => void;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const [all, setAll] = useState(false);
  const rows = [...payments].sort(
    (a, b) => b.paidOn.localeCompare(a.paidOn) || b.id.localeCompare(a.id),
  );
  const shown = all ? rows : rows.slice(0, 10);
  return (
    <Card label="Payments">
      <SectionHead
        title="Payments"
        count={payments.length || undefined}
        action={
          <Button variant="light" size="sm" isDisabled={!online} onPress={onPay}>
            Record payment
          </Button>
        }
      />
      {rows.length ? (
        <ul className="flex flex-col divide-y divide-line px-5 pb-3">
          {shown.map((p) => {
            const voided = Boolean(p.voidedAt);
            const extra = [p.reference ? `Ref ${p.reference}` : null, p.note]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={p.id} className="flex items-center gap-3 py-3">
                <span className="num w-[5.5rem] shrink-0 text-[0.875rem] text-ink-2 sm:w-[6.5rem]">
                  {fmt.date(p.paidOn)}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate font-medium ${voided ? "text-ink-2 line-through" : ""}`}
                  >
                    {p.method}
                  </span>
                  {extra || voided ? (
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-ink-2">
                      {voided ? <Pill tone="outline">Voided</Pill> : null}
                      <span className="min-w-0 truncate">{extra}</span>
                    </span>
                  ) : null}
                </span>
                <span
                  className={`num shrink-0 text-right text-[1rem] ${voided ? "text-ink-2 line-through" : "font-medium"}`}
                >
                  {fmt.money(p.amountMinor)}
                </span>
                {voided ? (
                  <span className="size-11 shrink-0" />
                ) : (
                  <ActionMenu
                    label={`Actions for the ${fmt.date(p.paidOn)} payment`}
                    trigger={
                      <IconButton
                        label={`Actions for the ${fmt.date(p.paidOn)} payment`}
                        isDisabled={!online}
                        className="shrink-0"
                      >
                        <Ellipsis aria-hidden className="size-5" />
                      </IconButton>
                    }
                    actions={[
                      {
                        id: "void",
                        label: "Void payment",
                        tone: "danger",
                        onAction: () =>
                          onVoid({
                            kind: "payment",
                            id: p.id,
                            amountMinor: p.amountMinor,
                            label: `${p.method}, ${fmt.date(p.paidOn)}`,
                          }),
                      },
                    ]}
                  />
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="flex items-center gap-2 px-5 pb-5 text-ink-2">
          <CircleDollarSign aria-hidden className="size-4.5 shrink-0" />
          No payments recorded yet.
        </p>
      )}
      {rows.length > shown.length ? (
        <div className="px-5 pb-4">
          <Button variant="ghost" size="sm" onPress={() => setAll(true)}>
            Show {rows.length - shown.length} older payments
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

/** Voids a charge or payment. The line stays on record, struck through, with the reason. */
function VoidSheet({
  target,
  clientId,
  firstName,
  onClose,
}: {
  target: VoidTarget | null;
  clientId: string;
  firstName: string;
  onClose: () => void;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const qc = useQueryClient();
  const invalidateMoney = useInvalidateMoney();
  const refresh = useRefreshClient();
  const [reason, setReason] = useState("");
  const [shown, setShown] = useState<VoidTarget | null>(target);
  const run = useMutation({
    meta: { silent: true },
    mutationFn: (t: VoidTarget) =>
      api.post<StatementDto>(`/${t.kind === "payment" ? "payments" : "charges"}/${t.id}/void`, {
        reason: reason.trim(),
      }),
    onSuccess: (statement, t) => {
      qc.setQueryData(keys.statement(clientId), statement);
      invalidateMoney(clientId);
      refresh(clientId, { skip: "progress" });
      notify({
        tone: "success",
        title: t.kind === "payment" ? "Payment voided" : "Charge voided",
        body:
          statement.balanceMinor > 0
            ? `${firstName} now owes ${fmt.money(statement.balanceMinor)}.`
            : statement.balanceMinor < 0
              ? `${firstName} is ${fmt.money(-statement.balanceMinor)} in credit.`
              : `${firstName} is paid up.`,
      });
      onClose();
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when another line is chosen.
  useEffect(() => {
    if (!target) return;
    setShown(target);
    setReason("");
    run.reset();
  }, [target?.id]);
  const t = target ?? shown;
  const isPayment = t?.kind === "payment";
  const canVoid = Boolean(t && reason.trim() && online);
  const submit = () => t && canVoid && run.mutate(t);
  return (
    <Sheet
      isOpen={target !== null}
      onOpenChange={(o) => !o && onClose()}
      title={isPayment ? "Void payment" : "Void charge"}
      description={t ? `${fmt.money(t.amountMinor)} · ${t.label}` : undefined}
      footer={
        <>
          <Button variant="light" onPress={onClose}>
            Keep it
          </Button>
          <Button variant="danger" isDisabled={!canVoid} isPending={run.isPending} onPress={submit}>
            {isPayment ? "Void payment" : "Void charge"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="text-ink-2">
          {isPayment
            ? `It stays on the statement, struck through, and ${firstName}'s balance goes back up. Other payments are re-applied to the oldest charges.`
            : `It stays on the statement, struck through, and comes off ${firstName}'s balance.`}
        </p>
        <TextField
          label="Reason"
          isRequired
          autoFocus
          value={reason}
          onChange={setReason}
          placeholder={isPayment ? "Transfer bounced, recorded twice…" : "Entered by mistake…"}
          description="Kept with the voided line so the change can be explained later."
          error={fieldErrors(run.error).reason}
        />
        {run.error && !fieldErrors(run.error).reason ? (
          <InlineError>{errorMessage(run.error)}</InlineError>
        ) : null}
        <OfflineHint>You're offline. Reconnect to void this.</OfflineHint>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
