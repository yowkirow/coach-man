import type { LessonSummaryDto } from "@shared/api-types";
import { addDays, DATE_RE } from "@shared/time";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CalendarPlus, ChevronLeft, ChevronRight, CloudRain, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { ScopeToggle } from "../../components/domain/coaches";
import { LessonRow, SessionTile } from "../../components/domain/lesson";
import { Page, ShellAside, SyncStatus, useIsDesktop } from "../../components/layout/app-shell";
import { Button, IconButton } from "../../components/ui/button";
import { Card, CardHeader, PageHeader, Pill } from "../../components/ui/display";
import { EmptyState, ErrorState, RowsSkeleton, Skeleton } from "../../components/ui/feedback";
import { Segmented } from "../../components/ui/field";
import { AgendaDays, DayStrip } from "../../features/schedule/agenda";
import { OfflineNote } from "../../features/schedule/choice";
import {
  dateRangeLabel,
  daysFrom,
  monthGrid,
  monthOf,
  startOfWeek,
} from "../../features/schedule/dates";
import { KIND_SHORT, KIND_SWATCH, LESSON_KIND_ORDER } from "../../features/schedule/kinds";
import { MiniCalendar } from "../../features/schedule/mini-calendar";
import { NewSessionSheet } from "../../features/schedule/new-session-sheet";
import { RainOutSheet } from "../../features/schedule/rain-out-sheet";
import { groupByDay, WeekGrid } from "../../features/schedule/week-grid";
import { errorMessage } from "../../lib/api";
import { inScope, useSessionScope } from "../../lib/coaches";
import { type Format, plural, useFormat } from "../../lib/format";
import { useLessons, useNow } from "../../lib/hooks";
import { useOnline } from "../../lib/offline";

type View = "week" | "agenda";

export const Route = createFileRoute("/_app/schedule")({
  validateSearch: (s: Record<string, unknown>): { new?: "1"; date?: string; view?: View } => ({
    new: s.new === "1" || s.new === 1 ? "1" : undefined,
    date: typeof s.date === "string" && DATE_RE.test(s.date) ? s.date : undefined,
    view: s.view === "agenda" || s.view === "week" ? s.view : undefined,
  }),
  component: SchedulePage,
});

function countByDay(lessons: LessonSummaryDto[], fmt: Format) {
  const counts = new Map<string, number>();
  for (const l of lessons) {
    if (l.status === "cancelled") continue;
    const d = fmt.dayOf(l.startsAt);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return counts;
}

interface NavProps {
  date: string;
  today: string;
  days: string[];
  now: number;
  online: boolean;
  onSelect: (d: string) => void;
  onShiftWeek: (delta: number) => void;
  onNew: () => void;
  onRainOut: () => void;
  /** "Mine / Everyone": whose sessions the calendar shows. */
  scope: ReturnType<typeof useSessionScope>;
  /** The sessions the scope shows. */
  pick: <T extends LessonSummaryDto>(lessons: readonly T[]) => T[];
}

function SchedulePage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const fmt = useFormat();
  const desktop = useIsDesktop();
  const now = useNow();
  const online = useOnline();
  const today = fmt.today();
  const date = search.date ?? today;
  const view: View = search.view ?? "week";
  const days = daysFrom(startOfWeek(date, fmt.weekStartsOn), 7);
  const [rainOpen, setRainOpen] = useState(false);
  const scope = useSessionScope();

  const selectDate = (d: string) =>
    void navigate({
      search: (prev) => ({ ...prev, date: d === today ? undefined : d }),
      replace: true,
    });
  const openNew = () => void navigate({ search: (prev) => ({ ...prev, new: "1" }) });
  const closeNew = () =>
    void navigate({ search: (prev) => ({ ...prev, new: undefined }), replace: true });

  const nav: NavProps = {
    date,
    today,
    days,
    now,
    online,
    onSelect: selectDate,
    onShiftWeek: (delta) => selectDate(addDays(date, delta * 7)),
    onNew: openNew,
    onRainOut: () => setRainOpen(true),
    scope,
    pick: (lessons) => inScope(lessons, scope.scope, scope.userId),
  };

  return (
    <>
      <ShellAside>
        <SchedulePanel {...nav} />
      </ShellAside>
      {desktop ? (
        <DesktopSchedule
          {...nav}
          view={view}
          onView={(v) =>
            void navigate({
              search: (prev) => ({ ...prev, view: v === "week" ? undefined : v }),
              replace: true,
            })
          }
        />
      ) : (
        <PhoneSchedule {...nav} />
      )}
      <NewSessionSheet
        isOpen={search.new === "1"}
        onOpenChange={(open) => (open ? openNew() : closeNew())}
        initial={{ date }}
        onCreated={(res) => {
          const id = res.lesson?.lesson.id;
          if (id) {
            void navigate({ to: "/sessions/$lessonId", params: { lessonId: id }, replace: true });
          } else {
            closeNew();
          }
        }}
      />
      <RainOutSheet isOpen={rainOpen} onOpenChange={setRainOpen} date={date} />
    </>
  );
}

/** Black command panel: month calendar, the selected day's sessions, and rain-out. */
function SchedulePanel({
  date,
  today,
  days,
  now,
  online,
  onSelect,
  onNew,
  onRainOut,
  scope,
  pick,
}: NavProps) {
  const fmt = useFormat();
  const [month, setMonth] = useState(monthOf(date));
  useEffect(() => setMonth(monthOf(date)), [date]);
  const grid = monthGrid(month, fmt.weekStartsOn);
  const monthQ = useLessons(grid[0] ?? date, grid[41] ?? date);
  const weekQ = useLessons(days[0] ?? date, days[6] ?? date);
  const counts = countByDay(pick(monthQ.data ?? []), fmt);
  const allDay = (weekQ.data ?? []).filter((l) => fmt.dayOf(l.startsAt) === date);
  const dayLessons = pick(allDay);
  const hidden = allDay.length - dayLessons.length;
  const open = dayLessons.filter((l) => l.status !== "cancelled").length;

  return (
    <div className="flex min-h-full flex-col gap-5">
      {scope.enabled ? <ScopeToggle dark value={scope.scope} onChange={scope.setScope} /> : null}
      <MiniCalendar
        month={month}
        onMonthChange={setMonth}
        selected={date}
        today={today}
        counts={counts}
        onSelect={onSelect}
      />
      <section aria-labelledby="schedule-day" className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2 px-1">
          <h3 id="schedule-day" className="text-[1.125rem] font-light">
            {date === today ? "Sessions today" : `Sessions on ${fmt.day(date)}`}
          </h3>
          {weekQ.data ? (
            <span className="num text-[0.8125rem] text-night-ink-2">{plural(open, "session")}</span>
          ) : null}
        </div>
        {weekQ.isPending ? (
          <>
            <Skeleton dark className="h-[124px] rounded-[24px]" />
            <Skeleton dark className="h-[124px] rounded-[24px]" />
          </>
        ) : !weekQ.data ? (
          <div className="rounded-[24px] bg-night-2 p-5">
            <p className="text-night-ink">Couldn't load this day.</p>
            <p className="mt-1 text-[0.8125rem] text-night-ink-2">{errorMessage(weekQ.error)}</p>
            <Button variant="night" size="sm" className="mt-4" onPress={() => void weekQ.refetch()}>
              Try again
            </Button>
          </div>
        ) : dayLessons.length ? (
          dayLessons.map((l) => (
            <SessionTile
              key={l.id}
              lesson={l}
              people={[]}
              now={now}
              selected={false}
              linkTo="session"
            />
          ))
        ) : hidden ? (
          <div className="rounded-[24px] bg-night-2 p-5">
            <p className="text-night-ink">None of your sessions.</p>
            <p className="mt-1 text-[0.8125rem] text-night-ink-2">
              {plural(hidden, "session")} on the academy schedule that day.
            </p>
            <Button
              variant="lime"
              size="sm"
              className="mt-4"
              onPress={() => scope.setScope("everyone")}
            >
              Show everyone's
            </Button>
          </div>
        ) : (
          <div className="rounded-[24px] bg-night-2 p-5">
            <p className="text-night-ink">Nothing scheduled.</p>
            <p className="mt-1 text-[0.8125rem] text-night-ink-2">
              {date < today ? "No sessions were held that day." : "A free day on court."}
            </p>
            <Button
              variant="lime"
              size="sm"
              className="mt-4"
              icon={<CalendarPlus aria-hidden className="size-4" />}
              isDisabled={!online}
              onPress={onNew}
            >
              New session
            </Button>
          </div>
        )}
      </section>
      <div className="mt-auto flex flex-col gap-2 pt-2">
        <div className="flex items-center justify-end empty:hidden">
          <SyncStatus dark />
        </div>
        <Button
          variant="night"
          className="w-full"
          icon={<CloudRain aria-hidden className="size-4.5" />}
          isDisabled={!online}
          onPress={onRainOut}
        >
          Rain-out
        </Button>
        {!online ? <OfflineNote dark /> : null}
      </div>
    </div>
  );
}

function KindLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5" aria-label="Session types">
      {LESSON_KIND_ORDER.map((k) => (
        <li key={k} className="flex items-center gap-1.5 text-[0.8125rem] text-ink-2">
          <span aria-hidden className={`size-3 rounded-[4px] ${KIND_SWATCH[k]}`} />
          {KIND_SHORT[k]}
        </li>
      ))}
      <li className="flex items-center gap-1.5 text-[0.8125rem] text-ink-2">
        <span aria-hidden className="size-3 rounded-[4px] bg-lime" />
        On court now
      </li>
    </ul>
  );
}

function DesktopSchedule({
  date,
  today,
  days,
  now,
  online,
  onSelect,
  onShiftWeek,
  onNew,
  scope,
  pick,
  view,
  onView,
}: NavProps & { view: View; onView: (v: View) => void }) {
  const fmt = useFormat();
  const week = useLessons(days[0] ?? date, days[6] ?? date);
  const lessons = pick(week.data ?? []);
  const open = lessons.filter((l) => l.status !== "cancelled");
  const hidden = (week.data ?? []).filter((l) => l.status !== "cancelled").length - open.length;
  const showEveryone = (
    <Button variant="light" size="sm" onPress={() => scope.setScope("everyone")}>
      Show everyone's
    </Button>
  );

  return (
    <Page className="flex flex-col gap-6">
      <PageHeader
        title="Schedule"
        subtitle={
          <span className="num">
            {dateRangeLabel(days[0] ?? date, days[6] ?? date, fmt.locale, { today })}
            {week.data
              ? ` · ${plural(open.length, "session")}${scope.scope === "mine" ? " of yours" : ""}`
              : ""}
          </span>
        }
        actions={
          <>
            <div className="flex items-center gap-0.5 rounded-full bg-card p-1">
              <IconButton label="Previous week" onPress={() => onShiftWeek(-1)}>
                <ChevronLeft aria-hidden className="size-5" />
              </IconButton>
              <Button
                variant="ghost"
                size="sm"
                isDisabled={date === today}
                onPress={() => onSelect(today)}
              >
                Today
              </Button>
              <IconButton label="Next week" onPress={() => onShiftWeek(1)}>
                <ChevronRight aria-hidden className="size-5" />
              </IconButton>
            </div>
            <Segmented
              label="View"
              hideLabel
              className="w-[13.5rem]"
              value={view}
              onChange={(v) => onView(v as View)}
              options={[
                { id: "week", label: "Week" },
                { id: "agenda", label: "Agenda" },
              ]}
            />
            <Button
              variant="dark"
              icon={<Plus aria-hidden className="size-4.5" />}
              isDisabled={!online}
              onPress={onNew}
            >
              New session
            </Button>
          </>
        }
      />
      {!online ? <OfflineNote className="-mt-3" /> : null}

      {week.isPending ? (
        <Card className="p-5" label="Loading the week">
          <div className="flex flex-col gap-3" aria-busy="true">
            <span className="sr-only">Loading the week…</span>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-[420px] w-full rounded-2xl" />
          </div>
        </Card>
      ) : !week.data ? (
        <Card className="px-6 py-2">
          <ErrorState message={errorMessage(week.error)} onRetry={() => void week.refetch()} />
        </Card>
      ) : view === "week" ? (
        <Card className="p-4 pt-3" label="Week">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 pb-3">
            <KindLegend />
            {open.length === 0 ? (
              hidden ? (
                <p className="ml-auto flex items-center gap-3 text-[0.875rem] text-ink-2">
                  None of your sessions this week.
                  {showEveryone}
                </p>
              ) : (
                <p className="ml-auto flex items-center gap-3 text-[0.875rem] text-ink-2">
                  Nothing scheduled this week.
                  <Button variant="light" size="sm" isDisabled={!online} onPress={onNew}>
                    New session
                  </Button>
                </p>
              )
            ) : null}
          </div>
          <WeekGrid
            days={days}
            lessons={lessons}
            now={now}
            today={today}
            selected={date}
            onSelectDay={onSelect}
          />
        </Card>
      ) : (
        <Card className="px-3 py-2" label="Agenda">
          {open.length === 0 && lessons.length === 0 ? (
            <div className="px-2">
              {hidden ? (
                <EmptyState
                  icon={<CalendarPlus aria-hidden className="size-5" />}
                  title="None of your sessions this week"
                  body={`${plural(hidden, "session")} on the academy schedule this week, run by other coaches.`}
                  action={
                    <Button variant="dark" onPress={() => scope.setScope("everyone")}>
                      Show everyone's
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<CalendarPlus aria-hidden className="size-5" />}
                  title="Nothing scheduled this week"
                  body="Add a private lesson, a group class, or a clinic. Weekly sessions fill the weeks ahead on their own."
                  action={
                    <Button variant="dark" isDisabled={!online} onPress={onNew}>
                      New session
                    </Button>
                  }
                />
              )}
            </div>
          ) : (
            <AgendaDays days={days} lessons={lessons} now={now} today={today} />
          )}
        </Card>
      )}
    </Page>
  );
}

function PhoneSchedule({
  date,
  today,
  days,
  now,
  online,
  onSelect,
  onShiftWeek,
  onNew,
  onRainOut,
  scope,
  pick,
}: NavProps) {
  const fmt = useFormat();
  const first = days[0] ?? date;
  const range = useLessons(first, addDays(first, 13));
  const lessons = pick(range.data ?? []);
  const byDay = groupByDay(lessons, fmt);
  const dayLessons = byDay.get(date) ?? [];
  const next = daysFrom(addDays(date, 1), 7);
  const nextCount = next.reduce((n, d) => n + (byDay.get(d)?.length ?? 0), 0);
  const open = dayLessons.filter((l) => l.status !== "cancelled").length;
  const hidden =
    (range.data ?? []).filter((l) => fmt.dayOf(l.startsAt) === date).length - dayLessons.length;

  return (
    <div className="flex flex-col">
      <section className="dark-zone rounded-b-[32px] bg-night px-4 pt-[calc(env(safe-area-inset-top)+20px)] pb-5 text-night-ink">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[2rem] leading-tight font-light tracking-[-0.02em]">Schedule</h1>
            <p className="num mt-1 text-[0.9375rem] text-night-ink-2">
              {dateRangeLabel(first, days[6] ?? first, fmt.locale, { today })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SyncStatus dark />
            <IconButton label="Previous week" variant="night" onPress={() => onShiftWeek(-1)}>
              <ChevronLeft aria-hidden className="size-5" />
            </IconButton>
            <IconButton label="Next week" variant="night" onPress={() => onShiftWeek(1)}>
              <ChevronRight aria-hidden className="size-5" />
            </IconButton>
          </div>
        </div>
        {scope.enabled ? (
          <ScopeToggle dark value={scope.scope} onChange={scope.setScope} className="mt-4" />
        ) : null}
        <div className="mt-5">
          <DayStrip
            days={days}
            selected={date}
            today={today}
            counts={countByDay(lessons, fmt)}
            onSelect={onSelect}
          />
        </div>
        <div className="mt-4 flex gap-2">
          <Button
            variant="lime"
            className="flex-1"
            icon={<Plus aria-hidden className="size-4.5" />}
            isDisabled={!online}
            onPress={onNew}
          >
            New session
          </Button>
          {date !== today ? (
            <Button variant="night" onPress={() => onSelect(today)}>
              Today
            </Button>
          ) : null}
          <IconButton label="Rain-out" variant="night" isDisabled={!online} onPress={onRainOut}>
            <CloudRain aria-hidden className="size-5" />
          </IconButton>
        </div>
        {!online ? <OfflineNote dark className="mt-3" /> : null}
      </section>

      <Page className="flex flex-col gap-4 pt-4">
        <Card label={fmt.longDay(date)}>
          <CardHeader
            title={fmt.longDay(date)}
            action={
              date === today ? (
                <Pill tone="outline">Today</Pill>
              ) : range.data ? (
                <span className="num text-[0.875rem] text-ink-2">{plural(open, "session")}</span>
              ) : null
            }
          />
          {range.isPending ? (
            <div className="px-5 pb-3">
              <RowsSkeleton rows={2} />
            </div>
          ) : !range.data ? (
            <div className="px-5 pb-2">
              <ErrorState
                message={errorMessage(range.error)}
                onRetry={() => void range.refetch()}
              />
            </div>
          ) : dayLessons.length ? (
            <div className="flex flex-col px-3 pb-3">
              {dayLessons.map((l) => (
                <LessonRow key={l.id} lesson={l} now={now} />
              ))}
            </div>
          ) : hidden ? (
            <div className="px-5 pb-3">
              <EmptyState
                icon={<CalendarPlus aria-hidden className="size-5" />}
                title="None of your sessions"
                body={`${plural(hidden, "session")} on the academy schedule that day, run by other coaches.`}
                action={
                  <Button variant="dark" onPress={() => scope.setScope("everyone")}>
                    Show everyone's
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="px-5 pb-3">
              <EmptyState
                icon={<CalendarPlus aria-hidden className="size-5" />}
                title={date < today ? "No sessions that day" : "Nothing on court"}
                body={
                  date < today
                    ? "Nothing was scheduled. Log a session you forgot to add, or pick another day."
                    : "A free day. Schedule a lesson, a group class, or a clinic."
                }
                action={
                  <Button variant="dark" isDisabled={!online} onPress={onNew}>
                    New session
                  </Button>
                }
              />
            </div>
          )}
        </Card>

        <Card label="Next 7 days">
          <CardHeader
            title="Next 7 days"
            action={
              range.data ? (
                <span className="num text-[0.875rem] text-ink-2">
                  {plural(nextCount, "session")}
                </span>
              ) : null
            }
          />
          {range.isPending ? (
            <div className="px-5 pb-3">
              <RowsSkeleton rows={3} />
            </div>
          ) : nextCount ? (
            <div className="px-3 pb-2">
              <AgendaDays
                days={next}
                lessons={lessons}
                now={now}
                today={today}
                hideEmpty
                idPrefix="next"
              />
            </div>
          ) : range.data ? (
            <p className="px-5 pb-5 text-ink-2">Nothing else in the week after {fmt.day(date)}.</p>
          ) : null}
        </Card>
      </Page>
    </div>
  );
}
