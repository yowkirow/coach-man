import type { ClientListItemDto, GroupDto } from "@shared/api-types";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FileUp, SearchX, UserPlus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { LedgerSheet } from "../../components/domain/roster";
import { Page, ShellAside, SyncStatus, useIsDesktop } from "../../components/layout/app-shell";
import { Button, buttonClass } from "../../components/ui/button";
import { Card, PageHeader } from "../../components/ui/display";
import { EmptyState, ErrorState, RowsSkeleton, Skeleton } from "../../components/ui/feedback";
import { SearchField, Segmented } from "../../components/ui/field";
import { ClientRow, PhoneClientRow } from "../../features/clients/client-list";
import {
  isNewThisMonth,
  type ListSearch,
  matchesQuery,
  needsPackage,
  owesMoney,
  parseListSearch,
  type QuickFilter,
  type StatusFilter,
} from "../../features/clients/client-utils";
import { useAllClients, useGroupMap } from "../../features/clients/queries";
import { errorMessage } from "../../lib/api";
import { fullName, plural, useFormat } from "../../lib/format";
import { useCan, useGroups, useMe } from "../../lib/hooks";

export const Route = createFileRoute("/_app/clients/")({
  validateSearch: (
    s: Record<string, unknown>,
  ): {
    q?: string;
    status?: "active" | "lead" | "paused" | "archived";
    group?: string;
    filter?: "low" | "owes" | "new";
  } => parseListSearch(s),
  component: ClientsPage,
});

const QUICK_LABELS: Record<QuickFilter, string> = {
  low: "Low credits",
  owes: "Owe money",
  new: "New this month",
};

const STATUS_CHOICES: { id: StatusFilter | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "lead", label: "Leads" },
  { id: "paused", label: "Paused" },
  { id: "archived", label: "Archived" },
];

interface Counts {
  all: number;
  active: number;
  lead: number;
  paused: number;
  archived: number;
  low: number;
  owes: number;
  new: number;
}

function useClientList(search: ListSearch) {
  const fmt = useFormat();
  const today = fmt.today();
  const { current, archived } = useAllClients();
  const base = search.status === "archived" ? archived : current;

  const counts = useMemo<Counts | null>(() => {
    const list = current.data;
    if (!list) return null;
    return {
      all: list.length,
      active: list.filter((c) => c.status === "active").length,
      lead: list.filter((c) => c.status === "lead").length,
      paused: list.filter((c) => c.status === "paused").length,
      archived: archived.data?.length ?? 0,
      low: list.filter((c) => needsPackage(c, today)).length,
      owes: list.filter(owesMoney).length,
      new: list.filter((c) => isNewThisMonth(c, today)).length,
    };
  }, [current.data, archived.data, today]);

  const rows = useMemo(() => {
    const list = (base.data ?? []).filter(
      (c) =>
        (!search.status || c.status === search.status) &&
        (!search.group || c.groupIds.includes(search.group)) &&
        (search.filter === "low"
          ? needsPackage(c, today)
          : search.filter === "owes"
            ? owesMoney(c)
            : search.filter === "new"
              ? isNewThisMonth(c, today)
              : true) &&
        matchesQuery(c, search.q ?? ""),
    );
    if (search.filter === "owes") return list.sort((a, b) => b.balanceMinor - a.balanceMinor);
    if (search.filter === "low")
      return list.sort((a, b) => a.creditsRemaining - b.creditsRemaining);
    return list;
  }, [base.data, search, today]);

  return { base, current, counts, rows, today };
}

function ClientsPage() {
  const can = useCan();
  const raw = Route.useSearch();
  // "Owe money" is a money list: coaches never get balances, so an old link shows everyone.
  const search: ListSearch =
    !can.money && raw.filter === "owes" ? { ...raw, filter: undefined } : raw;
  const navigate = useNavigate({ from: Route.fullPath });
  const desktop = useIsDesktop();
  const me = useMe().data;
  const groups = useGroupMap();
  const groupList = useGroups();
  const { base, current, counts, rows, today } = useClientList(search);
  const [ledgerFor, setLedgerFor] = useState<ClientListItemDto | null>(null);

  const setSearch = (patch: Partial<ListSearch>) =>
    void navigate({
      search: (prev: ListSearch) => {
        const next: ListSearch = { ...prev, ...patch };
        for (const k of Object.keys(next) as (keyof ListSearch)[]) if (!next[k]) delete next[k];
        return next;
      },
      replace: true,
    });

  const filtered = Boolean(search.q || search.status || search.group || search.filter);
  const noClientsYet = current.data?.length === 0 && !search.status;
  const activeGroups = (groupList.data ?? []).filter((g) => !g.archivedAt);
  const selectedGroup = search.group ? groups.get(search.group) : undefined;

  const list = (
    <ClientListBody
      isPending={base.isPending && !base.data}
      error={!base.data && base.isError ? base.error : null}
      onRetry={() => void base.refetch()}
      rows={rows}
      noClientsYet={noClientsYet}
      filtered={filtered}
      onClear={() =>
        setSearch({ q: undefined, status: undefined, group: undefined, filter: undefined })
      }
      desktop={desktop}
      groups={groups}
      today={today}
      onOpenLedger={setLedgerFor}
    />
  );

  return (
    <>
      <ShellAside>
        <ListPanel search={search} counts={counts} groups={activeGroups} current={current.data} />
      </ShellAside>

      {desktop ? (
        <Page className="flex flex-col gap-5 pb-6">
          <PageHeader
            title="Clients"
            subtitle={
              counts ? (
                <span className="num">
                  {plural(counts.all, "client")} · {counts.active} active
                  {counts.lead ? ` · ${plural(counts.lead, "lead")}` : ""}
                </span>
              ) : (
                <Skeleton className="h-4 w-40" />
              )
            }
            actions={
              <>
                {can.data ? (
                  <Link to="/import" className={buttonClass("light")}>
                    <FileUp aria-hidden className="size-4.5" />
                    Import
                  </Link>
                ) : null}
                <Link to="/clients/new" className={buttonClass("dark")}>
                  <UserPlus aria-hidden className="size-4.5" />
                  Add client
                </Link>
              </>
            }
          />
          {me?.hasSampleData ? <SampleNote /> : null}
          <div className="flex flex-wrap items-end gap-3">
            <SearchField
              label="Search clients"
              placeholder="Search by name, email, or phone"
              value={search.q ?? ""}
              onChange={(v) => setSearch({ q: v || undefined })}
              className="min-w-[16rem] flex-1 basis-[18rem]"
            />
            <Segmented
              label="Status"
              hideLabel
              className="w-full max-w-[34rem] basis-[30rem]"
              value={search.status ?? "all"}
              onChange={(v) => setSearch({ status: v === "all" ? undefined : (v as StatusFilter) })}
              options={STATUS_CHOICES.map((o) => ({ id: o.id, label: o.label }))}
            />
          </div>
          <ActiveFilters
            search={search}
            group={selectedGroup}
            onClear={(key) => setSearch({ [key]: undefined })}
          />
          {list}
        </Page>
      ) : (
        <Page className="flex flex-col gap-4">
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-[2rem] leading-[1.1] font-light tracking-[-0.02em]">Clients</h1>
              <p className="num mt-1.5 text-[0.9375rem] text-ink-2">
                {counts
                  ? can.money
                    ? `${counts.active} active · ${counts.owes} owe money`
                    : `${counts.active} active · ${counts.low} low on credits`
                  : "Loading…"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <SyncStatus />
              {can.data ? (
                <Link
                  to="/import"
                  aria-label="Import clients"
                  className="flex size-11 items-center justify-center rounded-full bg-card text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  <FileUp aria-hidden className="size-5" />
                </Link>
              ) : null}
              <Link
                to="/clients/new"
                aria-label="Add client"
                className="flex size-11 items-center justify-center rounded-full bg-lime text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                <UserPlus aria-hidden className="size-5" />
              </Link>
            </div>
          </header>
          <SearchField
            label="Search clients"
            placeholder="Name, email, or phone"
            value={search.q ?? ""}
            onChange={(v) => setSearch({ q: v || undefined })}
          />
          <PhoneFilters
            search={search}
            counts={counts}
            groups={activeGroups}
            onChange={setSearch}
          />
          {me?.hasSampleData ? <SampleNote /> : null}
          {list}
        </Page>
      )}

      <LedgerSheet
        isOpen={ledgerFor !== null}
        onOpenChange={(o) => {
          if (!o) setLedgerFor(null);
        }}
        clientId={ledgerFor?.id ?? ""}
        name={ledgerFor ? fullName(ledgerFor) : ""}
        balanceMinor={ledgerFor?.balanceMinor}
      />
    </>
  );
}

function SampleNote() {
  return (
    <p className="rounded-[22px] bg-panel px-4 py-3 text-[0.875rem] text-ink-2">
      Clients tagged <span className="font-medium text-ink">Sample</span> are synthetic demo data.
      Remove them in{" "}
      <Link to="/settings" className="font-medium text-ink underline underline-offset-4">
        Settings
      </Link>{" "}
      when you're ready.
    </p>
  );
}

function ClientListBody({
  isPending,
  error,
  onRetry,
  rows,
  noClientsYet,
  filtered,
  onClear,
  desktop,
  groups,
  today,
  onOpenLedger,
}: {
  isPending: boolean;
  error: Error | null;
  onRetry: () => void;
  rows: ClientListItemDto[];
  noClientsYet: boolean;
  filtered: boolean;
  onClear: () => void;
  desktop: boolean;
  groups: Map<string, GroupDto>;
  today: string;
  onOpenLedger: (c: ClientListItemDto) => void;
}) {
  if (isPending) {
    return (
      <Card className="px-5 py-2">
        <RowsSkeleton rows={6} />
      </Card>
    );
  }
  if (error) {
    return (
      <Card className="px-6 py-2">
        <ErrorState message={errorMessage(error)} onRetry={onRetry} />
      </Card>
    );
  }
  if (noClientsYet && !filtered) {
    return (
      <Card className="px-6 py-4">
        <EmptyState
          icon={<UserPlus aria-hidden className="size-5" />}
          title="No clients yet"
          body="Add your first client, or bring your list over from a spreadsheet. A first name is enough to start; contact details, levels, and groups can come later. New workspaces can start with sample clients, which are clearly tagged as synthetic."
          action={
            <div className="flex flex-wrap gap-2">
              <Link to="/clients/new" className={buttonClass("dark")}>
                <UserPlus aria-hidden className="size-4.5" />
                Add client
              </Link>
              <Link to="/import" className={buttonClass("light")}>
                <FileUp aria-hidden className="size-4.5" />
                Import a CSV
              </Link>
            </div>
          }
        />
      </Card>
    );
  }
  if (rows.length === 0) {
    return (
      <Card className="px-6 py-4">
        <EmptyState
          icon={<SearchX aria-hidden className="size-5" />}
          title="No clients match"
          body="Try a different name, email, or phone number, or clear the filters to see everyone."
          action={
            <Button variant="dark" onPress={onClear}>
              Clear filters
            </Button>
          }
        />
      </Card>
    );
  }
  return (
    <Card label="Client list" className={desktop ? "px-3 py-3" : "px-3 py-2"}>
      <ul className="flex flex-col">
        {rows.map((c) =>
          desktop ? (
            <ClientRow
              key={c.id}
              client={c}
              groups={groups}
              today={today}
              onOpenLedger={onOpenLedger}
            />
          ) : (
            <PhoneClientRow key={c.id} client={c} groups={groups} />
          ),
        )}
      </ul>
      <p className="num px-3 pt-2 pb-1 text-[0.8125rem] text-ink-2">
        Showing {plural(rows.length, "client")}
      </p>
    </Card>
  );
}

function ActiveFilters({
  search,
  group,
  onClear,
}: {
  search: ListSearch;
  group?: GroupDto;
  onClear: (key: "filter" | "group") => void;
}) {
  const chips: { key: "filter" | "group"; label: string }[] = [];
  if (search.filter) chips.push({ key: "filter", label: QUICK_LABELS[search.filter] });
  if (search.group) chips.push({ key: "group", label: group?.name ?? "Group" });
  if (!chips.length) return null;
  return (
    <ul aria-label="Active filters" className="-mt-1 flex flex-wrap gap-2">
      {chips.map((c) => (
        <li key={c.key}>
          <button
            type="button"
            onClick={() => onClear(c.key)}
            aria-label={`Remove filter: ${c.label}`}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-ink pr-2 pl-4 text-[0.875rem] font-medium text-white outline-none hover:bg-night-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {c.label}
            <X aria-hidden className="size-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}

interface Chip {
  id: string;
  label: string;
  count?: number;
  on: boolean;
  patch: Partial<ListSearch>;
}

function PhoneFilters({
  search,
  counts,
  groups,
  onChange,
}: {
  search: ListSearch;
  counts: Counts | null;
  groups: GroupDto[];
  onChange: (patch: Partial<ListSearch>) => void;
}) {
  const can = useCan();
  const chips: Chip[] = [
    {
      id: "all",
      label: "All",
      count: counts?.all,
      on: !search.status && !search.filter && !search.group,
      patch: { status: undefined, filter: undefined, group: undefined },
    },
    {
      id: "low",
      label: "Low credits",
      count: counts?.low,
      on: search.filter === "low",
      patch: { filter: search.filter === "low" ? undefined : "low" },
    },
    ...(can.money
      ? [
          {
            id: "owes",
            label: "Owe money",
            count: counts?.owes,
            on: search.filter === "owes",
            patch: { filter: search.filter === "owes" ? undefined : ("owes" as const) },
          },
        ]
      : []),
    {
      id: "lead",
      label: "Leads",
      count: counts?.lead,
      on: search.status === "lead",
      patch: { status: search.status === "lead" ? undefined : "lead" },
    },
    {
      id: "paused",
      label: "Paused",
      count: counts?.paused,
      on: search.status === "paused",
      patch: { status: search.status === "paused" ? undefined : "paused" },
    },
    ...groups.map(
      (g): Chip => ({
        id: g.id,
        label: g.name,
        on: search.group === g.id,
        patch: { group: search.group === g.id ? undefined : g.id },
      }),
    ),
    {
      id: "archived",
      label: "Archived",
      count: counts?.archived,
      on: search.status === "archived",
      patch: { status: search.status === "archived" ? undefined : "archived" },
    },
  ];
  return (
    <ul aria-label="Filters" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {chips.map((c) => (
        <li key={c.id} className="shrink-0">
          <button
            type="button"
            aria-pressed={c.on}
            onClick={() => onChange(c.patch)}
            className={`inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full px-4 text-[0.875rem] font-medium whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
              c.on ? "bg-ink text-white" : "bg-card text-ink"
            }`}
          >
            {c.label}
            {c.count !== undefined ? (
              <span className={`num ${c.on ? "text-white/70" : "text-ink-2"}`}>{c.count}</span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

const TILE_TINTS = {
  lime: { tint: "rgb(218 238 99 / 0.22)", border: "border-lime" },
  amber: { tint: "rgb(248 212 119 / 0.2)", border: "border-amber" },
  coral: { tint: "rgb(248 113 113 / 0.22)", border: "border-coral" },
  sky: { tint: "rgb(110 168 255 / 0.22)", border: "border-sky" },
  violet: { tint: "rgb(201 190 251 / 0.22)", border: "border-violet" },
} as const;

/** KPI tile that doubles as a filter; the selected one turns lime like a selected list card. */
function FilterKpi({
  label,
  value,
  tint,
  selected,
  search,
  hint,
}: {
  label: string;
  value: number | string;
  tint: keyof typeof TILE_TINTS;
  selected: boolean;
  search: ListSearch;
  hint: string;
}) {
  const t = TILE_TINTS[tint];
  return (
    <Link
      to="/clients"
      search={search}
      title={hint}
      aria-current={selected ? "true" : undefined}
      style={{ ["--tile-tint" as string]: selected ? "transparent" : t.tint }}
      className={`tile-glow flex h-[104px] flex-col rounded-[22px] p-4 outline-none transition-[filter,background-color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime ${
        selected ? "bg-lime text-ink" : "bg-night-2 text-night-ink hover:brightness-125"
      }`}
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={`size-4.5 rounded-[6px] border-[1.5px] ${selected ? "border-ink" : t.border}`}
        />
        <span className={`text-[0.8125rem] ${selected ? "text-ink" : "text-night-ink/85"}`}>
          {label}
        </span>
      </span>
      <span className="num mt-auto self-end text-[2rem] leading-none font-light">{value}</span>
    </Link>
  );
}

function FilterRow({
  label,
  count,
  selected,
  search,
  color,
}: {
  label: string;
  count?: number;
  selected: boolean;
  search: ListSearch;
  color?: string | null;
}) {
  return (
    <Link
      to="/clients"
      search={search}
      aria-current={selected ? "true" : undefined}
      className={`flex h-12 items-center gap-3 rounded-full px-4 text-[0.9375rem] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime ${
        selected ? "bg-lime text-ink" : "bg-night-2 text-night-ink hover:bg-night-3"
      }`}
    >
      {color !== undefined ? (
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color ?? "var(--color-violet)" }}
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? (
        <span className={`num text-[0.875rem] ${selected ? "text-ink/70" : "text-night-ink-2"}`}>
          {count}
        </span>
      ) : null}
    </Link>
  );
}

function ListPanel({
  search,
  counts,
  groups,
  current,
}: {
  search: ListSearch;
  counts: Counts | null;
  groups: GroupDto[];
  current?: ClientListItemDto[];
}) {
  const dash = "–";
  const can = useCan();
  const q: ListSearch = search.q ? { q: search.q } : {};
  const plain = !search.status && !search.filter && !search.group;
  const groupCount = (id: string) => current?.filter((c) => c.groupIds.includes(id)).length;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-2 px-1">
        <div>
          <h2 className="text-[1.75rem] leading-tight font-light tracking-[-0.01em]">Roster</h2>
          <p className="num mt-1 text-[0.875rem] text-night-ink-2">
            {counts
              ? `${plural(counts.all, "client")} · ${plural(groups.length, "group")}`
              : "Loading…"}
          </p>
        </div>
        <SyncStatus dark />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <FilterKpi
          label="Active"
          value={counts?.active ?? dash}
          tint="lime"
          selected={search.status === "active" && !search.filter && !search.group}
          search={{ ...q, status: "active" }}
          hint="Clients marked active"
        />
        <FilterKpi
          label="Low credits"
          value={counts?.low ?? dash}
          tint="amber"
          selected={search.filter === "low"}
          search={{ ...q, filter: "low" }}
          hint="One credit or fewer left, used up, or expiring within a week"
        />
        {can.money ? (
          <FilterKpi
            label="Owe money"
            value={counts?.owes ?? dash}
            tint="coral"
            selected={search.filter === "owes"}
            search={{ ...q, filter: "owes" }}
            hint="Clients with a balance due"
          />
        ) : (
          <FilterKpi
            label="Leads"
            value={counts?.lead ?? dash}
            tint="violet"
            selected={search.status === "lead" && !search.filter && !search.group}
            search={{ ...q, status: "lead" }}
            hint="People interested but not yet training"
          />
        )}
        <FilterKpi
          label="New this month"
          value={counts?.new ?? dash}
          tint="sky"
          selected={search.filter === "new"}
          search={{ ...q, filter: "new" }}
          hint="Joined this calendar month"
        />
      </div>

      <nav aria-label="Client lists" className="flex flex-col gap-2">
        <h3 className="px-1 pt-1 text-[1.125rem] font-light">Lists</h3>
        <FilterRow label="Everyone" count={counts?.all} selected={plain} search={q} />
        <FilterRow
          label="Leads"
          count={counts?.lead}
          selected={search.status === "lead"}
          search={{ ...q, status: "lead" }}
        />
        <FilterRow
          label="Paused"
          count={counts?.paused}
          selected={search.status === "paused"}
          search={{ ...q, status: "paused" }}
        />
        <FilterRow
          label="Archived"
          count={counts?.archived}
          selected={search.status === "archived"}
          search={{ ...q, status: "archived" }}
        />
        {groups.length ? (
          <>
            <div className="flex items-center justify-between px-1 pt-3">
              <h3 className="text-[1.125rem] font-light">Groups</h3>
              <Link
                to="/groups"
                className="rounded-full px-2 py-1 text-[0.8125rem] text-night-ink-2 outline-none hover:text-night-ink focus-visible:outline-2 focus-visible:outline-lime"
              >
                Manage
              </Link>
            </div>
            {groups.map((g) => (
              <FilterRow
                key={g.id}
                label={g.name}
                count={groupCount(g.id)}
                color={g.color}
                selected={search.group === g.id}
                search={{ ...q, group: g.id }}
              />
            ))}
          </>
        ) : null}
      </nav>
    </div>
  );
}
