import type { RateDto } from "@shared/api-types";
import { RATE_KINDS, type RateKind, type RateUnit } from "@shared/domain";
import { rateSchema } from "@shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { InlineError } from "../../components/ui/feedback";
import { MoneyField, Segmented, SelectField, Switch, TextField } from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { useFormat } from "../../lib/format";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { OfflineNote } from "../settings/offline";
import { changedFields, issuesToFields, wholeNumber } from "../settings/validation";
import { RATE_KIND_LABELS, RATE_KIND_SINGULAR, rateCounterpart } from "./catalog";

const FRIENDLY: Record<string, string> = {
  name: "Give the rate a name.",
  kind: "Choose what the rate is for.",
  durationMinutes: "Use 15 to 600 minutes.",
  priceMinor: "Enter a price (0 is fine for free sessions).",
  unit: "Choose per session or per hour.",
};

const UNITS: { id: RateUnit; label: string }[] = [
  { id: "session", label: "Per session" },
  { id: "hour", label: "Per hour" },
];

/** Creates a rate, or edits one by sending only the fields that changed. */
export function RateSheet({
  isOpen,
  onOpenChange,
  rate,
  defaultKind = "private",
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this rate; omit to create a new one. */
  rate?: RateDto | null;
  defaultKind?: RateKind;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<RateKind>(defaultKind);
  const [duration, setDuration] = useState("60");
  const [price, setPrice] = useState<number | null>(null);
  const [unit, setUnit] = useState<RateUnit>("session");
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<RateDto | null>(rate ?? null);
  const editing = isOpen ? (rate ?? null) : shown;

  const save = useMutation({
    meta: { silent: true },
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? api.patch<RateDto>(`/rates/${editing.id}`, body)
        : api.post<RateDto>("/rates", body),
    onSuccess: (saved) => {
      // Sessions on this rate price from it live, so their cached prices change too.
      for (const key of [keys.rates, keys.today, ["lessons"], ["lesson"]])
        void qc.invalidateQueries({ queryKey: key });
      notify({
        tone: "success",
        title: editing ? `${saved.name} saved` : `${saved.name} added to your rate card`,
      });
      onOpenChange(false);
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when the sheet opens.
  useEffect(() => {
    if (!isOpen) return;
    const r = rate ?? null;
    setShown(r);
    setName(r?.name ?? "");
    setKind(r?.kind ?? defaultKind);
    setDuration(String(r?.durationMinutes ?? 60));
    setPrice(r ? r.priceMinor : null);
    setUnit(r?.unit ?? "session");
    setActive(r?.active ?? true);
    setErrors({});
    save.reset();
  }, [isOpen]);

  const minutes = wholeNumber(duration);
  const hint =
    price !== null && minutes && minutes >= 15
      ? rateCounterpart(
          {
            id: "",
            name,
            kind,
            durationMinutes: minutes,
            priceMinor: price,
            unit,
            active,
          },
          fmt,
        )
      : null;

  const submit = () => {
    const parsed = rateSchema.safeParse({
      name: name.trim() ? name : RATE_KIND_SINGULAR[kind],
      kind,
      durationMinutes: minutes ?? Number.NaN,
      priceMinor: price ?? Number.NaN,
      unit,
      active,
    });
    if (!parsed.success) {
      setErrors(issuesToFields(parsed.error.issues, FRIENDLY));
      return;
    }
    setErrors({});
    if (!editing) {
      save.mutate(parsed.data);
      return;
    }
    const patch = changedFields(parsed.data, editing);
    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }
    save.mutate(patch);
  };

  const server = fieldErrors(save.error);
  const err = (k: string) => errors[k] ?? server[k];

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={editing ? "Edit rate" : "New rate"}
      description={
        editing
          ? "Sessions on this rate use the new price from now on. Anything already charged keeps its amount."
          : "What a session costs when it isn't paid with package credits."
      }
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="dark" isDisabled={!online} isPending={save.isPending} onPress={submit}>
            {editing ? "Save rate" : "Add rate"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (online) submit();
        }}
      >
        <SelectField
          label="For"
          options={RATE_KINDS.map((k) => ({ id: k, label: RATE_KIND_LABELS[k] }))}
          value={kind}
          onChange={(v) => setKind(v as RateKind)}
          error={err("kind")}
        />
        <TextField
          label="Name"
          value={name}
          onChange={setName}
          placeholder={RATE_KIND_SINGULAR[kind]}
          autoFocus={!editing}
          error={err("name")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            label="Price"
            currency={fmt.currency}
            valueMinor={price}
            onChange={setPrice}
            description={hint ?? undefined}
            error={err("priceMinor")}
          />
          <TextField
            label="Length (minutes)"
            type="number"
            inputMode="numeric"
            min="15"
            max="600"
            step="5"
            value={duration}
            onChange={setDuration}
            error={err("durationMinutes")}
          />
        </div>
        <Segmented
          label="Charged"
          options={UNITS}
          value={unit}
          onChange={(v) => setUnit(v as RateUnit)}
        />
        <div className="rounded-[22px] bg-panel px-4 py-2">
          <Switch
            isSelected={active}
            onChange={setActive}
            description={
              active
                ? "Offered when you schedule sessions."
                : "Kept for past sessions but not offered for new ones."
            }
          >
            On the rate card
          </Switch>
        </div>
        {save.error ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
        <OfflineNote />
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
