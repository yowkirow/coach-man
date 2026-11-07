import type { BalanceDto } from "@shared/api-types";
import type { ChargeKind } from "@shared/domain";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { HandCoins, ReceiptText } from "lucide-react";
import { useEffect, useState } from "react";
import { Page, ShellAside, useIsDesktop } from "../../components/layout/app-shell";
import { NoAccess } from "../../components/layout/no-access";
import { Button, IconButton } from "../../components/ui/button";
import { Card, PageHeader } from "../../components/ui/display";
import { ErrorState } from "../../components/ui/feedback";
import { AddChargeSheet } from "../../features/money/add-charge-sheet";
import { type LedgerTab, MoneyLedger } from "../../features/money/ledger";
import {
  MONTH_RE,
  monthLabel,
  monthsBetween,
  useBalances,
  useCharges,
  useMoneySummary,
  usePayments,
} from "../../features/money/money-data";
import {
  ChargedCard,
  HeroSkeleton,
  MethodsCard,
  MoneyKpis,
  MonthStepper,
  MonthSwitcher,
  OwesCard,
  OwesTiles,
  ReceivedHero,
} from "../../features/money/overview";
import { RecordPaymentSheet, type SelectedClient } from "../../features/money/record-payment-sheet";
import { VoidSheet, type VoidTarget } from "../../features/money/void-sheet";
import { ProofQueue } from "../../features/payment-proofs/queue";
import { ConnectionPill } from "../../features/settings/offline";
import { scrollToId, scrollToIdSoon } from "../../features/settings/scroll";
import { errorMessage } from "../../lib/api";
import { plural, useFormat } from "../../lib/format";
import { useCan } from "../../lib/hooks";
import { useOnline } from "../../lib/offline";

interface MoneySearch {
  record?: "1";
  month?: string;
}

export const Route = createFileRoute("/_app/money")({
  // `?record=1` typed into a URL (the manifest shortcut) arrives as the number 1.
  validateSearch: (s: Record<string, unknown>): MoneySearch => ({
    record: s.record === "1" || s.record === 1 ? "1" : undefined,
    month: typeof s.month === "string" && MONTH_RE.test(s.month) ? s.month : undefined,
  }),
  component: MoneyRoute,
});

function MoneyRoute() {
  const can = useCan();
  if (!can.money) {
    return (
      <NoAccess
        title="Money"
        body="Payments, charges, and balances are for the academy's owner and admins. You still see every player's credits on their profile and at check-in."
      />
    );
  }
  return <MoneyPage />;
}

const LEDGER_ID = "money-ledger";
const OWES_ID = "money-owes";

function MoneyPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const desktop = useIsDesktop();
  const fmt = useFormat();
  const online = useOnline();

  const current = fmt.today().slice(0, 7);
  const month = search.month && search.month < current ? search.month : current;
  const back = monthsBetween(month, current);
  // Keep the six bars anchored on this month while browsing the last six; older months bring
  // their own window.
  const summary = useMoneySummary(month);
  const chart = useMoneySummary(back >= 0 && back <= 5 ? current : month);
  const balances = useBalances();
  const payments = usePayments(month);
  const charges = useCharges(month);

  const [tab, setTab] = useState<LedgerTab>("payments");
  const [methodFilter, setMethodFilter] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<ChargeKind | null>(null);
  const [payFor, setPayFor] = useState<SelectedClient | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);

  // Filters belong to the month they were picked in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the month changes.
  useEffect(() => {
    setMethodFilter(null);
    setKindFilter(null);
  }, [month]);

  const setMonth = (m: string) =>
    void navigate({
      search: (p: MoneySearch) => ({ ...p, month: m >= current ? undefined : m }),
      replace: true,
    });

  const showLedger = (t: LedgerTab, block: ScrollLogicalPosition = "start") => {
    setTab(t);
    scrollToIdSoon(LEDGER_ID, block);
  };
  const pickKind = (kind: string | null) => {
    setKindFilter(kind as ChargeKind | null);
    if (kind) showLedger("charges", "nearest");
  };
  const pickMethod = (method: string | null) => {
    setMethodFilter(method);
    if (method) showLedger("payments", "nearest");
  };
  const recordFrom = (b: BalanceDto) => {
    setPayFor({
      id: b.clientId,
      firstName: b.firstName,
      lastName: b.lastName,
      balanceMinor: b.balanceMinor,
    });
    setPayOpen(true);
  };
  const recordAny = () => {
    setPayFor(null);
    setPayOpen(true);
  };

  const paymentCount = payments.data?.filter((p) => !p.voidedAt).length;
  const chargeCount = charges.data?.filter((c) => !c.voidedAt).length;
  const monthName = fmt.month(month);
  const counts =
    paymentCount !== undefined && chargeCount !== undefined
      ? `${plural(paymentCount, "payment")} · ${plural(chargeCount, "charge")}`
      : "Loading…";

  const kpis = (
    <MoneyKpis
      summary={summary.data}
      paymentCount={paymentCount}
      onReceived={() => showLedger("payments")}
      onCharged={() => showLedger("charges")}
      onOutstanding={() => scrollToId(OWES_ID)}
      onPayments={() => showLedger("payments")}
    />
  );

  const hero = summary.data ? (
    <ReceivedHero
      summary={summary.data}
      chart={chart.data ?? summary.data}
      month={month}
      paymentCount={paymentCount}
      isRefreshing={summary.isPlaceholderData}
      onSelectMonth={setMonth}
      onShowPayments={() => showLedger("payments")}
    />
  ) : summary.isError ? (
    <Card className="px-6 py-2">
      <ErrorState
        title="Couldn't load this month"
        message={errorMessage(summary.error)}
        onRetry={() => void summary.refetch()}
      />
    </Card>
  ) : (
    <HeroSkeleton />
  );

  const breakdowns = summary.data ? (
    <>
      <ChargedCard
        summary={summary.data}
        month={month}
        selectedKind={kindFilter}
        onSelectKind={pickKind}
      />
      <MethodsCard
        summary={summary.data}
        month={month}
        selectedMethod={methodFilter}
        onSelectMethod={pickMethod}
      />
    </>
  ) : null;

  const ledgerProps = {
    monthName,
    tab,
    onTabChange: setTab,
    payments,
    charges,
    methodFilter,
    onMethodFilter: setMethodFilter,
    kindFilter,
    onKindFilter: setKindFilter,
    onRecord: recordAny,
    onAddCharge: () => setChargeOpen(true),
    onVoid: setVoidTarget,
  };
  const ledger = (
    <div id={LEDGER_ID} className="min-w-0 scroll-mt-4">
      <MoneyLedger {...ledgerProps} />
    </div>
  );
  // Desktop: the breakdown cards live inside the ledger's panel, beside the lines they filter.
  const desktopLedger = (
    <div id={LEDGER_ID} className="min-w-0 scroll-mt-4">
      <MoneyLedger {...ledgerProps} aside={breakdowns} fill />
    </div>
  );

  const owesProps = {
    balances: balances.data,
    isPending: balances.isPending,
    error: balances.error,
    onRetry: () => void balances.refetch(),
    onRecord: recordFrom,
  };

  return (
    <>
      <ShellAside>
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="min-w-0">
              <h2 className="text-[1.75rem] leading-tight font-light tracking-[-0.01em]">
                {monthLabel(month, fmt.locale)}
              </h2>
              <p className="num mt-1 truncate text-[0.875rem] text-night-ink-2">
                {month.slice(0, 4)}
                {month === current ? " · so far" : ""}
              </p>
            </div>
            <MonthSwitcher month={month} current={current} onChange={setMonth} dark />
          </div>
          {kpis}
          <OwesTiles {...owesProps} />
        </div>
      </ShellAside>

      {desktop ? (
        <Page className="flex flex-col gap-5 pb-6">
          <PageHeader
            title="Money"
            subtitle={
              <span className="flex flex-wrap items-center gap-x-2">
                <span>{monthName}</span>
                {month !== current ? (
                  <>
                    <span aria-hidden>·</span>
                    <button
                      type="button"
                      onClick={() => setMonth(current)}
                      className="cursor-pointer rounded-md font-medium text-ink underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ink"
                    >
                      Back to {monthLabel(current, fmt.locale)}
                    </button>
                  </>
                ) : null}
              </span>
            }
            actions={
              <>
                <ConnectionPill />
                <Button
                  variant="light"
                  icon={<ReceiptText aria-hidden className="size-4.5" />}
                  isDisabled={!online}
                  onPress={() => setChargeOpen(true)}
                >
                  Add charge
                </Button>
                <Button
                  variant="dark"
                  icon={<HandCoins aria-hidden className="size-4.5" />}
                  isDisabled={!online}
                  onPress={recordAny}
                >
                  Record payment
                </Button>
              </>
            }
          />
          <ProofQueue fmt={fmt} />
          <div className="min-w-0">{hero}</div>
          {desktopLedger}
        </Page>
      ) : (
        <div className="flex flex-col">
          <section className="dark-zone rounded-b-[32px] bg-night px-4 pt-[calc(env(safe-area-inset-top)+20px)] pb-5 text-night-ink">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-[2rem] leading-tight font-light tracking-[-0.02em]">Money</h1>
                <p className="num mt-1 truncate text-[0.9375rem] text-night-ink-2">{counts}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ConnectionPill dark />
                <IconButton
                  label="Add charge"
                  variant="night"
                  isDisabled={!online}
                  onPress={() => setChargeOpen(true)}
                >
                  <ReceiptText aria-hidden className="size-5" />
                </IconButton>
                <IconButton
                  label="Record payment"
                  variant="lime"
                  className="data-[focus-visible]:outline-lime"
                  isDisabled={!online}
                  onPress={recordAny}
                >
                  <HandCoins aria-hidden className="size-5" />
                </IconButton>
              </div>
            </div>
            <div className="mt-4">
              <MonthStepper month={month} current={current} onChange={setMonth} />
            </div>
            <div className="mt-3">{kpis}</div>
          </section>
          <Page className="flex flex-col gap-4 pt-4">
            <ProofQueue fmt={fmt} />
            {hero}
            <OwesCard {...owesProps} />
            {breakdowns}
            {ledger}
          </Page>
        </div>
      )}

      <RecordPaymentSheet
        isOpen={search.record === "1" || payOpen}
        onOpenChange={(open) => {
          if (open) return;
          setPayOpen(false);
          if (search.record)
            void navigate({
              search: (p: MoneySearch) => ({ ...p, record: undefined }),
              replace: true,
            });
        }}
        client={payFor}
      />
      <AddChargeSheet isOpen={chargeOpen} onOpenChange={setChargeOpen} />
      <VoidSheet
        target={voidTarget}
        onOpenChange={(open) => {
          if (!open) setVoidTarget(null);
        }}
      />
    </>
  );
}
