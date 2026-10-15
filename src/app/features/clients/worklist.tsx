import type { ClientListItemDto } from "@shared/api-types";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, UserPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SyncStatus } from "../../components/layout/app-shell";
import { Skeleton } from "../../components/ui/feedback";
import { SearchField } from "../../components/ui/field";
import { plural, useFormat } from "../../lib/format";
import { useClients, useNow } from "../../lib/hooks";
import { ClientTile, MiniKpi } from "./client-list";
import { matchesQuery, needsPackage, owesMoney, type ProfileTab } from "./client-utils";
import { useGroupMap } from "./queries";

const MAX_TILES = 80;

/**
 * The reference's left column for a client profile: search, compact KPIs, and every client as a
 * dark worklist card. The open client is lime.
 */
export function ClientWorklist({
  selectedId,
  current,
  tab,
}: {
  selectedId?: string;
  /** The open client, kept in the list even when archived. */
  current?: ClientListItemDto | null;
  tab?: ProfileTab;
}) {
  const fmt = useFormat();
  const now = useNow();
  const today = fmt.today();
  const groups = useGroupMap();
  const clients = useClients({});
  const [q, setQ] = useState("");
  const selectedRef = useRef<HTMLAnchorElement | null>(null);

  const all = clients.data;
  const list = useMemo(() => {
    const base = all ?? [];
    const withCurrent =
      current && !base.some((c) => c.id === current.id) ? [current, ...base] : base;
    return withCurrent.filter((c) => matchesQuery(c, q));
  }, [all, current, q]);
  const counts = useMemo(
    () =>
      all
        ? {
            active: all.filter((c) => c.status === "active").length,
            low: all.filter((c) => needsPackage(c, today)).length,
            owes: all.filter(owesMoney).length,
          }
        : null,
    [all, today],
  );

  // Bring the open client into view when arriving from elsewhere.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run once the list arrives.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId, Boolean(all)]);

  const dash = "–";
  const shown = list.slice(0, MAX_TILES);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 px-1">
        <Link
          to="/clients"
          aria-label="All clients"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-night-3 text-night-ink outline-none hover:bg-night-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="text-[1.75rem] leading-tight font-light tracking-[-0.01em]">Clients</h2>
          <p className="num mt-1 text-[0.875rem] text-night-ink-2">
            {all ? `${plural(all.length, "client")} · ${counts?.owes ?? 0} owe money` : "Loading…"}
          </p>
        </div>
        <SyncStatus dark />
      </div>

      <SearchField
        dark
        label="Find a client"
        placeholder="Find a client"
        value={q}
        onChange={setQ}
      />

      <div className="grid grid-cols-3 gap-2">
        <MiniKpi
          label="Active"
          value={counts?.active ?? dash}
          tint="rgb(218 238 99 / 0.22)"
          search={{ status: "active" }}
        />
        <MiniKpi
          label="Low credits"
          value={counts?.low ?? dash}
          tint="rgb(248 212 119 / 0.2)"
          search={{ filter: "low" }}
        />
        <MiniKpi
          label="Owe money"
          value={counts?.owes ?? dash}
          tint="rgb(248 113 113 / 0.22)"
          search={{ filter: "owes" }}
        />
      </div>

      <section aria-labelledby="worklist-title" className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between px-1 pt-1">
          <h3 id="worklist-title" className="text-[1.125rem] font-light">
            {q ? `${plural(list.length, "match", "matches")}` : "Worklist"}
          </h3>
          <Link
            to="/clients/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] text-night-ink-2 outline-none hover:text-night-ink focus-visible:outline-2 focus-visible:outline-lime"
          >
            <UserPlus aria-hidden className="size-4" />
            Add client
          </Link>
        </div>
        {!all ? (
          <>
            <Skeleton dark className="h-[124px] rounded-[24px]" />
            <Skeleton dark className="h-[124px] rounded-[24px]" />
            <Skeleton dark className="h-[124px] rounded-[24px]" />
          </>
        ) : shown.length ? (
          shown.map((c) => (
            <ClientTile
              key={c.id}
              client={c}
              groups={groups}
              selected={c.id === selectedId}
              now={now}
              tab={tab}
              tileRef={
                c.id === selectedId
                  ? (el) => {
                      selectedRef.current = el;
                    }
                  : undefined
              }
            />
          ))
        ) : (
          <p className="px-1 text-[0.875rem] text-night-ink-2">
            No one matches “{q}”. Try a first name, email, or phone number.
          </p>
        )}
        {list.length > shown.length ? (
          <p className="px-1 text-[0.8125rem] text-night-ink-2">
            {list.length - shown.length} more. Search to narrow the list.
          </p>
        ) : null}
      </section>
    </div>
  );
}
