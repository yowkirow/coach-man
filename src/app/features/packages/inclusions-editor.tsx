import { ArrowDown, ArrowUp, Check, Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { Button, IconButton } from "../../components/ui/button";
import { fieldClass } from "../../components/ui/field";

export const MAX_INCLUSIONS = 20;

/**
 * The tier's "what's included" checklist, in the order families read it: edit any line in place,
 * move it up or down, remove it, or add one at the end.
 */
export function InclusionsEditor({
  items,
  onChange,
  error,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  error?: string;
}) {
  const [draft, setDraft] = useState("");
  const addId = useId();
  const full = items.length >= MAX_INCLUSIONS;
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
      <legend className="text-[0.8125rem] font-medium text-ink-2">What's included</legend>
      <p className="-mt-1 text-[0.8125rem] text-ink-2">
        The checklist on the tier card, top to bottom. Court fees, coaching, game analysis…
      </p>
      {items.length ? (
        <ol aria-label="Inclusions" className="flex flex-col gap-1.5">
          {items.map((item, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are edited in place; the index is the line.
              key={i}
              className="flex items-center gap-1 rounded-[18px] bg-panel py-0.5 pr-0.5 pl-3"
            >
              <Check aria-hidden className="size-4 shrink-0" strokeWidth={2.75} />
              <input
                aria-label={`Inclusion ${i + 1}`}
                value={item}
                maxLength={120}
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
          Add an inclusion
        </label>
        <input
          id={addId}
          value={draft}
          maxLength={120}
          disabled={full}
          placeholder={full ? `Up to ${MAX_INCLUSIONS} lines` : "e.g. 3 hours court fee included"}
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
