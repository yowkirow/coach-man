import type { PackageTemplateDto } from "@shared/api-types";
import { LESSON_KINDS, type LessonKind } from "@shared/domain";
import { packageTemplateSchema } from "@shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { InlineError } from "../../components/ui/feedback";
import { Checkbox, MoneyField, Switch, TextAreaField, TextField } from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { plural, useFormat } from "../../lib/format";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { OfflineNote } from "../settings/offline";
import { changedFields, issuesToFields, wholeNumber } from "../settings/validation";
import { orderedKinds, perCredit, SESSION_TYPE_LABELS } from "./catalog";

const FRIENDLY: Record<string, string> = {
  name: "Give the package a name.",
  credits: "Use a whole number from 1 to 500.",
  priceMinor: "Enter a price (0 is fine for a free package).",
  validityDays: "Use a whole number of days, or leave it empty for no expiry.",
  description: "Keep the description under 500 characters.",
};

/** Creates a package template, or edits one by sending only the fields that changed. */
export function PackageTemplateSheet({
  isOpen,
  onOpenChange,
  template,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this template; omit to create a new one. */
  template?: PackageTemplateDto | null;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [credits, setCredits] = useState("");
  const [price, setPrice] = useState<number | null>(null);
  const [validity, setValidity] = useState("");
  const [kinds, setKinds] = useState<LessonKind[]>([]);
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Keep the last template while the sheet animates closed.
  const [shown, setShown] = useState<PackageTemplateDto | null>(template ?? null);
  const editing = isOpen ? (template ?? null) : shown;

  const save = useMutation({
    meta: { silent: true },
    mutationFn: async (body: Record<string, unknown>) =>
      editing
        ? api.patch<PackageTemplateDto>(`/packages/${editing.id}`, body)
        : api.post<PackageTemplateDto>("/packages", body),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: keys.packages });
      notify({
        tone: "success",
        title: editing ? `${saved.name} saved` : `${saved.name} created`,
        body: editing
          ? undefined
          : saved.active
            ? "It's ready to sell."
            : "It's saved but not for sale yet.",
      });
      onOpenChange(false);
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when the sheet opens.
  useEffect(() => {
    if (!isOpen) return;
    const t = template ?? null;
    setShown(t);
    setName(t?.name ?? "");
    setCredits(t ? String(t.credits) : "10");
    setPrice(t ? t.priceMinor : null);
    setValidity(t?.validityDays ? String(t.validityDays) : t ? "" : "90");
    setKinds(t ? orderedKinds(t.lessonKinds) : []);
    setDescription(t?.description ?? "");
    setActive(t?.active ?? true);
    setErrors({});
    save.reset();
  }, [isOpen]);

  const creditsN = wholeNumber(credits);
  const preview =
    price !== null && creditsN && creditsN > 0 && Number.isInteger(creditsN)
      ? `${fmt.money(perCredit({ priceMinor: price, credits: creditsN }))} per credit`
      : undefined;

  const submit = () => {
    const parsed = packageTemplateSchema.safeParse({
      name,
      credits: creditsN ?? Number.NaN,
      priceMinor: price ?? Number.NaN,
      validityDays: wholeNumber(validity),
      lessonKinds: orderedKinds(kinds),
      description,
      active,
    });
    if (!parsed.success) {
      setErrors(issuesToFields(parsed.error.issues, FRIENDLY));
      return;
    }
    setErrors({});
    const body = { ...parsed.data, validityDays: parsed.data.validityDays ?? null };
    if (!editing) {
      save.mutate(body);
      return;
    }
    const patch = changedFields(body, {
      name: editing.name,
      credits: editing.credits,
      priceMinor: editing.priceMinor,
      validityDays: editing.validityDays,
      lessonKinds: orderedKinds(editing.lessonKinds),
      description: editing.description,
      active: editing.active,
    });
    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }
    save.mutate(patch);
  };

  const server = fieldErrors(save.error);
  const err = (k: string) => errors[k] ?? server[k];
  const toggleKind = (k: LessonKind, on: boolean) =>
    setKinds((prev) => (on ? orderedKinds([...prev, k]) : prev.filter((x) => x !== k)));

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={editing ? "Edit package" : "New package"}
      description={
        editing
          ? editing.soldCount > 0
            ? `Changes apply to future sales. The ${plural(editing.soldCount, "client package")} already sold keep their credits and expiry.`
            : "Not sold yet, so changes apply everywhere."
          : "Credits that clients buy up front and use at check-in."
      }
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="dark" isDisabled={!online} isPending={save.isPending} onPress={submit}>
            {editing ? "Save package" : "Create package"}
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
        <TextField
          label="Name"
          value={name}
          onChange={setName}
          placeholder="10-session pack"
          autoFocus={!editing}
          error={err("name")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Credits"
            type="number"
            inputMode="numeric"
            min="1"
            max="500"
            value={credits}
            onChange={setCredits}
            description="One credit covers one session."
            error={err("credits")}
          />
          <MoneyField
            label="Price"
            currency={fmt.currency}
            valueMinor={price}
            onChange={setPrice}
            description={preview}
            error={err("priceMinor")}
          />
        </div>
        <TextField
          label="Valid for (days)"
          type="number"
          inputMode="numeric"
          min="1"
          max="3650"
          value={validity}
          onChange={setValidity}
          placeholder="No expiry"
          description="Counted from the day it starts. Leave empty and it never expires."
          error={err("validityDays")}
        />
        <fieldset className="flex flex-col gap-1">
          <legend className="text-[0.8125rem] font-medium text-ink-2">Covers</legend>
          <p className="mb-1 text-[0.8125rem] text-ink-2">
            {kinds.length
              ? "Only these session types use its credits."
              : "Any session type. Tick types to limit it."}
          </p>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {LESSON_KINDS.map((k) => (
              <Checkbox
                key={k}
                isSelected={kinds.includes(k)}
                onChange={(on) => toggleKind(k, on)}
                className="min-h-11"
              >
                {SESSION_TYPE_LABELS[k]}
              </Checkbox>
            ))}
          </div>
          {err("lessonKinds") ? (
            <p className="text-[0.8125rem] font-medium text-[#b42318]">{err("lessonKinds")}</p>
          ) : null}
        </fieldset>
        <TextAreaField
          label="Description (optional)"
          value={description}
          onChange={setDescription}
          rows={2}
          placeholder="Weekday group classes, juniors welcome…"
          error={err("description")}
        />
        <div className="rounded-[22px] bg-panel px-4 py-2">
          <Switch
            isSelected={active}
            onChange={setActive}
            description={
              active
                ? "Shows up when you sell a package."
                : "Hidden from Sell a package. Clients keep any credits they bought."
            }
          >
            For sale
          </Switch>
        </div>
        {save.error ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
        <OfflineNote />
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
