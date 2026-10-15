import type { EventDto } from "@shared/api-types";
import { EVENT_KIND_LABELS } from "@shared/domain";
import { compareDates } from "@shared/time";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRight,
  CalendarClock,
  CircleCheck,
  CircleDollarSign,
  CircleX,
  PenLine,
  Radio,
  UsersRound,
} from "lucide-react";
import { useMemo } from "react";
import { SyncStatus } from "../../components/layout/app-shell";
import { buttonClass } from "../../components/ui/button";
import { KpiTile, Meter, Pill } from "../../components/ui/display";
import { Skeleton } from "../../components/ui/feedback";
import { plural, useFormat } from "../../lib/format";
import { useVenues } from "../../lib/hooks";
import {
  EVENT_KIND_FILL,
  EVENT_KIND_ICON,
  EVENT_KIND_TONE,
  EVENT_STATUS_LABEL,
  EVENT_STATUS_TONE,
  eventDates,
  eventTiming,
  moneyCompact,
  timingLabel,
} from "./event-meta";
import { useEvents } from "./queries";

export interface EventStats {
  open: number;
  registered: number;
  waitlisted: number;
  dueMinor: number;
}

/** All events once, split into upcoming (soonest first) and past (latest first). */
export function useEventsOverview() {
  const fmt = useFormat();
  const today = fmt.today();
  const all = useEvents("all");
  return useMemo(() => {
    const list = all.data ?? [];
    const upcoming = list.filter((e) => compareDates(e.endsOn, today) >= 0);
    const past = list
      .filter((e) => compareDates(e.endsOn, today) < 0)
      .sort((a, b) => compareDates(b.startsOn, a.startsOn));
    const live = upcoming.filter((e) => e.status !== "cancelled");
    const stats: EventStats | null = all.data
      ? {
          open: live.filter((e) => e.status === "open").length,
          registered: live.reduce((n, e) => n + e.registeredCount, 0),
          waitlisted: live.reduce((n, e) => n + e.waitlistCount, 0),
          dueMinor: list.reduce((n, e) => n + e.dueMinor, 0),
        }
      : null;
    return { all, upcoming, past, stats, today };
  }, [all, today]);
}

export function EventKpis({ stats }: { stats: EventStats | null }) {
  const fmt = useFormat();
  const navigate = useNavigate();
  const dash = "–";
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <KpiTile label="Open events" value={stats?.open ?? dash} tint="lime" />
      <KpiTile
        label="Registered"
        value={stats?.registered ?? dash}
        tint="sky"
        hint="Players registered for upcoming events"
      />
      <KpiTile
        label="Waitlisted"
        value={stats?.waitlisted ?? dash}
        tint="amber"
        hint="Players waiting for a spot in upcoming events"
      />
      <KpiTile
        label="Due"
        value={stats ? moneyCompact(stats.dueMinor, fmt) : dash}
        tint="coral"
        hint={stats ? `${fmt.money(stats.dueMinor)} of event fees unpaid. Opens Money.` : undefined}
        onPress={() => void navigate({ to: "/money" })}
      />
    </div>
  );
}

function TimingIcon({ event, today }: { event: EventDto; today: string }) {
  const cls = "size-4 shrink-0";
  if (event.status === "cancelled") return <CircleX aria-hidden className={cls} />;
  if (event.status === "draft") return <PenLine aria-hidden className={cls} />;
  const t = eventTiming(event, today);
  if (t === "on") return <Radio aria-hidden className={cls} />;
  if (t === "ended") return <CircleCheck aria-hidden className={cls} />;
  return <CalendarClock aria-hidden className={cls} />;
}

function countLabel(e: EventDto) {
  return e.capacity ? `${e.registeredCount}/${e.capacity}` : String(e.registeredCount);
}

/** Dark list card for the command panel; the open event turns lime. */
export function EventTile({ event, selected }: { event: EventDto; selected: boolean }) {
  const fmt = useFormat();
  const today = fmt.today();
  const Icon = EVENT_KIND_ICON[event.kind];
  const sub = selected ? "text-ink/70" : "text-night-ink-2";
  const status =
    event.status === "draft"
      ? "Draft: not open yet"
      : event.status === "closed" && eventTiming(event, today) === "upcoming"
        ? "Registration closed"
        : timingLabel(event, today, fmt);
  return (
    <Link
      to="/events/$eventId"
      params={{ eventId: event.id }}
      aria-current={selected ? "page" : undefined}
      className={`block rounded-[24px] p-4 outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime ${
        selected ? "bg-lime text-ink" : "bg-night-2 text-night-ink hover:bg-night-3"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-full ${selected ? "bg-ink/10" : "bg-night-3"}`}
        >
          <Icon aria-hidden className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[1rem] leading-snug">{event.name}</span>
          <span className={`num block truncate text-[0.75rem] ${sub}`}>
            {eventDates(event, fmt)} · {EVENT_KIND_LABELS[event.kind]}
          </span>
        </span>
        <ArrowUpRight aria-hidden className={`size-4 shrink-0 ${sub}`} />
      </div>
      <div
        className={`mt-3 flex h-11 items-center gap-2 rounded-full border px-3 ${selected ? "border-ink/15" : "border-night-4"}`}
      >
        <TimingIcon event={event} today={today} />
        <span className="num flex-1 truncate text-[0.8125rem]">{status}</span>
        <Pill tone={selected ? "white" : event.waitlistCount ? "amber" : "violet"}>
          <UsersRound aria-hidden className="size-3" />
          <span className="num">{countLabel(event)}</span>
          <span className="sr-only">registered</span>
        </Pill>
      </div>
    </Link>
  );
}

function TileSkeletons() {
  return (
    <>
      <Skeleton dark className="h-[124px] rounded-[24px]" />
      <Skeleton dark className="h-[124px] rounded-[24px]" />
    </>
  );
}

/** The command panel on Events pages: KPIs, upcoming events, and the latest past ones. */
export function EventsPanel({ selectedId }: { selectedId?: string }) {
  const { all, upcoming, past, stats } = useEventsOverview();
  const selectedPast = past.find((e) => e.id === selectedId);
  const recent = past.slice(0, 3);
  const pastShown =
    selectedPast && !recent.includes(selectedPast) ? [...recent, selectedPast] : recent;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-2 px-1">
        <div>
          <h2 className="text-[1.75rem] leading-tight font-light tracking-[-0.01em]">Events</h2>
          <p className="num mt-1 text-[0.875rem] text-night-ink-2">
            {stats
              ? `${upcoming.length} upcoming · ${plural(stats.registered, "player")} registered`
              : "Loading…"}
          </p>
        </div>
        <SyncStatus dark />
      </div>
      <EventKpis stats={stats} />
      <section aria-labelledby="panel-upcoming" className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between px-1 pt-1">
          <h3 id="panel-upcoming" className="text-[1.125rem] font-light">
            Upcoming
          </h3>
          <Link
            to="/events"
            search={{ new: "1" }}
            className="rounded-full px-2 py-1 text-[0.8125rem] text-night-ink-2 outline-none hover:text-night-ink focus-visible:outline-2 focus-visible:outline-lime"
          >
            New event
          </Link>
        </div>
        {all.isPending ? (
          <TileSkeletons />
        ) : !all.data ? (
          <div className="rounded-[24px] bg-night-2 p-5">
            <p className="text-night-ink">Couldn't load your events.</p>
            <button
              type="button"
              onClick={() => void all.refetch()}
              className={buttonClass("night", "sm", "mt-4")}
            >
              Try again
            </button>
          </div>
        ) : upcoming.length ? (
          upcoming.map((e) => <EventTile key={e.id} event={e} selected={e.id === selectedId} />)
        ) : (
          <div className="rounded-[24px] bg-night-2 p-5">
            <p className="text-night-ink">Nothing coming up.</p>
            <p className="mt-1 text-[0.8125rem] text-night-ink-2">
              Plan a camp, clinic, or social and take sign-ups here.
            </p>
            <Link to="/events" search={{ new: "1" }} className={buttonClass("lime", "sm", "mt-4")}>
              New event
            </Link>
          </div>
        )}
      </section>
      {pastShown.length ? (
        <section aria-labelledby="panel-past" className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between px-1 pt-1">
            <h3 id="panel-past" className="text-[1.125rem] font-light">
              Past
            </h3>
            {past.length > pastShown.length ? (
              <Link
                to="/events"
                search={{ scope: "past" }}
                className="rounded-full px-2 py-1 text-[0.8125rem] text-night-ink-2 outline-none hover:text-night-ink focus-visible:outline-2 focus-visible:outline-lime"
              >
                All past events
              </Link>
            ) : null}
          </div>
          {pastShown.map((e) => (
            <EventTile key={e.id} event={e} selected={e.id === selectedId} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

/** White card for the main grid: dates, kind and status, fill, waitlist, and money. */
export function EventCard({ event: e }: { event: EventDto }) {
  const fmt = useFormat();
  const venues = useVenues();
  const today = fmt.today();
  const Icon = EVENT_KIND_ICON[e.kind];
  const venue = venues.data?.find((v) => v.id === e.venueId)?.name;
  const timing = eventTiming(e, today);
  const live = timing === "on" && (e.status === "open" || e.status === "closed");
  const full = e.capacity !== null && e.registeredCount >= e.capacity;
  const cancelled = e.status === "cancelled";
  return (
    <article className="group/card relative flex flex-col gap-4 rounded-[28px] bg-card p-5 has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ink">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`flex size-11 shrink-0 items-center justify-center rounded-full text-ink ${EVENT_KIND_FILL[e.kind]}`}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            className={`line-clamp-2 text-[1.5rem] leading-tight font-light tracking-[-0.01em] break-words ${cancelled ? "text-ink-2 line-through" : ""}`}
          >
            <Link
              to="/events/$eventId"
              params={{ eventId: e.id }}
              className="outline-none after:absolute after:inset-0 after:rounded-[28px]"
            >
              {e.name}
            </Link>
          </h2>
          <p className="num mt-1 truncate text-[0.875rem] text-ink-2">
            {eventDates(e, fmt, { weekday: true })}
            {venue ? ` · ${venue}` : ""}
          </p>
        </div>
        <ArrowUpRight
          aria-hidden
          className="size-5 shrink-0 text-ink-2 transition-transform duration-150 group-hover/card:translate-x-0.5 group-hover/card:-translate-y-0.5"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {live ? <Pill tone="lime">On now</Pill> : null}
        <Pill tone={EVENT_KIND_TONE[e.kind]}>{EVENT_KIND_LABELS[e.kind]}</Pill>
        <Pill tone={EVENT_STATUS_TONE[e.status]}>{EVENT_STATUS_LABEL[e.status]}</Pill>
        {!live && !cancelled ? (
          <Pill tone="outline">
            <span className="num">{timingLabel(e, today, fmt)}</span>
          </Pill>
        ) : null}
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex min-h-6 items-center justify-between gap-3 text-[0.875rem]">
          <span className="num">
            <span className="font-medium">{e.registeredCount}</span>
            {e.capacity ? ` of ${e.capacity}` : ""} registered
          </span>
          {e.waitlistCount ? (
            <Pill tone="amber">
              <span className="num">{e.waitlistCount} waitlisted</span>
            </Pill>
          ) : e.capacity ? (
            <span className="num text-ink-2">
              {full ? "Full" : `${plural(e.capacity - e.registeredCount, "spot")} left`}
            </span>
          ) : (
            <span className="text-ink-2">No limit</span>
          )}
        </div>
        {e.capacity ? <Meter value={e.registeredCount} max={e.capacity} /> : null}
      </div>

      <p className="mt-auto flex h-11 items-center gap-2 rounded-full bg-panel px-4 text-[0.875rem]">
        <CircleDollarSign aria-hidden className="size-4 shrink-0 text-ink-2" />
        <span className="num min-w-0 flex-1 truncate">{fmt.moneyShort(e.paidMinor)} paid</span>
        {e.dueMinor > 0 ? (
          <Pill tone="coral">
            <span className="num">{fmt.moneyShort(e.dueMinor)} due</span>
          </Pill>
        ) : e.registeredCount ? (
          <span className="text-ink-2">All paid</span>
        ) : null}
      </p>
    </article>
  );
}
