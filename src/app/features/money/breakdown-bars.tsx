import { Check } from "lucide-react";
import type { Format } from "../../lib/format";

export interface BreakdownItem {
  id: string;
  label: string;
  amountMinor: number;
}

/**
 * Horizontal bars on one scale (the largest item fills the track). Rows are filter toggles for
 * the list they summarise, so each amount leads to the lines behind it.
 */
export function BreakdownBars({
  items,
  fmt,
  selectedId,
  onSelect,
  surface = "card",
  filterHint,
}: {
  items: BreakdownItem[];
  fmt: Format;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  surface?: "card" | "lime";
  /** Accessible verb phrase, e.g. "Show only these payments". */
  filterHint: string;
}) {
  const max = Math.max(0, ...items.map((i) => Math.abs(i.amountMinor)));
  const total = items.reduce((s, i) => s + i.amountMinor, 0);
  const track = surface === "lime" ? "bg-white/50" : "bg-ink/8";
  const hover = surface === "lime" ? "hover:bg-white/35" : "hover:bg-panel";
  const active = surface === "lime" ? "bg-white/55" : "bg-panel";
  return (
    <ul className="-mx-2 flex flex-col gap-0.5">
      {items.map((item) => {
        const share = total > 0 && item.amountMinor > 0 ? item.amountMinor / total : null;
        const width = max > 0 ? (Math.abs(item.amountMinor) / max) * 100 : 0;
        const isSelected = selectedId === item.id;
        return (
          <li key={item.id}>
            <button
              type="button"
              aria-pressed={isSelected}
              title={filterHint}
              onClick={() => onSelect(isSelected ? null : item.id)}
              className={`flex w-full cursor-pointer flex-col gap-2 rounded-2xl px-2 py-2.5 text-left outline-none transition-colors focus-visible:outline-2 focus-visible:outline-ink ${isSelected ? active : hover}`}
            >
              <span className="flex w-full items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5 font-medium">
                  {isSelected ? (
                    <Check aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
                  ) : null}
                  <span className="truncate">{item.label}</span>
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  {share !== null ? (
                    <span className="num text-[0.75rem] text-ink-2">
                      {Math.round(share * 100)}%
                    </span>
                  ) : null}
                  <span className="num">{fmt.money(item.amountMinor)}</span>
                </span>
              </span>
              <span
                aria-hidden
                className={`block h-2 w-full overflow-hidden rounded-full ${track}`}
              >
                <span
                  className={`block h-full rounded-full transition-[width] duration-300 ease-out ${item.amountMinor < 0 ? "bg-coral" : "bg-ink"}`}
                  style={{ width: `${width}%` }}
                />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
