import type { BalanceDto, MoneySummaryDto } from "@shared/api-types";
import { Link } from "@tanstack/react-router";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  HandCoins,
  Minus,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button, IconButton } from "../../components/ui/button";
import { Avatar, Card, CardHeader, KpiTile, Pill } from "../../components/ui/display";
import { ErrorState, Skeleton } from "../../components/ui/feedback";
import { errorMessage } from "../../lib/api";
import { type Format, fullName, plural, useFormat } from "../../lib/format";
import { useOnline } from "../../lib/offline";
import { BreakdownBars } from "./breakdown-bars";
import { CLIENT_MONEY_SEARCH } from "./ledger";
import { CHARGE_KIND_LABELS, compactMoney, monthLabel, shiftMonth, shortDate } from "./money-data";
import { MonthBars } from "./month-bars";

/** Full amount for screen readers, compact amount on screen. */
function Fit({ minor, fmt }: { minor: number; fmt: Format }) {
  const shown = compactMoney(minor, fmt);
  const full = fmt.money(minor);
  if (shown === full) return <>{shown}</>;
  return (
    <>
      <span aria-hidden>{shown}</span>
      <span className="sr-only">{full}</span>
    </>
  );
}

export function MonthSwitcher({
  month,
  current,
  onChange,
  dark = false,
}: {
  month: string;
  current: string;
  onChange: (month: string) => void;
  dark?: boolean;
}) {
  const fmt = useFormat();
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  return (
    <div className="flex items-center gap-2">
      <IconButton
        label={`Previous month, ${fmt.month(prev)}`}
        variant={dark ? "night" : "white"}
        onPress={() => onChange(prev)}
      >
        <ChevronLeft aria-hidden className="size-5" />
      </IconButton>
      <IconButton
        label={`Next month, ${fmt.month(next)}`}
        variant={dark ? "night" : "white"}
        isDisabled={month >= current}
        onPress={() => onChange(next)}
      >
        <ChevronRight aria-hidden className="size-5" />
      </IconButton>
    </div>
  );
}

/** Phone month control for the dark header: ‹ October 2026 › in one pill. */
export function MonthStepper({
  month,
  current,
  onChange,
}: {
  month: string;
  current: string;
  onChange: (month: string) => void;
}) {
  const fmt = useFormat();
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  return (
    <div className="flex items-center justify-between gap-2 rounded-full bg-night-2 p-1.5">
      <IconButton
        label={`Previous month, ${fmt.month(prev)}`}
        variant="night"
        onPress={() => onChange(prev)}
      >
        <ChevronLeft aria-hidden className="size-5" />
      </IconButton>
      <p aria-live="polite" className="text-[1rem] font-medium">
        {fmt.month(month)}
      </p>
      <IconButton
        label={`Next month, ${fmt.month(next)}`}
        variant="night"
        isDisabled={month >= current}
        onPress={() => onChange(next)}
      >
        <ChevronRight aria-hidden className="size-5" />
      </IconButton>
    </div>
  );
}

export function MoneyKpis({
  summary,
  paymentCount,
  onReceived,
  onCharged,
  onOutstanding,
  onPayments,
}: {
  summary?: MoneySummaryDto;
  paymentCount?: number;
  onReceived: () => void;
  onCharged: () => void;
  onOutstanding: () => void;
  onPayments: () => void;
}) {
  const fmt = useFormat();
  const dash = "–";
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <KpiTile
        label="Received"
        tint="lime"
        hint="Show this month's payments"
        value={summary ? <Fit minor={summary.receivedMinor} fmt={fmt} /> : dash}
        onPress={onReceived}
      />
      <KpiTile
        label="Charged"
        tint="sky"
        hint="Show this month's charges"
        value={summary ? <Fit minor={summary.chargedMinor} fmt={fmt} /> : dash}
        onPress={onCharged}
      />
      <KpiTile
        label="Outstanding"
        tint="coral"
        hint="Show who owes you"
        value={summary ? <Fit minor={summary.outstandingMinor} fmt={fmt} /> : dash}
        onPress={onOutstanding}
      />
      <KpiTile
        label="Payments"
        tint="violet"
        hint="Show this month's payments"
        value={paymentCount ?? dash}
        onPress={onPayments}
      />
    </div>
  );
}

function oldestText(b: BalanceDto, fmt: Format) {
  return b.oldestUnpaidOn
    ? `Owed since ${shortDate(b.oldestUnpaidOn, fmt.locale)}`
    : "Unpaid charges";
}

/** Dark "who owes" tiles for the command panel. */
export function OwesTiles({
  balances,
  isPending,
  error,
  onRetry,
  onRecord,
}: {
  balances?: BalanceDto[];
  isPending: boolean;
  error: Error | null;
  onRetry: () => void;
  onRecord: (b: BalanceDto) => void;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const total = (balances ?? []).reduce((s, b) => s + b.balanceMinor, 0);
  return (
    <section
      id="money-owes"
      aria-labelledby="money-owes-heading"
      className="flex scroll-mt-4 flex-col gap-2.5"
    >
      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <h3 id="money-owes-heading" className="text-[1.125rem] font-light">
          Who owes
        </h3>
        {balances?.length ? (
          <span className="num text-[0.8125rem] text-night-ink-2">
            {plural(balances.length, "client")} · {fmt.moneyShort(total)}
          </span>
        ) : null}
      </div>
      {isPending ? (
        <>
          <Skeleton dark className="h-[128px] rounded-[24px]" />
          <Skeleton dark className="h-[128px] rounded-[24px]" />
        </>
      ) : !balances ? (
        <div className="rounded-[24px] bg-night-2 p-5">
          <p className="text-night-ink">Couldn't load balances.</p>
          <p className="mt-1 text-[0.8125rem] text-night-ink-2">{errorMessage(error)}</p>
          <Button
            variant="lime"
            size="md"
            className="mt-4 data-[focus-visible]:outline-lime"
            onPress={onRetry}
          >
            Try again
          </Button>
        </div>
      ) : balances.length === 0 ? (
        <div className="rounded-[24px] bg-night-2 p-5">
          <p className="text-night-ink">Everyone's paid up.</p>
          <p className="mt-1 text-[0.8125rem] text-night-ink-2">
            Nobody owes you anything right now.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {balances.map((b) => (
            <li
              key={b.clientId}
              className="rounded-[24px] bg-night-2 p-4 text-night-ink [--avatar-ring:var(--color-night-2)]"
            >
              <Link
                to="/clients/$clientId"
                params={{ clientId: b.clientId }}
                search={CLIENT_MONEY_SEARCH}
                className="flex items-start gap-3 rounded-[16px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime"
              >
                <Avatar person={b} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{fullName(b)}</span>
                  <span className="num block truncate text-[0.75rem] text-night-ink-2">
                    {oldestText(b, fmt)}
                  </span>
                </span>
                <ArrowUpRight aria-hidden className="size-4 shrink-0 text-night-ink-2" />
              </Link>
              <button
                type="button"
                disabled={!online}
                onClick={() => onRecord(b)}
                aria-label={`Record a payment from ${fullName(b)}, who owes ${fmt.money(b.balanceMinor)}`}
                className="mt-3 flex h-11 w-full cursor-pointer items-center gap-2 rounded-full border border-night-4 px-3 text-left outline-none transition-colors hover:bg-night-3 focus-visible:outline-2 focus-visible:outline-lime disabled:cursor-not-allowed disabled:opacity-60"
              >
                <HandCoins aria-hidden className="size-4 shrink-0" />
                <span className="flex-1 truncate text-[0.8125rem]">
                  {online ? "Record payment" : "Offline"}
                </span>
                <Pill tone="coral">
                  <span className="num">{fmt.moneyShort(b.balanceMinor)}</span>
                </Pill>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Light "who owes" card for phones. */
export function OwesCard({
  balances,
  isPending,
  error,
  onRetry,
  onRecord,
}: {
  balances?: BalanceDto[];
  isPending: boolean;
  error: Error | null;
  onRetry: () => void;
  onRecord: (b: BalanceDto) => void;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const total = (balances ?? []).reduce((s, b) => s + b.balanceMinor, 0);
  return (
    <div id="money-owes" className="scroll-mt-4">
      <Card label="Who owes">
        <CardHeader
          title="Who owes"
          action={
            balances?.length ? (
              <Pill tone="coral">
                <span className="num">{fmt.moneyShort(total)}</span>
              </Pill>
            ) : null
          }
        />
        {isPending ? (
          <div className="flex flex-col gap-2 px-5 pb-5">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : !balances ? (
          <div className="px-5 pb-2">
            <ErrorState
              title="Couldn't load balances"
              message={errorMessage(error)}
              onRetry={onRetry}
            />
          </div>
        ) : balances.length === 0 ? (
          <p className="px-5 pb-5 text-ink-2">Everyone's paid up. Nobody owes you anything.</p>
        ) : (
          <ul className="flex flex-col px-3 pb-3">
            {balances.map((b) => (
              <li key={b.clientId} className="flex items-center gap-1">
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: b.clientId }}
                  search={CLIENT_MONEY_SEARCH}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 py-2.5 outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
                >
                  <Avatar person={b} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{fullName(b)}</span>
                    <span className="num block truncate text-[0.8125rem] text-ink-2">
                      {oldestText(b, fmt)}
                    </span>
                  </span>
                  <Pill tone="coral">
                    <span className="num">{fmt.moneyShort(b.balanceMinor)}</span>
                  </Pill>
                </Link>
                <IconButton
                  label={`Record a payment from ${fullName(b)}`}
                  variant="soft"
                  isDisabled={!online}
                  onPress={() => onRecord(b)}
                >
                  <HandCoins aria-hidden className="size-5" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ChangeLine({ summary, fmt }: { summary: MoneySummaryDto; fmt: Format }) {
  const months = summary.months;
  const now = months.at(-1)?.receivedMinor ?? summary.receivedMinor;
  const prevMonth = months.at(-2);
  if (!prevMonth) return null;
  const prev = prevMonth.receivedMinor;
  const prevName = monthLabel(prevMonth.month, fmt.locale);
  let pill: ReactNode = null;
  let text: string;
  if (prev === 0) {
    text = now > 0 ? `Nothing came in during ${prevName}` : `Nothing in ${prevName} either`;
  } else {
    const change = (now - prev) / prev;
    const pct = Math.round(Math.abs(change) * 100);
    const Icon = pct === 0 ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
    pill = (
      <Pill tone="white" size="md" className="h-8 px-3">
        <Icon aria-hidden className="size-4" />
        <span className="sr-only">{pct === 0 ? "Level" : change > 0 ? "Up" : "Down"}</span>
        <span className="num">{pct}%</span>
      </Pill>
    );
    text = `vs ${fmt.moneyShort(prev)} in ${prevName}`;
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {pill}
      <span className="text-[0.875rem] text-ink/80">{text}</span>
    </div>
  );
}

/** Lavender hero: the month's received figure, the change, and six months of bars. */
export function ReceivedHero({
  summary,
  chart,
  month,
  paymentCount,
  isRefreshing,
  onSelectMonth,
  onShowPayments,
}: {
  summary: MoneySummaryDto;
  chart: MoneySummaryDto;
  month: string;
  paymentCount?: number;
  isRefreshing: boolean;
  onSelectMonth: (month: string) => void;
  onShowPayments: () => void;
}) {
  const fmt = useFormat();
  const blank = chart.months.every((m) => m.receivedMinor === 0 && m.chargedMinor === 0);
  return (
    <section
      aria-labelledby="received-heading"
      aria-busy={isRefreshing}
      className={`rounded-[28px] bg-lavender p-5 text-ink transition-opacity sm:p-6 ${isRefreshing ? "opacity-70" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="received-heading"
            className="text-[1.375rem] leading-tight font-light tracking-[-0.01em]"
          >
            Received in {monthLabel(month, fmt.locale)}
          </h2>
          <p className="mt-1 text-[0.8125rem] text-ink/75">
            Payments recorded, by the day they were paid
          </p>
        </div>
        {paymentCount ? (
          <Button variant="light" size="md" onPress={onShowPayments}>
            {plural(paymentCount, "payment")}
            <ArrowUpRight aria-hidden className="size-4" />
          </Button>
        ) : null}
      </div>
      <p className="num mt-5 text-[3rem] leading-none font-light tracking-[-0.03em] sm:text-[3.5rem]">
        {fmt.moneyShort(summary.receivedMinor)}
      </p>
      <ChangeLine summary={summary} fmt={fmt} />
      <div className="mt-7">
        {blank ? (
          <p className="rounded-[20px] bg-white/40 px-4 py-4 text-[0.9375rem] text-ink/80">
            Six months of payments and charges chart here once money starts moving. Each month opens
            its own lines.
          </p>
        ) : (
          <MonthBars months={chart.months} selected={month} onSelect={onSelectMonth} fmt={fmt} />
        )}
      </div>
    </section>
  );
}

export function HeroSkeleton() {
  return (
    <div aria-busy="true" className="rounded-[28px] bg-lavender/60 p-6">
      <span className="sr-only">Loading money…</span>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="mt-6 h-14 w-56" />
      <Skeleton className="mt-8 h-44 w-full" />
    </div>
  );
}

/** Lime card: what was billed this month, by type. Rows filter the charges list. */
export function ChargedCard({
  summary,
  month,
  selectedKind,
  onSelectKind,
}: {
  summary: MoneySummaryDto;
  month: string;
  selectedKind: string | null;
  onSelectKind: (kind: string | null) => void;
}) {
  const fmt = useFormat();
  const items = [...summary.byKind]
    .sort((a, b) => b.amountMinor - a.amountMinor)
    .map((k) => ({ id: k.kind, label: CHARGE_KIND_LABELS[k.kind], amountMinor: k.amountMinor }));
  return (
    <section aria-labelledby="charged-heading" className="rounded-[28px] bg-lime p-5 text-ink">
      <h2
        id="charged-heading"
        className="text-[1.375rem] leading-tight font-light tracking-[-0.01em]"
      >
        Charged in {monthLabel(month, fmt.locale)}
      </h2>
      <p className="mt-1 text-[0.8125rem] text-ink/75">Sessions, packages, and events billed</p>
      <p className="num mt-4 text-[2.25rem] leading-none font-light tracking-[-0.02em]">
        {fmt.moneyShort(summary.chargedMinor)}
      </p>
      <div className="mt-4">
        {items.length ? (
          <BreakdownBars
            items={items}
            fmt={fmt}
            surface="lime"
            selectedId={selectedKind}
            onSelect={onSelectKind}
            filterHint="Show only these charges"
          />
        ) : (
          <p className="text-[0.9375rem] text-ink/75">Nothing charged yet this month.</p>
        )}
      </div>
    </section>
  );
}

/** White card: where the month's money came in, by payment method. Rows filter payments. */
export function MethodsCard({
  summary,
  month,
  selectedMethod,
  onSelectMethod,
}: {
  summary: MoneySummaryDto;
  month: string;
  selectedMethod: string | null;
  onSelectMethod: (method: string | null) => void;
}) {
  const fmt = useFormat();
  const items = [...summary.byMethod]
    .sort((a, b) => b.amountMinor - a.amountMinor)
    .map((m) => ({ id: m.method, label: m.method, amountMinor: m.amountMinor }));
  return (
    <Card label="Received by method">
      <CardHeader title="Received by method" />
      <div className="px-5 pb-4">
        {items.length ? (
          <BreakdownBars
            items={items}
            fmt={fmt}
            selectedId={selectedMethod}
            onSelect={onSelectMethod}
            filterHint="Show only these payments"
          />
        ) : (
          <p className="pb-1 text-ink-2">No payments in {monthLabel(month, fmt.locale)} yet.</p>
        )}
      </div>
    </Card>
  );
}
