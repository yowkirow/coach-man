import type { ChargeListItemDto, PaymentDto } from "@shared/api-types";
import type { ChargeKind } from "@shared/domain";
import type { UseQueryResult } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { HandCoins, MoreHorizontal, ReceiptText, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button, IconButton } from "../../components/ui/button";
import { Avatar, Card, Pill, PillTabs, type PillTone } from "../../components/ui/display";
import { EmptyState, ErrorState, RowsSkeleton } from "../../components/ui/feedback";
import { ActionMenu, type MenuAction } from "../../components/ui/overlay";
import { errorMessage } from "../../lib/api";
import { type Format, useFormat } from "../../lib/format";
import { useMe } from "../../lib/hooks";
import { useOnline } from "../../lib/offline";
import {
  CHARGE_KIND_LABELS,
  CHARGE_KIND_SINGULAR,
  CHARGE_KIND_TONES,
  methodTone,
  personOf,
} from "./money-data";
import type { VoidTarget } from "./void-sheet";

export type LedgerTab = "payments" | "charges";

/** Search for the client profile's money tab (kept as a value so it type-checks loosely). */
export const CLIENT_MONEY_SEARCH = { tab: "money" } as const;

function ClientName({ id, name, struck }: { id: string; name: string; struck?: boolean }) {
  return (
    <Link
      to="/clients/$clientId"
      params={{ clientId: id }}
      search={CLIENT_MONEY_SEARCH}
      className={`truncate rounded-md font-medium outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink ${struck ? "text-ink-2" : ""}`}
    >
      {name}
    </Link>
  );
}

function Row({
  date,
  name,
  clientId,
  voided,
  pills,
  meta,
  amount,
  amountNote,
  menu,
  fmt,
}: {
  date: string;
  name: string;
  clientId: string;
  voided: boolean;
  pills: ReactNode;
  meta: ReactNode;
  amount: number;
  amountNote?: ReactNode;
  menu: ReactNode;
  fmt: Format;
}) {
  return (
    <li className="flex items-center gap-3 py-3">
      <span className="num hidden w-24 shrink-0 text-[0.875rem] text-ink-2 sm:block">
        {fmt.day(date)}
      </span>
      <Avatar person={personOf(name)} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <ClientName id={clientId} name={name} struck={voided} />
          {voided ? <Pill tone="panel">Voided</Pill> : null}
        </div>
        <p className="mt-0.5 truncate text-[0.8125rem] text-ink-2">
          <span className="num sm:hidden">{fmt.day(date)} · </span>
          {meta}
        </p>
      </div>
      <span className="hidden shrink-0 items-center gap-1.5 md:flex">{pills}</span>
      <span className="flex shrink-0 flex-col items-end">
        <span
          className={`num text-[1rem] ${voided ? "text-ink-2 line-through decoration-[1.5px]" : ""}`}
        >
          {fmt.money(amount)}
        </span>
        {amountNote ? <span className="text-[0.75rem] text-ink-2">{amountNote}</span> : null}
      </span>
      {menu}
    </li>
  );
}

/** Row menu with a full-size (44px) trigger. */
function RowMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  return (
    <ActionMenu
      label={label}
      actions={actions}
      trigger={
        <IconButton label={label} className="-mr-2 shrink-0">
          <MoreHorizontal aria-hidden className="size-5" />
        </IconButton>
      }
    />
  );
}

function FilterBar({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pb-1">
      <p className="text-[0.875rem] text-ink-2">
        Showing <span className="font-medium text-ink">{label}</span> only
      </p>
      <Button
        variant="ghost"
        size="md"
        icon={<X aria-hidden className="size-4" />}
        onPress={onClear}
      >
        Show all
      </Button>
    </div>
  );
}

function chargeStatus(c: ChargeListItemDto): { label: string; tone: PillTone } {
  if (c.voidedAt) return { label: "Voided", tone: "panel" };
  if (c.amountMinor < 0) return { label: "Credit", tone: "sky" };
  if (c.paidMinor >= c.amountMinor) return { label: "Paid", tone: "mint" };
  if (c.paidMinor > 0) return { label: "Part paid", tone: "amber" };
  return { label: "Unpaid", tone: "coral" };
}

const LOCKED_REASON: Partial<Record<ChargeKind, string>> = {
  session: "Change the check-in to remove it",
  package: "Void the package on the client's profile",
  event: "Cancel the registration to remove it",
};

export function MoneyLedger({
  monthName,
  tab,
  onTabChange,
  payments,
  charges,
  methodFilter,
  onMethodFilter,
  kindFilter,
  onKindFilter,
  onRecord,
  onAddCharge,
  onVoid,
  aside,
  fill = false,
}: {
  monthName: string;
  tab: LedgerTab;
  onTabChange: (tab: LedgerTab) => void;
  payments: UseQueryResult<PaymentDto[]>;
  charges: UseQueryResult<ChargeListItemDto[]>;
  methodFilter: string | null;
  onMethodFilter: (method: string | null) => void;
  kindFilter: ChargeKind | null;
  onKindFilter: (kind: ChargeKind | null) => void;
  onRecord: () => void;
  onAddCharge: () => void;
  onVoid: (target: VoidTarget) => void;
  /** Cards shown beside the lines inside the tab panel (desktop breakdowns). */
  aside?: ReactNode;
  fill?: boolean;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const navigate = useNavigate();
  const methods = useMe().data?.settings.paymentMethods ?? [];
  const paymentRows = (payments.data ?? []).filter(
    (p) => !methodFilter || p.method === methodFilter,
  );
  const chargeRows = (charges.data ?? []).filter((c) => !kindFilter || c.kind === kindFilter);
  const openClient = (clientId: string) =>
    void navigate({ to: "/clients/$clientId", params: { clientId }, search: CLIENT_MONEY_SEARCH });

  const paymentsPanel = (
    <Card label={`Payments in ${monthName}`}>
      <div className="pt-3">
        {methodFilter ? (
          <FilterBar label={methodFilter} onClear={() => onMethodFilter(null)} />
        ) : null}
        {payments.isPending ? (
          <div className="px-5 pb-3">
            <RowsSkeleton rows={4} />
          </div>
        ) : payments.isError ? (
          <div className="px-5 pb-2">
            <ErrorState
              title="Couldn't load payments"
              message={errorMessage(payments.error)}
              onRetry={() => void payments.refetch()}
            />
          </div>
        ) : paymentRows.length ? (
          <ul className="flex flex-col divide-y divide-line px-5 pb-2">
            {paymentRows.map((p) => {
              const actions: MenuAction[] = [
                { id: "open", label: "Open client", onAction: () => openClient(p.clientId) },
                {
                  id: "void",
                  label: p.voidedAt ? "Already voided" : "Void payment",
                  tone: "danger",
                  isDisabled: Boolean(p.voidedAt) || !online,
                  onAction: () =>
                    onVoid({
                      type: "payment",
                      id: p.id,
                      clientId: p.clientId,
                      clientName: p.clientName,
                      amountMinor: p.amountMinor,
                      detail: `${p.method} · ${fmt.day(p.paidOn)}`,
                    }),
                },
              ];
              const meta = [p.method, p.reference ? `Ref ${p.reference}` : null, p.note].filter(
                Boolean,
              );
              return (
                <Row
                  key={p.id}
                  fmt={fmt}
                  date={p.paidOn}
                  name={p.clientName}
                  clientId={p.clientId}
                  voided={Boolean(p.voidedAt)}
                  pills={<Pill tone={methodTone(p.method, methods)}>{p.method}</Pill>}
                  meta={
                    <>
                      <span className="md:hidden">{meta.join(" · ")}</span>
                      <span className="hidden md:inline">
                        {meta.slice(1).join(" · ") || "No reference"}
                      </span>
                    </>
                  }
                  amount={p.amountMinor}
                  menu={<RowMenu label={`Payment from ${p.clientName}`} actions={actions} />}
                />
              );
            })}
          </ul>
        ) : methodFilter ? (
          <p className="px-5 pt-2 pb-5 text-ink-2">
            No {methodFilter.toLowerCase()} payments in {monthName}.
          </p>
        ) : (
          <div className="px-5 pb-3">
            <EmptyState
              icon={<HandCoins aria-hidden className="size-5" />}
              title={`No payments in ${monthName}`}
              body="Record cash, transfers, and e-wallet payments as they come in. Each one settles the client's oldest charges first."
              action={
                <Button variant="dark" isDisabled={!online} onPress={onRecord}>
                  Record payment
                </Button>
              }
            />
          </div>
        )}
      </div>
    </Card>
  );

  const chargesPanel = (
    <Card label={`Charges in ${monthName}`}>
      <div className="pt-3">
        {kindFilter ? (
          <FilterBar label={CHARGE_KIND_LABELS[kindFilter]} onClear={() => onKindFilter(null)} />
        ) : null}
        {charges.isPending ? (
          <div className="px-5 pb-3">
            <RowsSkeleton rows={4} />
          </div>
        ) : charges.isError ? (
          <div className="px-5 pb-2">
            <ErrorState
              title="Couldn't load charges"
              message={errorMessage(charges.error)}
              onRetry={() => void charges.refetch()}
            />
          </div>
        ) : chargeRows.length ? (
          <ul className="flex flex-col divide-y divide-line px-5 pb-2">
            {chargeRows.map((c) => {
              const status = chargeStatus(c);
              const manual = c.kind === "adjustment" || c.kind === "other";
              const left = c.amountMinor - c.paidMinor;
              const actions: MenuAction[] = [
                { id: "open", label: "Open client", onAction: () => openClient(c.clientId) },
                {
                  id: "void",
                  label: c.voidedAt
                    ? "Already voided"
                    : manual
                      ? "Void charge"
                      : (LOCKED_REASON[c.kind] ?? "Can't be voided here"),
                  tone: "danger",
                  isDisabled: Boolean(c.voidedAt) || !manual || !online,
                  onAction: () =>
                    onVoid({
                      type: "charge",
                      id: c.id,
                      clientId: c.clientId,
                      clientName: c.clientName,
                      amountMinor: c.amountMinor,
                      detail: c.description,
                    }),
                },
              ];
              return (
                <Row
                  key={c.id}
                  fmt={fmt}
                  date={c.occurredOn}
                  name={c.clientName}
                  clientId={c.clientId}
                  voided={Boolean(c.voidedAt)}
                  pills={
                    <>
                      <Pill tone={CHARGE_KIND_TONES[c.kind]}>{CHARGE_KIND_SINGULAR[c.kind]}</Pill>
                      {c.voidedAt ? null : <Pill tone={status.tone}>{status.label}</Pill>}
                    </>
                  }
                  meta={
                    <>
                      <span className="md:hidden">
                        {CHARGE_KIND_SINGULAR[c.kind]}
                        {c.voidedAt ? "" : ` · ${status.label}`} ·{" "}
                      </span>
                      {c.description}
                    </>
                  }
                  amount={c.amountMinor}
                  amountNote={
                    !c.voidedAt && c.paidMinor > 0 && left > 0
                      ? `${fmt.money(left)} left`
                      : undefined
                  }
                  menu={<RowMenu label={`Charge for ${c.clientName}`} actions={actions} />}
                />
              );
            })}
          </ul>
        ) : kindFilter ? (
          <p className="px-5 pt-2 pb-5 text-ink-2">
            No {CHARGE_KIND_LABELS[kindFilter].toLowerCase()} charged in {monthName}.
          </p>
        ) : (
          <div className="px-5 pb-3">
            <EmptyState
              icon={<ReceiptText aria-hidden className="size-5" />}
              title={`Nothing charged in ${monthName}`}
              body="Package sales, pay-per-session check-ins, and event registrations land here on their own. Add a charge for anything else."
              action={
                <Button variant="dark" isDisabled={!online} onPress={onAddCharge}>
                  Add charge
                </Button>
              }
            />
          </div>
        )}
      </div>
    </Card>
  );

  const activePayments = (payments.data ?? []).filter((p) => !p.voidedAt).length;
  const activeCharges = (charges.data ?? []).filter((c) => !c.voidedAt).length;
  return (
    <PillTabs
      label="Money lines"
      selected={tab}
      onChange={(id) => onTabChange(id as LedgerTab)}
      aside={aside}
      fill={fill}
      tabs={[
        {
          id: "payments",
          label: payments.data ? `Payments · ${activePayments}` : "Payments",
          content: paymentsPanel,
        },
        {
          id: "charges",
          label: charges.data ? `Charges · ${activeCharges}` : "Charges",
          content: chargesPanel,
        },
      ]}
    />
  );
}
