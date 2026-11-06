import { Check } from "lucide-react";
import { LinesEditor } from "../../components/ui/lines-editor";

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
  return (
    <LinesEditor
      label="What's included"
      description="The checklist on the tier card, top to bottom. Court fees, coaching, game analysis…"
      items={items}
      onChange={onChange}
      max={MAX_INCLUSIONS}
      icon={<Check aria-hidden className="size-4 shrink-0" strokeWidth={2.75} />}
      listLabel="Inclusions"
      itemLabel={(i) => `Inclusion ${i + 1}`}
      addLabel="Add an inclusion"
      placeholder="e.g. 3 hours court fee included"
      error={error}
    />
  );
}
