import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Button, IconButton } from "./button";
import { fieldClass } from "./field";

/**
 * An ordered list of short lines (a tier's inclusions, a coach's highlights), in the order people
 * read them: edit any line in place, move it up or down, remove it, or type one and press Enter
 * (or Add) to put it at the end. Commas are part of a line, never a separator.
 */
export function LinesEditor({
  label,
  description,
  items,
  onChange,
  max,
  maxLength = 120,
  icon,
  listLabel,
  itemLabel,
  addLabel,
  placeholder,
  error,
}: {
  /** The list's name (its legend). */
  label: string;
  description?: ReactNode;
  items: string[];
  onChange: (next: string[]) => void;
  max: number;
  maxLength?: number;
  /** Shown at the start of every line (decorative). */
  icon?: ReactNode;
  /** The list's accessible name. */
  listLabel: string;
  /** A line's accessible name, from its position (0-based). */
  itemLabel: (index: number) => string;
  /** The add field's accessible name. */
  addLabel: string;
  placeholder?: string;
  error?: string;
}) {
  const [draft, setDraft] = useState("");
  const addId = useId();
  const full = items.length >= max;
  const add = () => {
    const text = draft.trim();
    if (!text || full) return;
    onChange([...items, text]);
    setDraft("");
  };
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j] as string, next[i] as string];
    onChange(next);
  };
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="text-[0.8125rem] font-medium text-ink-2">{label}</legend>
      {description ? <p className="-mt-1 text-[0.8125rem] text-ink-2">{description}</p> : null}
      {items.length ? (
        <ol aria-label={listLabel} className="flex flex-col gap-1.5">
          {items.map((item, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are edited in place; the index is the line.
              key={i}
              className="flex items-center gap-1 rounded-[18px] bg-panel py-0.5 pr-0.5 pl-3"
            >
              {icon}
              <input
                aria-label={itemLabel(i)}
                value={item}
                maxLength={maxLength}
                onChange={(e) => onChange(items.map((x, k) => (k === i ? e.target.value : x)))}
                className="h-11 min-w-0 flex-1 rounded-xl bg-transparent px-2 text-[0.9375rem] text-ink outline-none focus-visible:bg-card focus-visible:outline-2 focus-visible:outline-ink"
              />
              <IconButton
                size="sm"
                label={`Move “${item || `line ${i + 1}`}” up`}
                isDisabled={i === 0}
                onPress={() => move(i, -1)}
              >
                <ArrowUp aria-hidden className="size-4.5" />
              </IconButton>
              <IconButton
                size="sm"
                label={`Move “${item || `line ${i + 1}`}” down`}
                isDisabled={i === items.length - 1}
                onPress={() => move(i, 1)}
              >
                <ArrowDown aria-hidden className="size-4.5" />
              </IconButton>
              <IconButton
                size="sm"
                label={`Remove “${item || `line ${i + 1}`}”`}
                onPress={() => onChange(items.filter((_, k) => k !== i))}
              >
                <X aria-hidden className="size-4.5" />
              </IconButton>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="flex items-start gap-2">
        <label htmlFor={addId} className="sr-only">
          {addLabel}
        </label>
        <input
          id={addId}
          value={draft}
          maxLength={maxLength}
          disabled={full}
          placeholder={full ? `Up to ${max} lines` : placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            add();
          }}
          className={`${fieldClass} min-w-0 flex-1`}
        />
        <Button
          variant="light"
          icon={<Plus aria-hidden className="size-4.5" />}
          isDisabled={!draft.trim() || full}
          onPress={add}
        >
          Add
        </Button>
      </div>
      {error ? <p className="text-[0.8125rem] font-medium text-[#b42318]">{error}</p> : null}
    </fieldset>
  );
}
