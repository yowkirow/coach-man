import type { LessonSummaryDto } from "@shared/api-types";
import { weekdayOf } from "@shared/time";
import { LessonRow } from "../../components/domain/lesson";
import { Pill } from "../../components/ui/display";
import { plural, useFormat } from "../../lib/format";
import { dayNumber, weekdayName } from "./dates";
import { groupByDay } from "./week-grid";

/** Day-by-day list of sessions (desktop agenda view and the phone's "next 7 days"). */
export function AgendaDays({
  days,
  lessons,
  now,
  today,
  hideEmpty = false,
  idPrefix = "agenda",
}: {
  days: string[];
  lessons: LessonSummaryDto[];
  now: number;
  today: string;
  hideEmpty?: boolean;
  idPrefix?: string;
}) {
  const fmt = useFormat();
  const byDay = groupByDay(lessons, fmt);
  return (
    <div className="flex flex-col divide-y divide-line">
      {days.map((d) => {
        const list = byDay.get(d) ?? [];
        if (hideEmpty && !list.length) return null;
        const open = list.filter((l) => l.status !== "cancelled").length;
        return (
          <section key={d} aria-labelledby={`${idPrefix}-${d}`} className="py-2">
            <div className="flex items-center gap-2 px-2 pt-1.5 pb-0.5">
              <h3 id={`${idPrefix}-${d}`} className="text-[0.9375rem] font-medium">
                {fmt.longDay(d)}
              </h3>
              {d === today ? <Pill tone="outline">Today</Pill> : null}
              <span className="ml-auto text-[0.8125rem] text-ink-2">
                {list.length ? plural(open, "session") : "Free"}
              </span>
            </div>
            {list.length ? (
              <div className="flex flex-col">
                {list.map((l) => (
                  <LessonRow key={l.id} lesson={l} now={now} />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/** Seven-day strip for the phone's dark header: lime selected day, dot when booked. */
export function DayStrip({
  days,
  selected,
  today,
  counts,
  onSelect,
}: {
  days: string[];
  selected: string;
  today: string;
  counts: Map<string, number>;
  onSelect: (day: string) => void;
}) {
  const fmt = useFormat();
  return (
    <ul className="grid grid-cols-7 gap-1.5" aria-label="Days this week">
      {days.map((d) => {
        const isSel = d === selected;
        const isToday = d === today;
        const count = counts.get(d) ?? 0;
        return (
          <li key={d}>
            <button
              type="button"
              onClick={() => onSelect(d)}
              aria-pressed={isSel}
              aria-label={`${fmt.longDay(d)}${isToday ? ", today" : ""}, ${count ? plural(count, "session") : "no sessions"}`}
              className={`flex h-[4.5rem] w-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[20px] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime ${
                isSel ? "bg-lime text-ink" : "bg-night-2 text-night-ink hover:bg-night-3"
              } ${isToday && !isSel ? "ring-[1.5px] ring-night-ink ring-inset" : ""}`}
            >
              <span className={`text-[0.75rem] ${isSel ? "text-ink/70" : "text-night-ink-2"}`}>
                {weekdayName(weekdayOf(d), fmt.locale, "short")}
              </span>
              <span className="num text-[1.1875rem] leading-tight font-medium">{dayNumber(d)}</span>
              <span
                aria-hidden
                className={`size-1 rounded-full ${count ? (isSel ? "bg-ink" : "bg-night-ink-2") : "bg-transparent"}`}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
