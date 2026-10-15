import type { ClientListItemDto, GroupDto } from "@shared/api-types";
import { addDays } from "@shared/time";
import { Link, useNavigate } from "@tanstack/react-router";
import { Archive, ArrowUpRight, CalendarClock, UsersRound } from "lucide-react";
import { useMemo } from "react";
import { SyncStatus } from "../../components/layout/app-shell";
import { buttonClass } from "../../components/ui/button";
import { AvatarStack, KpiTile, Meter, Pill } from "../../components/ui/display";
import { Skeleton } from "../../components/ui/feedback";
import { plural, useFormat } from "../../lib/format";
import { useClients, useLessons, useNow } from "../../lib/hooks";
import { startOfWeek } from "../schedule/dates";
import {
  type GroupScheduleInfo,
  groupColor,
  membersByGroup,
  scheduleByGroup,
  useGroupList,
} from "./queries";

export interface GroupStats {
  groups: number;
  members: number;
  thisWeek: number | null;
  /** Places left across groups that have a size limit; null when none has one. */
  openSpots: number | null;
}

/**
 * Everything the group list needs: groups, their members (from the client list), the weekly
 * pattern and next session (from the next two weeks), and this week's group sessions.
 */
export function useGroupsOverview(includeArchived = false) {
  const fmt = useFormat();
  const now = useNow();
  const today = fmt.today();
  const groups = useGroupList(includeArchived);
  const clients = useClients({});
  const ahead = useLessons(today, addDays(today, 13));
  const weekStart = startOfWeek(today, fmt.weekStartsOn);
  const week = useLessons(weekStart, addDays(weekStart, 6));

  const members = useMemo(() => membersByGroup(clients.data), [clients.data]);
  const schedule = useMemo(() => scheduleByGroup(ahead.data, fmt, now), [ahead.data, fmt, now]);

  const stats = useMemo<GroupStats | null>(() => {
    if (!groups.data) return null;
    const active = groups.data.filter((g) => !g.archivedAt);
    const ids = new Set(active.map((g) => g.id));
    const capped = active.filter((g) => g.capacity !== null);
    return {
      groups: active.length,
      members: clients.data
        ? clients.data.filter((c) => c.groupIds.some((id) => ids.has(id))).length
        : active.reduce((n, g) => n + g.memberCount, 0),
      thisWeek: week.data
        ? week.data.filter((l) => l.groupId && ids.has(l.groupId) && l.status !== "cancelled")
            .length
        : null,
      openSpots: capped.length
        ? capped.reduce((n, g) => n + Math.max(0, (g.capacity ?? 0) - g.memberCount), 0)
        : null,
    };
  }, [groups.data, clients.data, week.data]);

  return { groups, members, schedule, stats };
}

export function GroupKpis({ stats }: { stats: GroupStats | null }) {
  const navigate = useNavigate();
  const dash = "–";
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <KpiTile label="Groups" value={stats?.groups ?? dash} tint="lime" />
      <KpiTile label="Members" value={stats?.members ?? dash} tint="sky" />
      <KpiTile
        label="This week"
        value={stats?.thisWeek ?? dash}
        tint="violet"
        hint="Group sessions this week. Opens the schedule."
        onPress={() => void navigate({ to: "/schedule" })}
      />
      <KpiTile
        label="Open spots"
        value={stats?.openSpots ?? dash}
        tint="amber"
        hint="Places left in groups with a size limit"
      />
    </div>
  );
}

function capacityText(g: GroupDto) {
  if (g.capacity === null) return plural(g.memberCount, "member");
  if (g.memberCount >= g.capacity) return `Full · ${g.memberCount} of ${g.capacity}`;
  return `${g.memberCount} of ${g.capacity} members`;
}

/** Dark list card for the command panel; the open group turns lime. */
export function GroupTile({
  group,
  members,
  info,
  selected,
}: {
  group: GroupDto;
  members: ClientListItemDto[];
  info?: GroupScheduleInfo;
  selected: boolean;
}) {
  const archived = group.archivedAt !== null;
  const sub = selected ? "text-ink/70" : "text-night-ink-2";
  return (
    <Link
      to="/groups/$groupId"
      params={{ groupId: group.id }}
      aria-current={selected ? "page" : undefined}
      className={`block rounded-[24px] p-4 outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime ${
        selected
          ? "bg-lime text-ink [--avatar-ring:var(--color-lime)]"
          : "bg-night-2 text-night-ink [--avatar-ring:var(--color-night-2)] hover:bg-night-3 hover:[--avatar-ring:var(--color-night-3)]"
      }`}
    >
      <div className="flex items-start gap-3">
        {members.length ? (
          <AvatarStack people={members} max={2} dark={!selected} />
        ) : (
          <span
            className={`flex size-9 shrink-0 items-center justify-center rounded-full ${selected ? "bg-ink/10" : "bg-night-3"}`}
          >
            <UsersRound aria-hidden className="size-4" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className={`size-2.5 shrink-0 rounded-full ring-1 ${selected ? "ring-ink/60" : "ring-black/10"}`}
              style={{ backgroundColor: groupColor(group) }}
            />
            <span className="line-clamp-2 text-[1rem] leading-snug">{group.name}</span>
          </span>
          <span className={`num block truncate text-[0.75rem] ${sub}`}>
            {archived ? "Archived" : (info?.pattern ?? "Nothing in the next two weeks")}
          </span>
        </span>
        <ArrowUpRight aria-hidden className={`size-4 shrink-0 ${sub}`} />
      </div>
      <div
        className={`mt-3 flex h-11 items-center gap-2 rounded-full border px-3 ${selected ? "border-ink/15" : "border-night-4"}`}
      >
        <UsersRound aria-hidden className="size-4 shrink-0" />
        <span className="num flex-1 truncate text-[0.8125rem]">{capacityText(group)}</span>
        {group.level ? (
          <Pill tone={selected ? "white" : "violet"} className="max-w-[45%] truncate">
            {group.level}
          </Pill>
        ) : null}
      </div>
    </Link>
  );
}

/** The command panel on Groups pages: KPIs and every active group. */
export function GroupsPanel({
  selectedId,
  current,
}: {
  selectedId?: string;
  /** The open group, shown even when it is archived. */
  current?: GroupDto;
}) {
  const { groups, members, schedule, stats } = useGroupsOverview(false);
  const list = groups.data ?? [];
  const shown =
    current?.archivedAt && !list.some((g) => g.id === current.id) ? [...list, current] : list;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-2 px-1">
        <div>
          <h2 className="text-[1.75rem] leading-tight font-light tracking-[-0.01em]">Groups</h2>
          <p className="num mt-1 text-[0.875rem] text-night-ink-2">
            {stats
              ? `${plural(stats.groups, "group")} · ${plural(stats.members, "member")}`
              : "Loading…"}
          </p>
        </div>
        <SyncStatus dark />
      </div>
      <GroupKpis stats={stats} />
      <section aria-labelledby="panel-groups" className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between px-1 pt-1">
          <h3 id="panel-groups" className="text-[1.125rem] font-light">
            Your groups
          </h3>
          <Link
            to="/groups"
            search={{ new: "1" }}
            className="rounded-full px-2 py-1 text-[0.8125rem] text-night-ink-2 outline-none hover:text-night-ink focus-visible:outline-2 focus-visible:outline-lime"
          >
            New group
          </Link>
        </div>
        {groups.isPending ? (
          <>
            <Skeleton dark className="h-[124px] rounded-[24px]" />
            <Skeleton dark className="h-[124px] rounded-[24px]" />
          </>
        ) : !groups.data ? (
          <div className="rounded-[24px] bg-night-2 p-5">
            <p className="text-night-ink">Couldn't load your groups.</p>
            <button
              type="button"
              onClick={() => void groups.refetch()}
              className={buttonClass("night", "sm", "mt-4")}
            >
              Try again
            </button>
          </div>
        ) : shown.length ? (
          shown.map((g) => (
            <GroupTile
              key={g.id}
              group={g}
              members={members.get(g.id) ?? []}
              info={schedule.get(g.id)}
              selected={g.id === selectedId}
            />
          ))
        ) : (
          <div className="rounded-[24px] bg-night-2 p-5">
            <p className="text-night-ink">No groups yet.</p>
            <p className="mt-1 text-[0.8125rem] text-night-ink-2">
              Group classes keep their members together and book them every week.
            </p>
            <Link to="/groups" search={{ new: "1" }} className={buttonClass("lime", "sm", "mt-4")}>
              New group
            </Link>
          </div>
        )}
      </section>
      <Link
        to="/groups"
        search={{ archived: "1" }}
        className="flex h-11 items-center gap-2 self-start rounded-full px-3 text-[0.875rem] text-night-ink-2 outline-none hover:text-night-ink focus-visible:outline-2 focus-visible:outline-lime"
      >
        <Archive aria-hidden className="size-4" />
        Archived groups
      </Link>
    </div>
  );
}

/** White card for the main grid: who's in, when it meets, how full it is, and what's next. */
export function GroupCard({
  group,
  members,
  info,
}: {
  group: GroupDto;
  members: ClientListItemDto[];
  info?: GroupScheduleInfo;
}) {
  const fmt = useFormat();
  const archived = group.archivedAt !== null;
  const full = group.capacity !== null && group.memberCount >= group.capacity;
  const next = info?.next;
  return (
    <article
      className={`group/card relative flex flex-col gap-4 rounded-[28px] bg-card p-5 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ink ${archived ? "opacity-80" : ""}`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-2.5 size-3 shrink-0 rounded-full ring-1 ring-black/10"
          style={{ backgroundColor: groupColor(group) }}
        />
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 text-[1.5rem] leading-tight font-light tracking-[-0.01em] break-words">
            <Link
              to="/groups/$groupId"
              params={{ groupId: group.id }}
              className="outline-none after:absolute after:inset-0 after:rounded-[28px]"
            >
              {group.name}
            </Link>
          </h2>
          <p className="num mt-1 truncate text-[0.875rem] text-ink-2">
            {archived
              ? "Archived: no new sessions"
              : (info?.pattern ?? "No sessions in the next two weeks")}
          </p>
        </div>
        <ArrowUpRight
          aria-hidden
          className="size-5 shrink-0 text-ink-2 transition-transform duration-150 group-hover/card:translate-x-0.5 group-hover/card:-translate-y-0.5"
        />
      </div>

      {group.level || full || archived ? (
        <div className="flex flex-wrap gap-1.5">
          {group.level ? <Pill tone="violet">{group.level}</Pill> : null}
          {full && !archived ? <Pill tone="amber">Full</Pill> : null}
          {archived ? <Pill tone="panel">Archived</Pill> : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2.5">
        <div className="flex min-h-9 items-center justify-between gap-3">
          {members.length ? (
            <AvatarStack people={members} max={5} />
          ) : (
            <span className="text-[0.875rem] text-ink-2">No members yet</span>
          )}
          <span className="num shrink-0 text-[0.875rem] text-ink-2">{capacityText(group)}</span>
        </div>
        {group.capacity ? <Meter value={group.memberCount} max={group.capacity} /> : null}
      </div>

      <p className="mt-auto flex h-11 items-center gap-2 rounded-full bg-panel px-4 text-[0.875rem]">
        <CalendarClock aria-hidden className="size-4 shrink-0 text-ink-2" />
        {next ? (
          <span className="num truncate">
            Next {fmt.day(fmt.dayOf(next.startsAt))} · {fmt.time(next.startsAt)}
          </span>
        ) : (
          <span className="truncate text-ink-2">Nothing scheduled</span>
        )}
      </p>
    </article>
  );
}
