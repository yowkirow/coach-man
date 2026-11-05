import type { TodayDto } from "@shared/api-types";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Cake,
  CalendarClock,
  CalendarPlus,
  CircleDollarSign,
  Radio,
  Ticket,
} from "lucide-react";
import { BallMark } from "../../components/brand";
import { ScopeToggle } from "../../components/domain/coaches";
import { LessonRow, SessionTile, sessionPhase } from "../../components/domain/lesson";
import { RosterRow } from "../../components/domain/roster";
import { Page, ShellAside, SyncStatus, useIsDesktop } from "../../components/layout/app-shell";
import { Button, buttonClass } from "../../components/ui/button";
import { Avatar, AvatarStack, Card, CardHeader, KpiTile, Pill } from "../../components/ui/display";
import { EmptyState, ErrorState, RowsSkeleton, Skeleton } from "../../components/ui/feedback";
import { phaseLabel, SessionDetail, whereOf } from "../../features/sessions/session-detail";
import { errorMessage } from "../../lib/api";
import { inScope, useSessionScope } from "../../lib/coaches";
import { plural, useFormat } from "../../lib/format";
import { useCan, useMe, useNow, useToday } from "../../lib/hooks";

type TodayLesson = TodayDto["lessons"][number];
type Scope = ReturnType<typeof useSessionScope>;

export const Route = createFileRoute("/_app/")({
  validateSearch: (s: Record<string, unknown>): { session?: string } =>
    typeof s.session === "string" ? { session: s.session } : {},
  component: TodayPage,
});

/** The session that matters most right now: on court, else next up, else the last one. */
function featuredLesson(lessons: TodayLesson[], now: number): TodayLesson | null {
  const open = lessons.filter((l) => l.status !== "cancelled");
  return (
    open.find((l) => sessionPhase(l, now) === "live") ??
    open.find((l) => l.startsAt > now) ??
    open.at(-1) ??
    lessons[0] ??
    null
  );
}

function TodayPage() {
  const { session } = Route.useSearch();
  const desktop = useIsDesktop();
  const today = useToday();
  const now = useNow();
  const scope = useSessionScope();
  const all = today.data?.lessons ?? [];
  const lessons = inScope(all, scope.scope, scope.userId);
  const hidden = all.length - lessons.length;
  const featured = featuredLesson(lessons, now);
  const selected = (session ? all.find((l) => l.id === session) : undefined) ?? featured;
  const showEveryone = () => scope.setScope("everyone");

  return (
    <>
      <ShellAside>
        <TodayPanel
          data={today.data}
          lessons={lessons}
          hidden={hidden}
          scope={scope}
          isPending={today.isPending}
          now={now}
          selectedId={selected?.id ?? null}
        />
      </ShellAside>
      {desktop ? (
        <Page>
          {today.isPending ? (
            <DesktopSkeleton />
          ) : !today.data ? (
            <ErrorState message={errorMessage(today.error)} onRetry={() => void today.refetch()} />
          ) : selected ? (
            <SessionDetail
              lessonId={selected.id}
              now={now}
              extraAside={<Attention alerts={today.data.alerts} />}
            />
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
              <NothingToday hidden={hidden} onShowEveryone={showEveryone} />
              <Attention alerts={today.data.alerts} />
            </div>
          )}
        </Page>
      ) : (
        <PhoneToday
          data={today.data}
          lessons={lessons}
          hidden={hidden}
          scope={scope}
          isPending={today.isPending}
          error={today.error}
          onRetry={() => void today.refetch()}
          featured={featured}
          now={now}
        />
      )}
    </>
  );
}

function DesktopSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Loading today…</span>
      <Skeleton className="h-12 w-1/2 max-w-md" />
      <Skeleton className="h-4 w-1/3 max-w-xs" />
      <Card className="p-5">
        <RowsSkeleton rows={4} />
      </Card>
    </div>
  );
}

function TodayKpis({ data, lessons: scoped }: { data?: TodayDto; lessons: TodayLesson[] }) {
  const navigate = useNavigate();
  const can = useCan();
  const lessons = scoped.filter((l) => l.status !== "cancelled");
  const booked = lessons.reduce((n, l) => n + l.bookedCount, 0);
  const checkedIn = lessons.reduce((n, l) => n + l.checkedInCount, 0);
  const renewals = new Set(
    [...(data?.alerts.lowCredits ?? []), ...(data?.alerts.expiringPackages ?? [])].map(
      (a) => a.clientId,
    ),
  ).size;
  const due = data?.alerts.balancesDue.length ?? 0;
  const birthdays = data?.alerts.birthdays.length ?? 0;
  const dash = "–";
  const toAttention = () =>
    document.getElementById("attention")?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <KpiTile label="Sessions" value={data ? lessons.length : dash} tint="lime" />
      <KpiTile label="Checked in" value={data ? `${checkedIn}/${booked}` : dash} tint="sky" />
      <KpiTile
        label="Low credits"
        value={data ? renewals : dash}
        tint="amber"
        hint="Clients who need a new package soon"
        onPress={toAttention}
      />
      {can.money ? (
        <KpiTile
          label="Balances due"
          value={data ? due : dash}
          tint="coral"
          hint="Open Money"
          onPress={() => void navigate({ to: "/money" })}
        />
      ) : (
        <KpiTile
          label="Birthdays"
          value={data ? birthdays : dash}
          tint="violet"
          hint="Players with a birthday today"
          onPress={toAttention}
        />
      )}
    </div>
  );
}

function TodayPanel({
  data,
  lessons,
  hidden,
  scope,
  isPending,
  now,
  selectedId,
}: {
  data?: TodayDto;
  lessons: TodayLesson[];
  hidden: number;
  scope: Scope;
  isPending: boolean;
  now: number;
  selectedId: string | null;
}) {
  const fmt = useFormat();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-2 px-1">
        <div>
          <h2 className="text-[1.75rem] leading-tight font-light tracking-[-0.01em]">Today</h2>
          <p className="mt-1 text-[0.875rem] text-night-ink-2">
            {fmt.longDay(data?.date ?? fmt.today())}
          </p>
        </div>
        <SyncStatus dark />
      </div>
      {scope.enabled ? <ScopeToggle dark value={scope.scope} onChange={scope.setScope} /> : null}
      <TodayKpis data={data} lessons={lessons} />
      <section aria-labelledby="today-sessions" className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between px-1 pt-1">
          <h3 id="today-sessions" className="text-[1.125rem] font-light">
            Sessions
          </h3>
          <Link
            to="/schedule"
            className="rounded-full px-2 py-1 text-[0.8125rem] text-night-ink-2 outline-none hover:text-night-ink focus-visible:outline-2 focus-visible:outline-lime"
          >
            Full schedule
          </Link>
        </div>
        {isPending ? (
          <>
            <Skeleton dark className="h-[124px] rounded-[24px]" />
            <Skeleton dark className="h-[124px] rounded-[24px]" />
          </>
        ) : lessons.length ? (
          lessons.map((l) => (
            <SessionTile
              key={l.id}
              lesson={l}
              people={l.roster}
              now={now}
              selected={l.id === selectedId}
              linkTo="today"
            />
          ))
        ) : hidden ? (
          <div className="rounded-[24px] bg-night-2 p-5">
            <p className="text-night-ink">None of your sessions today.</p>
            <p className="mt-1 text-[0.8125rem] text-night-ink-2">
              {plural(hidden, "session")} on the academy schedule.
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
            <p className="text-night-ink">No sessions today.</p>
            <p className="mt-1 text-[0.8125rem] text-night-ink-2">
              A free day, or time to fill the courts.
            </p>
            <Link
              to="/schedule"
              search={{ new: "1" }}
              className={buttonClass("lime", "sm", "mt-4")}
            >
              <CalendarPlus aria-hidden className="size-4" />
              New session
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}

function NothingToday({
  hidden = 0,
  onShowEveryone,
}: {
  hidden?: number;
  onShowEveryone?: () => void;
}) {
  if (hidden && onShowEveryone) {
    return (
      <Card className="p-6">
        <EmptyState
          icon={<CalendarPlus aria-hidden className="size-5" />}
          title="None of your sessions today"
          body={`${plural(hidden, "session")} on the academy schedule today, run by other coaches.`}
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="dark" onPress={onShowEveryone}>
                Show everyone's
              </Button>
              <Link to="/schedule" search={{ new: "1" }} className={buttonClass("light")}>
                New session
              </Link>
            </div>
          }
        />
      </Card>
    );
  }
  return (
    <Card className="p-6">
      <EmptyState
        icon={<CalendarPlus aria-hidden className="size-5" />}
        title="Nothing on court today"
        body="Schedule a private lesson, a group class, or a clinic. Recurring sessions fill your week automatically."
        action={
          <div className="flex flex-wrap gap-2">
            <Link to="/schedule" search={{ new: "1" }} className={buttonClass("dark")}>
              New session
            </Link>
            <Link to="/schedule" className={buttonClass("light")}>
              Open schedule
            </Link>
          </div>
        }
      />
    </Card>
  );
}

const ALERT_TONES = {
  due: { icon: CircleDollarSign, cls: "bg-coral" },
  low: { icon: Ticket, cls: "bg-amber" },
  expiring: { icon: CalendarClock, cls: "bg-sky" },
  birthday: { icon: Cake, cls: "bg-lavender" },
} as const;

function Attention({ alerts }: { alerts: TodayDto["alerts"] }) {
  const fmt = useFormat();
  const can = useCan();
  const items = [
    ...(can.money ? alerts.balancesDue : []).map((a) => ({
      key: `due-${a.clientId}`,
      clientId: a.clientId,
      name: a.name,
      text: `Owes ${fmt.money(a.balanceMinor)}`,
      kind: "due" as const,
    })),
    ...alerts.lowCredits.map((a) => ({
      key: `low-${a.clientId}-${a.packageName}`,
      clientId: a.clientId,
      name: a.name,
      text: `${plural(a.remaining, "credit")} left on ${a.packageName}`,
      kind: "low" as const,
    })),
    ...alerts.expiringPackages.map((a) => ({
      key: `exp-${a.clientId}-${a.packageName}`,
      clientId: a.clientId,
      name: a.name,
      text: `${a.packageName} expires ${fmt.day(a.expiresOn)} · ${plural(a.remaining, "credit")} left`,
      kind: "expiring" as const,
    })),
    ...alerts.birthdays.map((a) => ({
      key: `bday-${a.clientId}`,
      clientId: a.clientId,
      name: a.name,
      text: a.age ? `Turns ${a.age} today` : "Birthday today",
      kind: "birthday" as const,
    })),
  ];
  return (
    <div id="attention" className="scroll-mt-4">
      <Card label="Needs attention">
        <CardHeader
          title="Needs attention"
          action={items.length ? <Pill tone="panel">{items.length}</Pill> : null}
        />
        {items.length ? (
          <ul className="flex flex-col px-3 pb-3">
            {items.map((it) => {
              const tone = ALERT_TONES[it.kind];
              return (
                <li key={it.key}>
                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: it.clientId }}
                    className="flex items-center gap-3 rounded-2xl px-2 py-2.5 outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
                  >
                    <span
                      aria-hidden
                      className={`flex size-10 shrink-0 items-center justify-center rounded-full text-ink ${tone.cls}`}
                    >
                      <tone.icon className="size-4.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{it.name}</span>
                      <span className="block truncate text-[0.8125rem] text-ink-2">{it.text}</span>
                    </span>
                    <ArrowUpRight aria-hidden className="size-4 shrink-0 text-ink-3" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-5 pb-5 text-[0.9375rem] text-ink-2">
            {can.money
              ? "All clear: no low credits, renewals, or balances due."
              : "All clear: no low credits, renewals, or birthdays."}
          </p>
        )}
      </Card>
    </div>
  );
}

function PhoneToday({
  data,
  lessons,
  hidden,
  scope,
  isPending,
  error,
  onRetry,
  featured,
  now,
}: {
  data?: TodayDto;
  lessons: TodayLesson[];
  hidden: number;
  scope: Scope;
  isPending: boolean;
  error: Error | null;
  onRetry: () => void;
  featured: TodayLesson | null;
  now: number;
}) {
  const fmt = useFormat();
  const me = useMe().data;
  const [firstName, ...rest] = (me?.user.name ?? "Coach").split(" ");
  const coach = { firstName: firstName ?? "Coach", lastName: rest.join(" ") };
  const others = lessons.filter((l) => l.id !== featured?.id);

  return (
    <div className="flex flex-col">
      <section className="dark-zone rounded-b-[32px] bg-night px-4 pt-[calc(env(safe-area-inset-top)+16px)] pb-5 text-night-ink">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <BallMark className="size-8" />
            <span className="text-[1.0625rem] font-medium tracking-[-0.01em]">CoachMan</span>
          </span>
          <div className="flex items-center gap-2">
            <SyncStatus dark />
            <Link
              to="/settings"
              aria-label="Account and settings"
              className="rounded-full outline-none focus-visible:outline-2 focus-visible:outline-lime"
            >
              <Avatar person={coach} size="sm" />
            </Link>
          </div>
        </div>
        <h1 className="mt-6 text-[2rem] leading-tight font-light tracking-[-0.02em]">Today</h1>
        <p className="mt-1 text-[0.9375rem] text-night-ink-2">
          {fmt.longDay(data?.date ?? fmt.today())}
        </p>
        {scope.enabled ? (
          <ScopeToggle dark value={scope.scope} onChange={scope.setScope} className="mt-4" />
        ) : null}
        <div className="mt-5">
          <TodayKpis data={data} lessons={lessons} />
        </div>
      </section>

      <Page className="flex flex-col gap-4 pt-4">
        {isPending ? (
          <>
            <Skeleton className="h-36 rounded-[28px]" />
            <Card className="p-5">
              <RowsSkeleton rows={3} />
            </Card>
          </>
        ) : !data ? (
          <ErrorState message={errorMessage(error)} onRetry={onRetry} />
        ) : featured ? (
          <>
            <FeaturedCard lesson={featured} now={now} />
            <Card label={`${featured.title} check-in`}>
              <CardHeader
                title="Check-in"
                action={
                  <Link
                    to="/sessions/$lessonId"
                    params={{ lessonId: featured.id }}
                    className="rounded-full px-2 py-1 text-[0.875rem] font-medium outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink"
                  >
                    Open session
                  </Link>
                }
              />
              {featured.roster.length ? (
                <div className="flex flex-col divide-y divide-line px-5 pb-2">
                  {featured.roster.map((r) => (
                    <RosterRow
                      key={r.attendanceId}
                      entry={r}
                      lessonId={featured.id}
                      lessonKind={featured.kind}
                      lessonCancelled={featured.status === "cancelled"}
                    />
                  ))}
                </div>
              ) : (
                <p className="px-5 pb-5 text-ink-2">
                  No players booked yet. Open the session to add them.
                </p>
              )}
            </Card>
          </>
        ) : (
          <NothingToday hidden={hidden} onShowEveryone={() => scope.setScope("everyone")} />
        )}

        {others.length ? (
          <Card label="Rest of today">
            <CardHeader title="Rest of today" />
            <div className="flex flex-col px-3 pb-3">
              {others.map((l) => (
                <LessonRow key={l.id} lesson={l} now={now} />
              ))}
            </div>
          </Card>
        ) : null}

        {data ? <Attention alerts={data.alerts} /> : null}
      </Page>
    </div>
  );
}

function FeaturedCard({ lesson, now }: { lesson: TodayLesson; now: number }) {
  const fmt = useFormat();
  const phase = sessionPhase(lesson, now);
  const live = phase === "live";
  const where = whereOf(lesson);
  const StatusIcon = live ? Radio : CalendarClock;
  // Featured = selected, so it is lime like the selected card in the desktop panel.
  return (
    <section
      aria-label={live ? "On court now" : "Next session"}
      className="rounded-[28px] bg-lime p-5 text-ink [--avatar-ring:var(--color-lime)]"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[1.5rem] leading-tight font-light tracking-[-0.01em]">
            {lesson.title}
          </h2>
          <p className="num mt-1 text-[0.875rem] text-ink/70">
            {fmt.timeRange(lesson.startsAt, lesson.endsAt)}
            {where ? ` · ${where}` : ""}
          </p>
        </div>
        <Link
          to="/sessions/$lessonId"
          params={{ lessonId: lesson.id }}
          aria-label={`Open ${lesson.title}`}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-ink text-white outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <ArrowUpRight aria-hidden className="size-5" />
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {lesson.roster.length ? <AvatarStack people={lesson.roster} max={4} /> : null}
        <Pill tone="white">
          <StatusIcon aria-hidden className="size-3.5" />
          {phaseLabel(lesson, now, fmt)}
        </Pill>
        <Pill tone="white">
          <span className="num">
            {lesson.checkedInCount}/{lesson.bookedCount}
          </span>
          in
        </Pill>
      </div>
    </section>
  );
}
