import { addDays } from "@shared/time";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { IconButton } from "../../components/ui/button";
import { plural, useFormat } from "../../lib/format";
import {
  addMonths,
  dayNumber,
  monthGrid,
  monthOf,
  orderedWeekdays,
  startOfWeek,
  weekdayName,
} from "./dates";

/**
 * Month calendar for the black command panel: lime selected day, a ring on today, and a dot on
 * days that have sessions. Arrow keys move between days, Page Up/Down between months.
 */
export function MiniCalendar({
  month,
  onMonthChange,
  selected,
  today,
  counts,
  onSelect,
}: {
  month: string;
  onMonthChange: (ym: string) => void;
  selected: string;
  today: string;
  counts: Map<string, number>;
  onSelect: (day: string) => void;
}) {
  const fmt = useFormat();
  const days = monthGrid(month, fmt.weekStartsOn);
  const weeks = Array.from({ length: 6 }, (_, i) => days.slice(i * 7, i * 7 + 7));
  const [focused, setFocused] = useState(selected);
  const tableRef = useRef<HTMLTableElement>(null);
  const moved = useRef(false);

  useEffect(() => setFocused(selected), [selected]);

  // Keyboard moves can leave the visible month: follow them, then focus the new day.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs only after keyboard moves.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    if (monthOf(focused) !== month) onMonthChange(monthOf(focused));
    requestAnimationFrame(() =>
      tableRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus(),
    );
  }, [focused]);

  const inMonth = (d: string) => monthOf(d) === month;
  const tabbable = inMonth(focused)
    ? focused
    : inMonth(selected)
      ? selected
      : inMonth(today)
        ? today
        : `${month}-01`;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, day: string) => {
    const weekStart = startOfWeek(day, fmt.weekStartsOn);
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(day, -1),
      ArrowRight: () => addDays(day, 1),
      ArrowUp: () => addDays(day, -7),
      ArrowDown: () => addDays(day, 7),
      Home: () => weekStart,
      End: () => addDays(weekStart, 6),
      PageUp: () => shiftMonth(day, -1),
      PageDown: () => shiftMonth(day, 1),
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    moved.current = true;
    setFocused(move());
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-1">
        <h2
          id="schedule-month"
          className="text-[1.75rem] leading-tight font-light tracking-[-0.01em]"
          aria-live="polite"
        >
          {fmt.month(month)}
        </h2>
        <div className="flex gap-1.5">
          <IconButton
            label="Previous month"
            variant="night"
            size="sm"
            onPress={() => onMonthChange(addMonths(month, -1))}
          >
            <ChevronLeft aria-hidden className="size-4.5" />
          </IconButton>
          <IconButton
            label="Next month"
            variant="night"
            size="sm"
            onPress={() => onMonthChange(addMonths(month, 1))}
          >
            <ChevronRight aria-hidden className="size-4.5" />
          </IconButton>
        </div>
      </div>
      <table ref={tableRef} aria-labelledby="schedule-month" className="mt-3 w-full table-fixed">
        <thead>
          <tr>
            {orderedWeekdays(fmt.weekStartsOn).map((d) => (
              <th
                key={d}
                scope="col"
                abbr={weekdayName(d, fmt.locale, "long")}
                className="pb-1 text-center text-[0.75rem] font-normal text-night-ink-2"
              >
                {weekdayName(d, fmt.locale, "short").slice(0, 2)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((d) => {
                const count = counts.get(d) ?? 0;
                const isSel = d === selected;
                const isToday = d === today;
                return (
                  <td key={d} className="p-0 text-center">
                    <button
                      type="button"
                      data-day={d}
                      tabIndex={d === tabbable ? 0 : -1}
                      onClick={() => onSelect(d)}
                      onKeyDown={(e) => onKeyDown(e, d)}
                      onFocus={() => setFocused(d)}
                      aria-pressed={isSel}
                      aria-current={isToday ? "date" : undefined}
                      aria-label={`${fmt.longDay(d)}${isToday ? ", today" : ""}, ${count ? plural(count, "session") : "no sessions"}`}
                      className={`relative mx-auto flex h-11 w-full max-w-11 cursor-pointer items-center justify-center rounded-full text-[0.875rem] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-lime ${
                        isSel
                          ? "bg-lime font-semibold text-ink"
                          : inMonth(d)
                            ? "text-night-ink hover:bg-night-3"
                            : "text-night-ink-2 hover:bg-night-3"
                      } ${isToday && !isSel ? "ring-[1.5px] ring-night-ink ring-inset" : ""}`}
                    >
                      <span className="num">{dayNumber(d)}</span>
                      {count ? (
                        <span
                          aria-hidden
                          className={`absolute bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full ${isSel ? "bg-ink" : "bg-night-ink-2"}`}
                        />
                      ) : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Same day of the month in the next/previous month, clamped to that month's length. */
function shiftMonth(day: string, delta: number): string {
  const ym = addMonths(monthOf(day), delta);
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y ?? 1970, m ?? 1, 0)).getUTCDate();
  const d = Math.min(dayNumber(day), last);
  return `${ym}-${String(d).padStart(2, "0")}`;
}
