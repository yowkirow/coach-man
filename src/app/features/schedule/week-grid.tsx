import type { LessonSummaryDto } from "@shared/api-types";
import { LESSON_KIND_LABELS } from "@shared/domain";
import { weekdayOf } from "@shared/time";
import { Link } from "@tanstack/react-router";
import { CircleCheck } from "lucide-react";
import { sessionPhase } from "../../components/domain/lesson";
import { type Format, plural, useFormat } from "../../lib/format";
import { whereOf } from "../sessions/session-detail";
import { dayNumber, hourLabel, minutesOf, weekdayName } from "./dates";
import { KIND_BLOCK } from "./kinds";

const HOUR_PX = 52;
const DEFAULT_FIRST_HOUR = 6;
const DEFAULT_LAST_HOUR = 21;

interface Placed {
  lesson: LessonSummaryDto;
  start: number;
  end: number;
  lane: number;
  lanes: number;
}

/** Minutes from local midnight for a session, clipped to the day it starts on. */
function span(l: LessonSummaryDto, fmt: Format): { start: number; end: number } {
  const start = minutesOf(l.startsAt, fmt.tz);
  const sameDay = fmt.dayOf(l.endsAt) === fmt.dayOf(l.startsAt);
  const end = sameDay ? minutesOf(l.endsAt, fmt.tz) : 24 * 60;
  return { start, end: Math.max(end, start + 15) };
}

/** Side-by-side lanes for overlapping sessions (each cluster shares its widest lane count). */
export function layoutDay(lessons: LessonSummaryDto[], fmt: Format): Placed[] {
  const items = lessons
    .map((lesson) => ({ lesson, ...span(lesson, fmt) }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: Placed[] = [];
  let cluster: Placed[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const p of cluster) p.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  for (const it of items) {
    if (it.start >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(it.end);
    } else {
      laneEnds[lane] = it.end;
    }
    const p: Placed = { ...it, lane, lanes: 1 };
    cluster.push(p);
    placed.push(p);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return placed;
}

export function groupByDay(lessons: LessonSummaryDto[], fmt: Format) {
  const map = new Map<string, LessonSummaryDto[]>();
  for (const l of lessons) {
    const d = fmt.dayOf(l.startsAt);
    const list = map.get(d);
    if (list) list.push(l);
    else map.set(d, [l]);
  }
  return map;
}

/** Duration-true week view: one column per day, blocks positioned by start and end. */
export function WeekGrid({
  days,
  lessons,
  now,
  today,
  selected,
  onSelectDay,
}: {
  days: string[];
  lessons: LessonSummaryDto[];
  now: number;
  today: string;
  selected: string;
  onSelectDay: (day: string) => void;
}) {
  const fmt = useFormat();
  const byDay = groupByDay(lessons, fmt);
  let first = DEFAULT_FIRST_HOUR;
  let last = DEFAULT_LAST_HOUR;
  for (const l of lessons) {
    const s = span(l, fmt);
    first = Math.min(first, Math.floor(s.start / 60));
    last = Math.max(last, Math.ceil(s.end / 60));
  }
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const height = hours.length * HOUR_PX;
  const nowMin = minutesOf(now, fmt.tz);
  const nowTop =
    days.includes(today) && nowMin >= first * 60 && nowMin <= last * 60
      ? ((nowMin - first * 60) / 60) * HOUR_PX
      : null;
  const cols = "grid grid-cols-[3.25rem_repeat(7,minmax(0,1fr))] gap-x-1.5";

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[44rem]">
        <div className={cols}>
          <span aria-hidden />
          {days.map((d) => {
            const count = (byDay.get(d) ?? []).filter((l) => l.status !== "cancelled").length;
            const isSel = d === selected;
            const isToday = d === today;
            return (
              <button
                key={d}
                type="button"
                onClick={() => onSelectDay(d)}
                aria-pressed={isSel}
                aria-label={`${fmt.longDay(d)}${isToday ? ", today" : ""}, ${count ? plural(count, "session") : "no sessions"}`}
                className="flex cursor-pointer flex-col items-center gap-1 rounded-2xl py-1.5 outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
              >
                <span className="text-[0.8125rem] text-ink-2">
                  {weekdayName(weekdayOf(d), fmt.locale, "short")}
                </span>
                <span
                  className={`num flex size-10 items-center justify-center rounded-full text-[1.25rem] font-light ${
                    isSel
                      ? "bg-lime font-normal text-ink"
                      : isToday
                        ? "text-ink ring-[1.5px] ring-ink ring-inset"
                        : "text-ink"
                  }`}
                >
                  {dayNumber(d)}
                </span>
              </button>
            );
          })}
        </div>

        <div className={`${cols} mt-2`} style={{ height }}>
          <div aria-hidden className="relative">
            {hours.map((h, i) => (
              <span
                key={h}
                className="num absolute right-1 text-[0.6875rem] leading-none text-ink-2"
                style={{ top: i === 0 ? 2 : i * HOUR_PX - 5 }}
              >
                {hourLabel(h, fmt.locale)}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const placed = layoutDay(byDay.get(d) ?? [], fmt);
            const isToday = d === today;
            return (
              <section
                key={d}
                aria-label={fmt.longDay(d)}
                className={`relative rounded-xl ${isToday ? "bg-panel" : ""}`}
                style={{
                  backgroundImage: `repeating-linear-gradient(to bottom, var(--color-line) 0, var(--color-line) 1px, transparent 1px, transparent ${HOUR_PX}px)`,
                }}
              >
                <ol className="absolute inset-0">
                  {placed.map((p) => (
                    <SessionBlock
                      key={p.lesson.id}
                      placed={p}
                      firstHour={first}
                      now={now}
                      fmt={fmt}
                    />
                  ))}
                </ol>
                {isToday && nowTop !== null ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                    style={{ top: nowTop - 4 }}
                  >
                    <span className="-ml-1 size-2.5 shrink-0 rounded-full bg-ink" />
                    <span className="h-0.5 flex-1 bg-ink" />
                  </span>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SessionBlock({
  placed,
  firstHour,
  now,
  fmt,
}: {
  placed: Placed;
  firstHour: number;
  now: number;
  fmt: Format;
}) {
  const l = placed.lesson;
  const phase = sessionPhase(l, now);
  const cancelled = phase === "cancelled";
  const top = ((placed.start - firstHour * 60) / 60) * HOUR_PX;
  const h = Math.max(((placed.end - placed.start) / 60) * HOUR_PX - 2, 22);
  const tone = cancelled
    ? "bg-coral-soft text-ink-2"
    : phase === "live"
      ? "bg-lime text-ink"
      : `${KIND_BLOCK[l.kind]} text-ink`;
  const where = whereOf(l);
  const status = cancelled
    ? "cancelled"
    : phase === "live"
      ? "on court now"
      : l.status === "completed"
        ? "completed"
        : `${l.checkedInCount} of ${l.bookedCount} checked in`;
  return (
    <li
      className="absolute"
      style={{
        top: top + 1,
        height: h,
        left: `calc(${(placed.lane / placed.lanes) * 100}% + 2px)`,
        width: `calc(${100 / placed.lanes}% - 4px)`,
      }}
    >
      <Link
        to="/sessions/$lessonId"
        params={{ lessonId: l.id }}
        aria-label={`${l.title}, ${LESSON_KIND_LABELS[l.kind]}, ${fmt.timeRange(l.startsAt, l.endsAt)}${where ? `, ${where}` : ""}, ${status}`}
        className={`flex h-full flex-col overflow-hidden rounded-[12px] px-2 py-1.5 outline-none transition-[filter] duration-150 hover:brightness-[0.96] focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink ${tone}`}
      >
        <span
          className={`flex min-w-0 items-center gap-1 text-[0.8125rem] leading-tight font-medium ${cancelled ? "line-through" : ""}`}
        >
          {l.status === "completed" ? (
            <CircleCheck aria-hidden className="size-3.5 shrink-0" />
          ) : null}
          <span className="truncate">{l.title}</span>
        </span>
        {h >= 36 ? (
          <span className="num mt-0.5 truncate text-[0.75rem] leading-tight text-ink/75">
            {fmt.timeRange(l.startsAt, l.endsAt)}
          </span>
        ) : null}
        {h >= 66 && where ? (
          <span className="mt-0.5 truncate text-[0.75rem] leading-tight text-ink/75">{where}</span>
        ) : null}
      </Link>
    </li>
  );
}
