import type { ClientListItemDto, GroupDto } from "@shared/api-types";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  CalendarClock,
  CalendarX2,
  ChevronRight,
  CircleDollarSign,
  HeartPulse,
} from "lucide-react";
import type { ReactNode } from "react";
import { Avatar, Pill } from "../../components/ui/display";
import { fullName, useFormat } from "../../lib/format";
import { useCan } from "../../lib/hooks";
import {
  CREDIT_PILL,
  CREDIT_TEXT,
  type CreditTone,
  creditState,
  expiresSoon,
  groupNamesOf,
  isSample,
  type ListSearch,
  type ProfileTab,
  relativeDay,
  STATUS_LABELS,
  STATUS_TONES,
  shortDate,
  whenLabel,
} from "./client-utils";

const METER_FILL: Record<CreditTone, string> = {
  ok: "bg-ink",
  low: "bg-amber",
  out: "bg-coral",
  none: "bg-transparent",
};

/** Remaining-of-total bar. Fixed to the package size so 2 of 10 never looks like 2 of 2. */
export function CreditBar({
  remaining,
  total,
  tone,
  dark = false,
}: {
  remaining: number;
  total: number;
  tone: CreditTone;
  dark?: boolean;
}) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
  return (
    <span
      aria-hidden
      className={`block h-1.5 w-full overflow-hidden rounded-full ${
        tone === "out" ? "bg-coral/30" : dark ? "bg-white/15" : "bg-ink/10"
      }`}
    >
      <span
        className={`block h-full rounded-full transition-[width] duration-300 ease-out ${
          dark && tone === "ok" ? "bg-night-ink" : METER_FILL[tone]
        }`}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

/** Small pills shown beside a client's name. Phone rows skip "Sample": the banner explains it. */
export function NamePills({
  client,
  max = 3,
  sample = true,
}: {
  client: ClientListItemDto;
  max?: number;
  sample?: boolean;
}) {
  const pills: ReactNode[] = [];
  if (client.status !== "active")
    pills.push(
      <Pill key="status" tone={STATUS_TONES[client.status]}>
        {STATUS_LABELS[client.status]}
      </Pill>,
    );
  if (client.isJunior)
    pills.push(
      <Pill key="junior" tone="sky">
        Junior
      </Pill>,
    );
  if (client.level)
    pills.push(
      <Pill key="level" tone="panel">
        <span className="num">{client.level}</span>
      </Pill>,
    );
  if (sample && isSample(client))
    pills.push(
      <Pill key="sample" tone="outline">
        Sample
      </Pill>,
    );
  return <>{pills.slice(0, max)}</>;
}

/** Coral balance pill that opens the statement. Sits above the row's stretched link. */
function OwesLink({ client, className = "" }: { client: ClientListItemDto; className?: string }) {
  const fmt = useFormat();
  return (
    <Link
      to="/clients/$clientId"
      params={{ clientId: client.id }}
      search={{ tab: "money" }}
      aria-label={`${fullName(client)} owes ${fmt.money(client.balanceMinor)}. Open statement`}
      className={`relative z-10 inline-flex h-7 max-w-full items-center rounded-full bg-coral px-3 text-[0.75rem] font-medium text-ink outline-none hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${className}`}
    >
      <span className="num truncate">Owes {fmt.moneyShort(client.balanceMinor)}</span>
    </Link>
  );
}

/** A client row on the white list card. The name is the link; credits open their proof. */
export function ClientRow({
  client,
  groups,
  today,
  onOpenLedger,
}: {
  client: ClientListItemDto;
  groups: Map<string, GroupDto>;
  today: string;
  onOpenLedger: (client: ClientListItemDto) => void;
}) {
  const fmt = useFormat();
  // Balances are money: coaches don't get them, and nothing about them shows.
  const balance = useCan().money ? client.balanceMinor : 0;
  const credit = creditState(client);
  const names = groupNamesOf(client, groups);
  const contact = [client.email, client.phone].filter(Boolean).join(" · ");
  const soon = credit.tone === "ok" && expiresSoon(client, today);
  return (
    <li className="group relative flex items-center gap-4 rounded-[22px] px-3 py-3 transition-colors hover:bg-panel">
      <Avatar person={client} />
      <div className="min-w-[9rem] flex-1">
        {/* Pills wrap under the name instead of squeezing it. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to="/clients/$clientId"
            params={{ clientId: client.id }}
            className="max-w-full truncate text-[1rem] font-medium outline-none after:absolute after:inset-0 after:rounded-[22px] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ink"
          >
            {fullName(client)}
          </Link>
          <span className="flex flex-wrap items-center gap-1.5">
            <NamePills client={client} />
          </span>
          {balance > 0 ? <OwesLink client={client} className="xl:hidden" /> : null}
        </div>
        <p className="mt-0.5 truncate text-[0.8125rem] text-ink-2">
          {contact || "No contact details yet"}
        </p>
      </div>

      <div className="hidden w-[11.5rem] shrink-0 flex-wrap gap-1 xl:flex">
        {names.length ? (
          <>
            {names.slice(0, 2).map((n) => (
              <Pill key={n} tone="violet" className="max-w-[11rem] truncate">
                {n}
              </Pill>
            ))}
            {names.length > 2 ? <Pill tone="panel">+{names.length - 2}</Pill> : null}
          </>
        ) : (
          <span className="text-[0.8125rem] text-ink-2">No group</span>
        )}
      </div>

      <div className="w-[9.5rem] shrink-0">
        {credit.tone === "none" ? (
          <span className="text-[0.8125rem] text-ink-2">No package</span>
        ) : (
          <button
            type="button"
            onClick={() => onOpenLedger(client)}
            aria-label={`${fullName(client)}: ${credit.label}. Open credit history`}
            className="relative z-10 flex w-full cursor-pointer flex-col gap-1.5 rounded-xl px-2 py-1.5 text-left outline-none hover:bg-card focus-visible:outline-2 focus-visible:outline-ink"
          >
            <span className={`num text-[0.875rem] font-medium ${CREDIT_TEXT[credit.tone]}`}>
              {credit.tone === "out" ? "Used up" : `${credit.remaining} of ${credit.total} left`}
            </span>
            <CreditBar remaining={credit.remaining} total={credit.total} tone={credit.tone} />
            {soon && client.nextExpiryOn ? (
              <span className="text-[0.75rem] text-[#8a5300]">
                Expires {shortDate(client.nextExpiryOn, fmt)}
              </span>
            ) : null}
          </button>
        )}
      </div>

      <div className="hidden w-[8.5rem] shrink-0 xl:block">
        {balance > 0 ? (
          <OwesLink client={client} />
        ) : balance < 0 ? (
          <Pill tone="mint">
            <span className="num">{fmt.moneyShort(-balance)} credit</span>
          </Pill>
        ) : null}
      </div>

      <div className="hidden w-[7.5rem] shrink-0 text-[0.8125rem] text-ink-2 2xl:block">
        {client.lastSeenOn ? `Seen ${relativeDay(client.lastSeenOn, today).toLowerCase()}` : null}
      </div>

      <ArrowUpRight aria-hidden className="size-4 shrink-0 text-ink-3" />
    </li>
  );
}

/** Phone row: the whole row opens the profile. The balance owed sits on the second line. */
export function PhoneClientRow({
  client,
  groups,
}: {
  client: ClientListItemDto;
  groups: Map<string, GroupDto>;
}) {
  const fmt = useFormat();
  const credit = creditState(client);
  const names = groupNamesOf(client, groups);
  const owes = useCan().money && client.balanceMinor > 0;
  const warn = credit.tone === "low" || credit.tone === "out";
  return (
    <li>
      <Link
        to="/clients/$clientId"
        params={{ clientId: client.id }}
        className="flex items-center gap-3 rounded-[22px] px-2 py-3 outline-none active:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
      >
        <Avatar person={client} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="max-w-full truncate text-[1rem] font-medium">{fullName(client)}</span>
            <NamePills client={client} sample={false} />
          </span>
          <span className="num mt-0.5 block truncate text-[0.8125rem] text-ink-2">
            {owes ? (
              <span className="font-medium text-[#b42318]">
                Owes {fmt.moneyShort(client.balanceMinor)}
                <span className="font-normal text-ink-2"> · </span>
              </span>
            ) : null}
            <span className={warn ? CREDIT_TEXT[credit.tone] : undefined}>
              {credit.tone === "none" ? "No package" : credit.label}
            </span>
            {names[0] ? ` · ${names[0]}` : null}
          </span>
        </span>
        <ChevronRight aria-hidden className="size-4.5 shrink-0 text-ink-3" />
      </Link>
    </li>
  );
}

/** Dark worklist tile for the black command panel (reference: worklist cards). */
export function ClientTile({
  client,
  groups,
  selected,
  now,
  tab,
  tileRef,
}: {
  client: ClientListItemDto;
  groups: Map<string, GroupDto>;
  selected: boolean;
  now: number;
  tab?: ProfileTab;
  tileRef?: (el: HTMLAnchorElement | null) => void;
}) {
  const fmt = useFormat();
  const credit = creditState(client);
  const names = groupNamesOf(client, groups);
  const subtitle = [credit.tone === "none" ? "No package" : credit.short, names[0] ?? null]
    .filter(Boolean)
    .join(" · ");
  const owes = useCan().money && client.balanceMinor > 0;
  const RowIcon = owes ? CircleDollarSign : client.nextSessionAt ? CalendarClock : CalendarX2;
  const rowText = owes
    ? `Owes ${fmt.moneyShort(client.balanceMinor)}`
    : client.nextSessionAt
      ? whenLabel(client.nextSessionAt, null, fmt, now)
      : client.lastSeenOn
        ? `Seen ${relativeDay(client.lastSeenOn, fmt.today()).toLowerCase()}`
        : "Nothing booked";
  const pill = owes ? (
    <Pill tone={selected ? "white" : "coral"}>Due</Pill>
  ) : credit.tone === "none" ? (
    <Pill tone={selected ? "white" : "outline-dark"}>No pack</Pill>
  ) : (
    <Pill tone={selected ? "white" : CREDIT_PILL[credit.tone]}>
      <span className="num">{credit.remaining}</span> left
    </Pill>
  );
  return (
    <Link
      ref={tileRef}
      to="/clients/$clientId"
      params={{ clientId: client.id }}
      search={tab && tab !== "overview" ? { tab } : {}}
      aria-current={selected ? "page" : undefined}
      className={`group block rounded-[24px] p-4 outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime ${
        selected ? "bg-lime text-ink" : "bg-night-2 text-night-ink hover:bg-night-3"
      }`}
    >
      <div className="flex items-start gap-3">
        <Avatar person={client} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="line-clamp-2 text-[1rem] leading-snug">{fullName(client)}</span>
            {client.isJunior ? (
              <span className={`text-[0.6875rem] ${selected ? "text-ink/70" : "text-sky"}`}>
                Jr
              </span>
            ) : null}
          </span>
          <span
            className={`num block truncate text-[0.75rem] ${selected ? "text-ink/70" : "text-night-ink-2"}`}
          >
            {subtitle}
          </span>
        </span>
        <ArrowUpRight
          aria-hidden
          className={`size-4 shrink-0 ${selected ? "text-ink/70" : "text-night-ink-2"}`}
        />
      </div>
      <div
        className={`mt-3 flex h-11 items-center gap-2 rounded-full border px-3 ${selected ? "border-ink/15" : "border-night-4"}`}
      >
        <RowIcon aria-hidden className="size-4 shrink-0" />
        <span className="num flex-1 truncate text-[0.8125rem]">{rowText}</span>
        {pill}
      </div>
    </Link>
  );
}

/** Compact KPI tile for the profile's worklist panel; opens the filtered client list. */
export function MiniKpi({
  label,
  value,
  tint,
  search,
}: {
  label: string;
  value: ReactNode;
  tint: string;
  search: ListSearch;
}) {
  return (
    <Link
      to="/clients"
      search={search}
      style={{ ["--tile-tint" as string]: tint }}
      className="tile-glow flex h-[76px] flex-col justify-between rounded-[20px] bg-night-2 px-3 py-2.5 outline-none transition-[filter] hover:brightness-125 focus-visible:outline-2 focus-visible:outline-lime"
    >
      <span className="text-[0.75rem] leading-tight text-night-ink/85">{label}</span>
      <span className="num self-end text-[1.5rem] leading-none font-light text-night-ink">
        {value}
      </span>
    </Link>
  );
}

export function MedicalFlag({ label = "Medical note" }: { label?: string }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-coral-soft px-2.5 text-[0.75rem] font-medium text-[#7a1212]">
      <HeartPulse aria-hidden className="size-3.5" />
      {label}
    </span>
  );
}
