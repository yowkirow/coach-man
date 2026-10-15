import type {
  ClientListItemDto,
  GroupDetailDto,
  GroupDto,
  LessonSummaryDto,
  SeriesDto,
} from "@shared/api-types";
import { addDays, compareDates } from "@shared/time";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarPlus,
  Ellipsis,
  Pencil,
  Repeat,
  UserMinus,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { LessonRow } from "../../components/domain/lesson";
import { Button, buttonClass, IconButton } from "../../components/ui/button";
import {
  Avatar,
  Bento,
  Card,
  CardHeader,
  CheckItem,
  KeyValue,
  Pill,
  PillTabs,
} from "../../components/ui/display";
import {
  EmptyState,
  ErrorState,
  InlineError,
  RowsSkeleton,
  Skeleton,
} from "../../components/ui/feedback";
import { Checkbox } from "../../components/ui/field";
import { ActionMenu, ConfirmSheet } from "../../components/ui/overlay";
import { ApiRequestError, api, errorMessage } from "../../lib/api";
import { type Format, fullName, plural, useFormat } from "../../lib/format";
import { useClients, useLessons, useNow, useRates, useVenues } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { OfflineNote } from "../schedule/choice";
import { startOfWeek } from "../schedule/dates";
import { NewSessionSheet } from "../schedule/new-session-sheet";
import { whereOf } from "../sessions/session-detail";
import { AddMembersSheet } from "./add-members-sheet";
import { GroupSheet } from "./group-sheet";
import {
  colorName,
  groupColor,
  seriesLabel,
  useGroup,
  useInvalidateGroups,
  weeklyPattern,
} from "./queries";

export type GroupTab = "members" | "schedule" | "details";
type Member = GroupDetailDto["members"][number];
type SheetName = "members" | "session" | "edit" | "archive";

/** A series has ended once it is switched off or its last date has passed. */
function seriesEnded(s: SeriesDto, today: string) {
  return !s.active || (s.endsOn !== null && compareDates(s.endsOn, today) < 0);
}

/**
 * The group workspace: header with action circles, members/schedule/details tabs, and the
 * lavender "This week" and lime "Next session" cards.
 */
export function GroupDetail({
  groupId,
  tab,
  onTab,
}: {
  groupId: string;
  tab: GroupTab;
  onTab: (tab: GroupTab) => void;
}) {
  const fmt = useFormat();
  const now = useNow();
  const today = fmt.today();
  const q = useGroup(groupId);
  const clients = useClients({});
  const weekStart = startOfWeek(today, fmt.weekStartsOn);
  const week = useLessons(weekStart, addDays(weekStart, 6));
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: close sheets when the group changes.
  useEffect(() => {
    setSheet(null);
    setRemoving(null);
  }, [groupId]);

  if (q.isPending) return <GroupSkeleton />;
  if (!q.data) {
    const missing = q.error instanceof ApiRequestError && q.error.status === 404;
    return (
      <div className="flex flex-col gap-2">
        <ErrorState
          title={missing ? "Group not found" : "Couldn't load this group"}
          message={
            missing
              ? "It may have been removed, or the link is from another workspace."
              : errorMessage(q.error)
          }
          onRetry={missing ? undefined : () => void q.refetch()}
        />
        <Link to="/groups" className={buttonClass("light", "md", "self-start")}>
          All groups
        </Link>
      </div>
    );
  }

  const detail = q.data;
  const g = detail.group;
  const archived = g.archivedAt !== null;
  const clientById = new Map((clients.data ?? []).map((c) => [c.id, c]));
  const thisWeek = (week.data ?? []).filter((l) => l.groupId === g.id);
  const next = detail.upcoming.find((l) => l.status === "scheduled" && l.endsAt > now) ?? null;
  const startTime = detail.series.find((s) => !seriesEnded(s, today))?.startTime;

  return (
    <div className="flex flex-col gap-6">
      <GroupHeader detail={detail} today={today} onSheet={setSheet} />

      <PillTabs
        label="Group sections"
        fill
        selected={tab}
        onChange={(t) => onTab(t as GroupTab)}
        tabs={[
          {
            id: "members",
            label: `Members · ${g.memberCount}`,
            content: (
              <MembersCard
                detail={detail}
                clientById={clientById}
                onAdd={() => setSheet("members")}
                onRemove={setRemoving}
              />
            ),
          },
          {
            id: "schedule",
            label: "Schedule",
            content: (
              <ScheduleCards
                detail={detail}
                now={now}
                today={today}
                onAdd={() => setSheet("session")}
              />
            ),
          },
          {
            id: "details",
            label: "Details",
            content: <DetailsCard group={g} onEdit={() => setSheet("edit")} />,
          },
        ]}
        aside={
          <>
            <ThisWeekBento lessons={thisWeek} isPending={week.isPending} fmt={fmt} />
            <NextSessionBento lesson={next} archived={archived} onAdd={() => setSheet("session")} />
          </>
        }
      />

      <AddMembersSheet
        isOpen={sheet === "members"}
        onOpenChange={(o) => setSheet(o ? "members" : null)}
        group={g}
        memberIds={detail.members.map((m) => m.clientId)}
      />
      <NewSessionSheet
        isOpen={sheet === "session"}
        onOpenChange={(o) => setSheet(o ? "session" : null)}
        initial={{ kind: "group", groupId: g.id, repeat: true, startTime }}
        onCreated={() => {
          setSheet(null);
          onTab("schedule");
        }}
      />
      <GroupSheet
        isOpen={sheet === "edit"}
        onOpenChange={(o) => setSheet(o ? "edit" : null)}
        group={g}
      />
      <ArchiveGroupSheet
        isOpen={sheet === "archive"}
        onOpenChange={(o) => setSheet(o ? "archive" : null)}
        group={g}
      />
      <RemoveMemberSheet member={removing} group={g} onClose={() => setRemoving(null)} />
    </div>
  );
}

function GroupSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Loading group…</span>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-11 w-2/3 max-w-md" />
        <Skeleton className="h-4 w-1/3 max-w-xs" />
      </div>
      <Card className="p-5">
        <RowsSkeleton rows={4} />
      </Card>
    </div>
  );
}

function GroupHeader({
  detail,
  today,
  onSheet,
}: {
  detail: GroupDetailDto;
  today: string;
  onSheet: (s: SheetName) => void;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const g = detail.group;
  const archived = g.archivedAt !== null;
  const full = g.capacity !== null && g.memberCount >= g.capacity;
  const live = detail.series.filter((s) => !seriesEnded(s, today));
  const places =
    g.capacity === null
      ? "No size limit"
      : full
        ? `Full at ${g.capacity}`
        : `${g.capacity - g.memberCount} of ${g.capacity} places left`;
  const meta = [g.level, plural(g.memberCount, "member"), places].filter(Boolean).join(" · ");

  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="flex min-w-0 flex-1 basis-[26rem] items-start gap-3">
        <Link
          to="/groups"
          aria-label="All groups"
          className="mt-1 flex size-11 shrink-0 items-center justify-center rounded-full bg-card text-ink outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink lg:hidden"
        >
          <ArrowLeft aria-hidden className="size-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-[2rem] leading-[1.08] font-light tracking-[-0.02em] break-words lg:text-[2.75rem]">
            {g.name}
          </h1>
          <p className="num mt-2 flex items-center gap-2 text-[0.9375rem] text-ink-2">
            <span
              aria-hidden
              className="size-3 shrink-0 rounded-full ring-1 ring-black/10"
              style={{ backgroundColor: groupColor(g) }}
            />
            <span>{meta}</span>
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {archived ? (
              <Pill tone="panel">Archived {fmt.date(fmt.dayOf(g.archivedAt ?? Date.now()))}</Pill>
            ) : null}
            {full && !archived ? <Pill tone="amber">Full</Pill> : null}
            {live.map((s) => (
              <Pill key={s.id} tone="outline">
                <span className="num">{seriesLabel(s, fmt)}</span>
              </Pill>
            ))}
            {!live.length && !archived ? <Pill tone="outline">No weekly session yet</Pill> : null}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-2">
          <IconButton
            label="Add members"
            variant="lime"
            size="lg"
            isDisabled={archived || !online}
            onPress={() => onSheet("members")}
          >
            <UserPlus aria-hidden className="size-5" />
          </IconButton>
          <IconButton
            label="Add weekly session"
            variant="lime"
            size="lg"
            isDisabled={archived || !online}
            onPress={() => onSheet("session")}
          >
            <CalendarPlus aria-hidden className="size-5" />
          </IconButton>
          <IconButton
            label="Edit group"
            variant="lime"
            size="lg"
            isDisabled={!online}
            onPress={() => onSheet("edit")}
          >
            <Pencil aria-hidden className="size-5" />
          </IconButton>
          <ActionMenu
            label="More group actions"
            trigger={
              <IconButton label="More group actions" variant="white" size="lg">
                <Ellipsis aria-hidden className="size-5" />
              </IconButton>
            }
            actions={[
              {
                id: "edit",
                label: "Edit details",
                onAction: () => onSheet("edit"),
                isDisabled: !online,
              },
              {
                id: "archive",
                label: archived ? "Archived" : "Archive group",
                tone: "danger",
                onAction: () => onSheet("archive"),
                isDisabled: archived || !online,
              },
            ]}
          />
        </div>
        {!online ? <OfflineNote /> : null}
      </div>
    </header>
  );
}

function creditPill(credits: number) {
  if (credits === 0) return <Pill tone="coral">No credits</Pill>;
  if (credits === 1) return <Pill tone="amber">1 credit left</Pill>;
  return null;
}

function MembersCard({
  detail,
  clientById,
  onAdd,
  onRemove,
}: {
  detail: GroupDetailDto;
  clientById: Map<string, ClientListItemDto>;
  onAdd: () => void;
  onRemove: (m: Member) => void;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const g = detail.group;
  const archived = g.archivedAt !== null;
  return (
    <Card label="Members">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-1">
        <h2 className="text-[1.125rem] font-medium">
          Members{" "}
          <span className="num font-normal text-ink-2">
            {g.memberCount}
            {g.capacity ? `/${g.capacity}` : ""}
          </span>
        </h2>
        <Button
          variant="light"
          size="sm"
          icon={<UserPlus aria-hidden className="size-4" />}
          isDisabled={archived || !online}
          onPress={onAdd}
        >
          Add members
        </Button>
      </div>
      {detail.members.length ? (
        <ul className="flex flex-col divide-y divide-line px-5 pb-2">
          {detail.members.map((m) => {
            const c = clientById.get(m.clientId);
            const name = fullName(m);
            return (
              <li key={m.clientId} className="flex items-center gap-3 py-3">
                <Avatar person={{ ...m, photoKey: c?.photoKey }} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      to="/clients/$clientId"
                      params={{ clientId: m.clientId }}
                      className="rounded-md font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
                    >
                      {name}
                    </Link>
                    {c?.isJunior ? <Pill tone="sky">Junior</Pill> : null}
                    {creditPill(m.creditsRemaining)}
                  </div>
                  <p className="num truncate text-[0.8125rem] text-ink-2">
                    {m.creditsRemaining > 1
                      ? `${m.creditsRemaining} credits left`
                      : m.creditsRemaining === 1
                        ? "Last credit"
                        : "Pays per session"}
                    {m.joinedOn ? ` · Joined ${fmt.date(m.joinedOn)}` : ""}
                  </p>
                </div>
                <IconButton
                  label={`Remove ${name} from ${g.name}`}
                  isDisabled={archived || !online}
                  onPress={() => onRemove(m)}
                >
                  <UserMinus aria-hidden className="size-5" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-5 pb-5">
          <EmptyState
            icon={<UsersRound aria-hidden className="size-5" />}
            title="No members yet"
            body="Add the players who come to this class. They're booked into every upcoming session, and into new ones as you add them."
            action={
              <Button variant="dark" isDisabled={archived || !online} onPress={onAdd}>
                Add members
              </Button>
            }
          />
        </div>
      )}
    </Card>
  );
}

function ScheduleCards({
  detail,
  now,
  today,
  onAdd,
}: {
  detail: GroupDetailDto;
  now: number;
  today: string;
  onAdd: () => void;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const venues = useVenues();
  const archived = detail.group.archivedAt !== null;
  const venueName = (id: string | null) => venues.data?.find((v) => v.id === id)?.name ?? null;
  const series = [...detail.series].sort(
    (a, b) => Number(seriesEnded(a, today)) - Number(seriesEnded(b, today)),
  );
  const upcoming = detail.upcoming.filter((l) => l.endsAt > now - 60 * 60_000);

  return (
    <div className="flex flex-col gap-4">
      <Card label="Weekly sessions">
        <CardHeader
          title="Weekly sessions"
          action={
            <Button
              variant="light"
              size="sm"
              aria-label="Add weekly session"
              icon={<CalendarPlus aria-hidden className="size-4" />}
              isDisabled={archived || !online}
              onPress={onAdd}
            >
              <span className="sm:hidden">Add</span>
              <span className="hidden sm:inline">Add weekly session</span>
            </Button>
          }
        />
        {series.length ? (
          <ul className="flex flex-col px-3 pb-3">
            {series.map((s) => {
              const ended = seriesEnded(s, today);
              const next = detail.upcoming.find(
                (l) => l.seriesId === s.id && l.status === "scheduled" && l.endsAt > now,
              );
              const where = whereOf({ court: s.court, venueName: venueName(s.venueId) });
              const span = ended
                ? s.endsOn
                  ? `Ended ${fmt.date(s.endsOn)}`
                  : "Ended"
                : s.endsOn
                  ? `Until ${fmt.date(s.endsOn)}`
                  : `Since ${fmt.date(s.startsOn)}`;
              return (
                <li key={s.id} className="flex items-center gap-4 rounded-2xl px-2 py-3">
                  <span
                    aria-hidden
                    className={`flex size-11 shrink-0 items-center justify-center rounded-full ${ended ? "bg-panel text-ink-2" : "bg-violet text-ink"}`}
                  >
                    <Repeat className="size-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`num font-medium ${ended ? "text-ink-2" : ""}`}>
                      {seriesLabel(s, fmt)}
                    </p>
                    <p className="truncate text-[0.8125rem] text-ink-2">
                      {[where || "No venue set", span].join(" · ")}
                    </p>
                  </div>
                  {ended ? (
                    <Pill tone="panel">Ended</Pill>
                  ) : next ? (
                    <Link
                      to="/sessions/$lessonId"
                      params={{ lessonId: next.id }}
                      className={buttonClass("light", "sm", "num shrink-0 max-sm:hidden")}
                    >
                      Next {fmt.day(fmt.dayOf(next.startsAt))}
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-5 pb-5">
            <EmptyState
              icon={<Repeat aria-hidden className="size-5" />}
              title="No weekly session yet"
              body="Pick the days and time the group meets. Members are booked in every week, and the next eight weeks are filled in now."
              action={
                <Button variant="dark" isDisabled={archived || !online} onPress={onAdd}>
                  Add weekly session
                </Button>
              }
            />
          </div>
        )}
      </Card>

      <Card label="Upcoming sessions">
        <CardHeader
          title="Upcoming sessions"
          action={
            upcoming.length ? (
              <span className="num text-[0.875rem] text-ink-2">
                Next {plural(upcoming.length, "session")}
              </span>
            ) : null
          }
        />
        {upcoming.length ? (
          <div className="flex flex-col px-3 pb-3">
            {upcoming.map((l) => (
              <LessonRow key={l.id} lesson={l} now={now} showDate />
            ))}
          </div>
        ) : (
          <p className="px-5 pb-5 text-ink-2">
            Nothing scheduled.{" "}
            {archived
              ? "Archived groups don't get new sessions."
              : "Add a weekly session to start."}
          </p>
        )}
      </Card>
    </div>
  );
}

function DetailsCard({ group, onEdit }: { group: GroupDto; onEdit: () => void }) {
  const fmt = useFormat();
  const online = useOnline();
  const rates = useRates();
  const venues = useVenues();
  const rate = rates.data?.find((r) => r.id === group.defaultRateId);
  const venue = venues.data?.find((v) => v.id === group.defaultVenueId);
  return (
    <Card className="p-5" label="Group details">
      <dl className="grid gap-5 sm:grid-cols-2">
        <KeyValue label="Level">{group.level ?? "Any level"}</KeyValue>
        <KeyValue label="Size limit">
          {group.capacity ? (
            <span className="num">{plural(group.capacity, "player")}</span>
          ) : (
            "No limit"
          )}
        </KeyValue>
        <KeyValue label="Default rate">
          {rate ? (
            <>
              {rate.name}{" "}
              <span className="num text-ink-2">
                · {fmt.money(rate.priceMinor)} per {rate.unit === "hour" ? "hour" : "session"}
              </span>
            </>
          ) : group.defaultRateId ? (
            "A rate that's no longer on your rate card"
          ) : (
            "None"
          )}
        </KeyValue>
        <KeyValue label="Default venue">{venue?.name ?? "None"}</KeyValue>
        <KeyValue label="Colour">
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden
              className="size-3.5 rounded-full ring-1 ring-black/10"
              style={{ backgroundColor: groupColor(group) }}
            />
            {colorName(group.color)}
          </span>
        </KeyValue>
        <KeyValue label="Members">
          <span className="num">{group.memberCount}</span>
        </KeyValue>
        <div className="sm:col-span-2">
          <KeyValue label="Description">
            {group.description ? (
              <span className="whitespace-pre-line">{group.description}</span>
            ) : (
              <span className="text-ink-2">No description yet.</span>
            )}
          </KeyValue>
        </div>
      </dl>
      <Button
        variant="light"
        size="sm"
        className="mt-5"
        icon={<Pencil aria-hidden className="size-4" />}
        isDisabled={!online}
        onPress={onEdit}
      >
        Edit details
      </Button>
    </Card>
  );
}

function ThisWeekBento({
  lessons,
  isPending,
  fmt,
}: {
  lessons: LessonSummaryDto[];
  isPending: boolean;
  fmt: Format;
}) {
  const done = lessons.filter((l) => l.status === "completed").length;
  const pattern = weeklyPattern(lessons, fmt);
  return (
    <Bento
      tone="lavender"
      title="This week"
      subtitle={
        isPending
          ? "Checking the schedule…"
          : lessons.length
            ? `${done} of ${plural(lessons.length, "session")} completed`
            : "No sessions this week"
      }
    >
      {lessons.length ? (
        <ul className="flex flex-col">
          {lessons.map((l) => (
            <CheckItem key={l.id} ok={l.status === "completed"}>
              <Link
                to="/sessions/$lessonId"
                params={{ lessonId: l.id }}
                className={`num rounded-md outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink ${l.status === "cancelled" ? "line-through" : ""}`}
              >
                {fmt.day(fmt.dayOf(l.startsAt))} · {fmt.time(l.startsAt)}
              </Link>{" "}
              <span className="num text-ink/70">
                ·{" "}
                {l.status === "cancelled" ? "cancelled" : `${l.checkedInCount}/${l.bookedCount} in`}
              </span>
            </CheckItem>
          ))}
        </ul>
      ) : !isPending ? (
        <p className="text-[0.9375rem] text-ink/75">
          {pattern ? `Usually ${pattern}.` : "Weekly sessions show up here with their check-ins."}
        </p>
      ) : null}
    </Bento>
  );
}

function NextSessionBento({
  lesson,
  archived,
  onAdd,
}: {
  lesson: LessonSummaryDto | null;
  archived: boolean;
  onAdd: () => void;
}) {
  const fmt = useFormat();
  const online = useOnline();
  if (!lesson) {
    return (
      <Bento tone="lime" title="Next session" subtitle="Nothing scheduled">
        <p className="text-[0.9375rem] text-ink/75">
          {archived
            ? "This group is archived, so no new sessions are added."
            : "Add a weekly session and members are booked in automatically."}
        </p>
        {!archived ? (
          <Button variant="dark" size="sm" className="mt-4" isDisabled={!online} onPress={onAdd}>
            Add weekly session
          </Button>
        ) : null}
      </Bento>
    );
  }
  const where = whereOf(lesson);
  return (
    <Bento tone="lime" title="Next session" subtitle={lesson.title}>
      <p className="num text-[1.125rem] font-medium">
        {fmt.day(fmt.dayOf(lesson.startsAt))} · {fmt.timeRange(lesson.startsAt, lesson.endsAt)}
      </p>
      <p className="num mt-1 text-[0.875rem] text-ink/75">
        {[where, `${plural(lesson.bookedCount, "player")} booked`].filter(Boolean).join(" · ")}
      </p>
      <Link
        to="/sessions/$lessonId"
        params={{ lessonId: lesson.id }}
        className={buttonClass("dark", "sm", "mt-4")}
      >
        Open
        <ArrowUpRight aria-hidden className="size-4" />
      </Link>
    </Bento>
  );
}

/**
 * Archives the group. Archiving stops its weekly series; optionally the sessions already on the
 * schedule are taken off too (each series ends at its next session, one-offs are cancelled).
 */
function ArchiveGroupSheet({
  isOpen,
  onOpenChange,
  group,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  group: GroupDto;
}) {
  const fmt = useFormat();
  const invalidate = useInvalidateGroups();
  const today = fmt.today();
  const until = addDays(today, 56);
  // Same cache entry as useLessons, but only fetched while the sheet is open.
  const ahead = useQuery({
    queryKey: keys.lessons(today, until),
    queryFn: () => api.get<LessonSummaryDto[]>(`/lessons?from=${today}&to=${until}`),
    enabled: isOpen,
  });
  const [clear, setClear] = useState(true);
  const pending = (list: LessonSummaryDto[] | undefined) =>
    (list ?? []).filter(
      (l) => l.groupId === group.id && l.status === "scheduled" && l.startsAt > Date.now(),
    );
  const upcoming = pending(ahead.data);

  const archive = useMutation({
    meta: { silent: true },
    mutationFn: async () => {
      let cancelled = 0;
      if (clear) {
        const load = async () =>
          pending(await api.get<LessonSummaryDto[]>(`/lessons?from=${today}&to=${until}`));
        const first = await load();
        const ended = new Set<string>();
        for (const l of first) {
          if (!l.seriesId || ended.has(l.seriesId)) continue;
          ended.add(l.seriesId);
          await api.post(`/lessons/${l.id}/cancel`, {
            reason: "Group archived",
            scope: "following",
          });
        }
        // Whatever is left (one-offs and sessions moved out of their series) is cancelled singly.
        for (const l of await load()) {
          await api.post(`/lessons/${l.id}/cancel`, { reason: "Group archived", scope: "this" });
        }
        cancelled = first.length;
      }
      await api.post<GroupDto>(`/groups/${group.id}/archive`);
      return cancelled;
    },
    onSuccess: (cancelled) => {
      invalidate(group.id, { members: true });
      notify({
        tone: "success",
        title: `${group.name} archived`,
        body: cancelled
          ? `${plural(cancelled, "upcoming session")} taken off the schedule.`
          : "Its weekly sessions stop here.",
      });
      onOpenChange(false);
    },
    onError: () => invalidate(group.id),
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the sheet opens.
  useEffect(() => {
    if (!isOpen) return;
    setClear(true);
    archive.reset();
  }, [isOpen]);

  return (
    <ConfirmSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={`Archive ${group.name}?`}
      confirmLabel="Archive group"
      isPending={archive.isPending}
      onConfirm={() => archive.mutate()}
      body={
        <div className="flex flex-col gap-4">
          <p>
            Its weekly sessions stop and it leaves the group pickers. Members, past sessions,
            check-ins, and credits stay as they are.
          </p>
          {upcoming.length ? (
            <Checkbox isSelected={clear} onChange={setClear}>
              <span className="text-ink">
                Also take its{" "}
                <span className="num font-medium">
                  {plural(upcoming.length, "upcoming session")}
                </span>{" "}
                off the schedule
              </span>
            </Checkbox>
          ) : null}
          {archive.error ? <InlineError>{errorMessage(archive.error)}</InlineError> : null}
        </div>
      }
    />
  );
}

function RemoveMemberSheet({
  member,
  group,
  onClose,
}: {
  member: Member | null;
  group: GroupDto;
  onClose: () => void;
}) {
  const invalidate = useInvalidateGroups();
  const [shown, setShown] = useState<Member | null>(member);
  useEffect(() => {
    if (member) setShown(member);
  }, [member]);
  const remove = useMutation({
    meta: { silent: true },
    mutationFn: (m: Member) => api.del<GroupDto>(`/groups/${group.id}/members/${m.clientId}`),
    onSuccess: (_g, m) => {
      invalidate(group.id, { members: true });
      notify({
        tone: "neutral",
        title: `${m.firstName} left ${group.name}`,
        body: "Taken off the group's upcoming sessions.",
      });
      onClose();
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset for each member.
  useEffect(() => {
    if (member) remove.reset();
  }, [member]);
  const name = shown ? fullName(shown) : "";
  return (
    <ConfirmSheet
      isOpen={member !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Remove ${shown?.firstName ?? "member"}?`}
      confirmLabel="Remove"
      isPending={remove.isPending}
      onConfirm={() => member && remove.mutate(member)}
      body={
        <div className="flex flex-col gap-4">
          <p>
            {name} leaves {group.name} today and comes off its upcoming sessions. Their credits,
            payments, and history stay.
          </p>
          {remove.error ? <InlineError>{errorMessage(remove.error)}</InlineError> : null}
        </div>
      }
    />
  );
}
