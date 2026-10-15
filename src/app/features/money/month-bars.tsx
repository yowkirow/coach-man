import type { MoneySummaryDto } from "@shared/api-types";
import type { Format } from "../../lib/format";
import { compactMoney, monthLabel } from "./money-data";

const BAR_AREA = 168;

/** Rounds a maximum up to a readable axis value (1, 2, 2.5, 5 × 10ⁿ). */
function niceCeil(value: number): number {
  if (value <= 0) return 0;
  const exp = 10 ** Math.floor(Math.log10(value));
  const f = value / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * exp;
}

/**
 * Six months of received (solid ink) against charged (ink outline) on one fixed scale.
 * Each month is a button that opens that month, so every bar leads to its payments.
 */
export function MonthBars({
  months,
  selected,
  onSelect,
  fmt,
}: {
  months: MoneySummaryDto["months"];
  selected: string;
  onSelect: (month: string) => void;
  fmt: Format;
}) {
  const top = niceCeil(Math.max(0, ...months.flatMap((m) => [m.receivedMinor, m.chargedMinor])));
  const pct = (v: number) => (top > 0 ? Math.max(0, Math.min(100, (v / top) * 100)) : 0);
  const first = months[0]?.month;
  const last = months.at(-1)?.month;
  const ticks = top > 0 ? [top, top / 2, 0] : [0];

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="sr-only">
        Received and charged by month
        {first && last
          ? `, ${monthLabel(first, fmt.locale)} to ${fmt.month(last)}. Choose a month to open it.`
          : ""}
      </figcaption>
      <div className="relative">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0">
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute inset-x-0 flex -translate-y-1/2 items-center gap-2"
              style={{ top: `${BAR_AREA - (top > 0 ? (t / top) * BAR_AREA : 0)}px` }}
            >
              <span className="num w-11 shrink-0 text-right text-[0.6875rem] text-ink/70">
                {t === 0 ? "0" : compactMoney(t, fmt)}
              </span>
              <span
                className={`h-0 flex-1 border-t ${t === 0 ? "border-ink/25" : "border-dashed border-ink/15"}`}
              />
            </div>
          ))}
        </div>
        <ol className="relative grid grid-cols-6 gap-1 pl-[3.25rem]">
          {months.map((m) => {
            const isSelected = m.month === selected;
            const label = `${fmt.month(m.month)}: ${fmt.money(m.receivedMinor)} received, ${fmt.money(m.chargedMinor)} charged`;
            return (
              <li key={m.month} className="flex">
                <button
                  type="button"
                  aria-label={label}
                  aria-current={isSelected ? "true" : undefined}
                  onClick={() => onSelect(m.month)}
                  className={`group flex w-full cursor-pointer flex-col items-center rounded-[18px] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-ink ${isSelected ? "bg-white/45" : "hover:bg-white/25"}`}
                >
                  <span
                    aria-hidden
                    className="flex w-full items-end justify-center gap-1.5"
                    style={{ height: `${BAR_AREA}px` }}
                  >
                    <span
                      className="w-3 rounded-full bg-ink transition-[height] duration-300 ease-out sm:w-3.5"
                      style={{
                        height: m.receivedMinor > 0 ? `max(4px, ${pct(m.receivedMinor)}%)` : "2px",
                        opacity: m.receivedMinor > 0 ? 1 : 0.25,
                      }}
                    />
                    <span
                      className="w-3 rounded-full border-[1.5px] border-ink transition-[height] duration-300 ease-out sm:w-3.5"
                      style={{
                        height: m.chargedMinor > 0 ? `max(6px, ${pct(m.chargedMinor)}%)` : "2px",
                        opacity: m.chargedMinor > 0 ? 1 : 0.25,
                      }}
                    />
                  </span>
                  <span
                    aria-hidden
                    className={`py-2 text-[0.8125rem] ${isSelected ? "font-semibold text-ink" : "text-ink/75"}`}
                  >
                    {monthLabel(m.month, fmt.locale, "short")}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <div aria-hidden className="flex flex-wrap items-center gap-x-5 gap-y-1 pl-[3.25rem]">
        <span className="flex items-center gap-2 text-[0.8125rem]">
          <span className="h-3 w-3 rounded-full bg-ink" /> Received
        </span>
        <span className="flex items-center gap-2 text-[0.8125rem]">
          <span className="h-3 w-3 rounded-full border-[1.5px] border-ink" /> Charged
        </span>
      </div>
    </figure>
  );
}
