import type { PackageTemplateDto } from "@shared/api-types";
import { LESSON_KINDS, type LessonKind, type ValidityMode } from "@shared/domain";
import { packageTemplateSchema } from "@shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { InlineError } from "../../components/ui/feedback";
import {
  Checkbox,
  MoneyField,
  Segmented,
  SelectField,
  Switch,
  TextAreaField,
  TextField,
} from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { plural, useFormat } from "../../lib/format";
import { useCoaches, useGroups, useHasTeam } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { MONTH_END_NOTE } from "../public/text";
import { TierCard } from "../public/tier-card";
import { OfflineNote } from "../settings/offline";
import { changedFields, issuesToFields, wholeNumber } from "../settings/validation";
import { orderedKinds, perCredit, SESSION_TYPE_LABELS, tierPreview } from "./catalog";
import { InclusionsEditor } from "./inclusions-editor";

const FRIENDLY: Record<string, string> = {
  name: "Give the package a name.",
  credits: "Use a whole number from 1 to 500.",
  priceMinor: "Enter a price (0 is fine for a free package).",
  validityDays: "Use a whole number of days, or leave it empty for no expiry.",
  description: "Keep the description under 500 characters.",
  sessionsLabel: "Keep the sessions label under 40 characters.",
  inclusions: "Up to 20 lines of 120 characters each.",
  audience: "Keep “Who it's for” under 300 characters.",
  commitmentNote: "Keep the commitment note under 200 characters.",
};

interface Draft {
  name: string;
  credits: string;
  price: number | null;
  validity: string;
  validityMode: ValidityMode;
  kinds: LessonKind[];
  description: string;
  active: boolean;
  programId: string;
  coachUserId: string;
  sessionsLabel: string;
  inclusions: string[];
  audience: string;
  commitmentNote: string;
  includesUniform: boolean;
  asksSelfRating: boolean;
  isPublic: boolean;
  highlight: boolean;
}

function draftOf(t: PackageTemplateDto | null): Draft {
  return {
    name: t?.name ?? "",
    credits: t ? String(t.credits) : "10",
    price: t ? t.priceMinor : null,
    validity: t?.validityDays ? String(t.validityDays) : t ? "" : "90",
    validityMode: t?.validityMode ?? "days",
    kinds: t ? orderedKinds(t.lessonKinds) : [],
    description: t?.description ?? "",
    active: t?.active ?? true,
    programId: t?.programId ?? "none",
    coachUserId: t?.coachUserId ?? "none",
    sessionsLabel: t?.sessionsLabel ?? "",
    inclusions: t?.inclusions ?? [],
    audience: t?.audience ?? "",
    commitmentNote: t?.commitmentNote ?? "",
    includesUniform: t?.includesUniform ?? false,
    asksSelfRating: t?.asksSelfRating ?? false,
    isPublic: t?.isPublic ?? false,
    highlight: t?.highlight ?? false,
  };
}

function SectionTitle({ children, hint }: { children: string; hint?: string }) {
  return (
    <div className="border-t border-line pt-5">
      <h3 className="text-[1.125rem] font-medium">{children}</h3>
      {hint ? <p className="mt-0.5 text-[0.8125rem] text-ink-2">{hint}</p> : null}
    </div>
  );
}

/**
 * Creates a package template, or edits one by sending only the fields that changed. A package is
 * also a tier on the academy's rates sheet: its program, sessions label, validity, inclusions,
 * and who it's for, with a live preview of the card families see.
 */
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
  const groups = useGroups();
  const coaches = useCoaches();
  const hasTeam = useHasTeam();
  const [d, setDraft] = useState<Draft>(() => draftOf(null));
  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));
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
      void qc.invalidateQueries({ queryKey: keys.publicPreview });
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
    setDraft(draftOf(t));
    setErrors({});
    save.reset();
  }, [isOpen]);

  const monthEnd = d.validityMode === "month_end";
  const creditsN = wholeNumber(d.credits);
  const perCreditText =
    d.price !== null && creditsN && creditsN > 0 && Number.isInteger(creditsN)
      ? `${fmt.money(perCredit({ priceMinor: d.price, credits: creditsN }))} per credit`
      : undefined;

  // Programs that aren't archived, plus the tier's own program if it was archived since.
  const programs = (groups.data ?? []).filter((g) => g.archivedAt === null);
  const programOptions = [
    { id: "none", label: "No program", description: "Listed under “Other packages”" },
    ...programs.map((g) => ({
      id: g.id,
      label: g.name,
      description: g.isPublic ? "On the academy page" : "Not on the academy page",
    })),
    ...(d.programId !== "none" && !programs.some((g) => g.id === d.programId)
      ? [{ id: d.programId, label: "Current program (archived)" }]
      : []),
  ];
  const coachOptions = [
    { id: "none", label: "Any coach" },
    ...(coaches.data ?? []).map((c) => ({
      id: c.userId,
      label: c.name,
      description: c.title ?? undefined,
    })),
    ...(d.coachUserId !== "none" && !(coaches.data ?? []).some((c) => c.userId === d.coachUserId)
      ? [{ id: d.coachUserId, label: "Former coach" }]
      : []),
  ];
  const program = programs.find((g) => g.id === d.programId);

  const body = () => ({
    name: d.name,
    credits: creditsN ?? Number.NaN,
    priceMinor: d.price ?? Number.NaN,
    validityDays: monthEnd ? null : wholeNumber(d.validity),
    lessonKinds: orderedKinds(d.kinds),
    description: d.description,
    active: d.active,
    programId: d.programId === "none" ? null : d.programId,
    coachUserId: d.coachUserId === "none" ? null : d.coachUserId,
    sessionsLabel: d.sessionsLabel,
    validityMode: d.validityMode,
    inclusions: d.inclusions.map((i) => i.trim()).filter(Boolean),
    audience: d.audience,
    commitmentNote: d.commitmentNote,
    includesUniform: d.includesUniform,
    asksSelfRating: d.asksSelfRating,
    isPublic: d.isPublic,
    highlight: d.highlight,
  });

  const submit = () => {
    const parsed = packageTemplateSchema.safeParse(body());
    if (!parsed.success) {
      setErrors(issuesToFields(parsed.error.issues, FRIENDLY));
      return;
    }
    setErrors({});
    const next = { ...parsed.data, validityDays: parsed.data.validityDays ?? null };
    if (!editing) {
      save.mutate(next);
      return;
    }
    const patch = changedFields(next, {
      name: editing.name,
      credits: editing.credits,
      priceMinor: editing.priceMinor,
      validityDays: editing.validityDays,
      lessonKinds: orderedKinds(editing.lessonKinds),
      description: editing.description,
      active: editing.active,
      programId: editing.programId ?? null,
      coachUserId: editing.coachUserId ?? null,
      sessionsLabel: editing.sessionsLabel ?? null,
      validityMode: editing.validityMode ?? "days",
      inclusions: editing.inclusions ?? [],
      audience: editing.audience ?? null,
      commitmentNote: editing.commitmentNote ?? null,
      includesUniform: editing.includesUniform ?? false,
      asksSelfRating: editing.asksSelfRating ?? false,
      isPublic: editing.isPublic ?? false,
      highlight: editing.highlight ?? false,
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
    set({ kinds: on ? orderedKinds([...d.kinds, k]) : d.kinds.filter((x) => x !== k) });

  const coach = (coaches.data ?? []).find((c) => c.userId === d.coachUserId);
  const preview = tierPreview(
    {
      id: editing?.id ?? "new",
      name: d.name.trim() || "New package",
      credits: creditsN && creditsN > 0 ? creditsN : 1,
      lessonKinds: d.kinds,
      priceMinor: d.price ?? 0,
      validityDays: monthEnd ? null : wholeNumber(d.validity),
      description: null,
      active: d.active,
      soldCount: 0,
      sessionsLabel: d.sessionsLabel.trim() || null,
      validityMode: d.validityMode,
      inclusions: d.inclusions.map((i) => i.trim()).filter(Boolean),
      audience: d.audience.trim() || null,
      commitmentNote: d.commitmentNote.trim() || null,
      includesUniform: d.includesUniform,
      asksSelfRating: d.asksSelfRating,
      highlight: d.highlight,
    },
    coach
      ? { id: coach.userId, name: coach.name, title: coach.title, photoKey: null, lead: false }
      : null,
  );
  const publicNote = !d.isPublic
    ? "Only your team sees it."
    : !d.active
      ? "Shows once it's for sale again."
      : program && !program.isPublic
        ? `Shows once ${program.name} is on the academy page.`
        : "Families see it on your academy page and rates sheet.";

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="lg"
      title={editing ? "Edit package" : "New package"}
      description={
        editing
          ? editing.soldCount > 0
            ? `Changes apply to future sales. The ${plural(editing.soldCount, "client package")} already sold keep their credits and expiry.`
            : "Not sold yet, so changes apply everywhere."
          : "Credits that clients buy up front and use at check-in, and a tier on your rates sheet."
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
          value={d.name}
          onChange={(name) => set({ name })}
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
            value={d.credits}
            onChange={(credits) => set({ credits })}
            description={
              d.sessionsLabel.trim()
                ? "The most sessions it covers. One credit is one session."
                : "One credit covers one session."
            }
            error={err("credits")}
          />
          <MoneyField
            label="Price"
            currency={fmt.currency}
            valueMinor={d.price}
            onChange={(price) => set({ price })}
            description={perCreditText}
            error={err("priceMinor")}
          />
        </div>
        <Segmented
          label="Valid"
          value={d.validityMode}
          onChange={(v) => set({ validityMode: v as ValidityMode })}
          options={[
            { id: "days", label: "Number of days" },
            { id: "month_end", label: "To month end" },
          ]}
        />
        {monthEnd ? (
          <p className="-mt-2 rounded-[18px] bg-panel px-4 py-3 text-[0.875rem] text-ink-2">
            When you sell it, pick this month or next: it covers sessions from the 1st and runs out
            on the last day of that month, whatever day it's bought. Families read “{MONTH_END_NOTE}
            ”
          </p>
        ) : (
          <TextField
            label="Valid for (days)"
            type="number"
            inputMode="numeric"
            min="1"
            max="3650"
            value={d.validity}
            onChange={(validity) => set({ validity })}
            placeholder="No expiry"
            description="Counted from the day it starts. Leave empty and it never expires."
            error={err("validityDays")}
            className="-mt-2"
          />
        )}
        <fieldset className="flex flex-col gap-1">
          <legend className="text-[0.8125rem] font-medium text-ink-2">Covers</legend>
          <p className="mb-1 text-[0.8125rem] text-ink-2">
            {d.kinds.length
              ? "Only these session types use its credits."
              : "Any session type. Tick types to limit it."}
          </p>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {LESSON_KINDS.map((k) => (
              <Checkbox
                key={k}
                isSelected={d.kinds.includes(k)}
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
          label="Description (optional, for your team)"
          value={d.description}
          onChange={(description) => set({ description })}
          rows={2}
          placeholder="Weekday group classes, juniors welcome…"
          error={err("description")}
        />
        <div className="rounded-[22px] bg-panel px-4 py-2">
          <Switch
            isSelected={d.active}
            onChange={(active) => set({ active })}
            description={
              d.active
                ? "Shows up when you sell a package."
                : "Hidden from Sell a package. Clients keep any credits they bought."
            }
          >
            For sale
          </Switch>
        </div>

        <SectionTitle hint="How this package reads as a tier on your rates sheet.">
          Rates sheet
        </SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Program"
            options={programOptions}
            value={d.programId}
            onChange={(programId) => set({ programId })}
            error={err("programId")}
          />
          {hasTeam ? (
            <SelectField
              label="Coach"
              options={coachOptions}
              value={d.coachUserId}
              onChange={(coachUserId) => set({ coachUserId })}
              description="For a tier with one coach."
              error={err("coachUserId")}
            />
          ) : null}
        </div>
        <TextField
          label="Sessions label (optional)"
          value={d.sessionsLabel}
          onChange={(sessionsLabel) => set({ sessionsLabel })}
          placeholder="e.g. 4–6 sessions"
          description={
            creditsN && creditsN > 0
              ? `Shown instead of “${plural(creditsN, "session")}”. Credits stay the most it covers.`
              : "Shown instead of the number of sessions."
          }
          error={err("sessionsLabel")}
        />
        <InclusionsEditor
          items={d.inclusions}
          onChange={(inclusions) => set({ inclusions })}
          error={err("inclusions")}
        />
        <TextAreaField
          label="Who it's for (optional)"
          value={d.audience}
          onChange={(audience) => set({ audience })}
          rows={2}
          placeholder="e.g. Players preparing for a tournament"
          error={err("audience")}
        />
        <TextField
          label="Commitment note (optional)"
          value={d.commitmentNote}
          onChange={(commitmentNote) => set({ commitmentNote })}
          placeholder="e.g. Best over at least 2 months"
          error={err("commitmentNote")}
        />
        <div className="flex flex-col divide-y divide-line rounded-[22px] bg-panel px-4 py-1">
          <Switch
            isSelected={d.includesUniform}
            onChange={(includesUniform) => set({ includesUniform })}
            description="You record each player's size and when it's handed out."
          >
            Includes the training uniform
          </Switch>
          <Switch
            isSelected={d.asksSelfRating}
            onChange={(asksSelfRating) => set({ asksSelfRating })}
            description="Enrolling asks players to rate their own level. It's saved to their rating history as a self-rating."
          >
            Asks for a self-rating
          </Switch>
        </div>

        <SectionTitle>Academy page</SectionTitle>
        <div className="-mt-2 flex flex-col divide-y divide-line rounded-[22px] bg-panel px-4 py-1">
          <Switch
            isSelected={d.isPublic}
            onChange={(isPublic) => set({ isPublic })}
            description={publicNote}
          >
            Show on the academy page
          </Switch>
          <Switch
            isSelected={d.highlight}
            onChange={(highlight) => set({ highlight })}
            description="The featured tier stands out on the page."
          >
            Featured
          </Switch>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-[0.8125rem] font-medium text-ink-2">Preview</p>
          <div className="rounded-[28px] bg-canvas p-2 sm:p-3">
            <TierCard tier={preview} fmt={fmt} headingLevel={4} />
          </div>
        </div>

        {save.error ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
        <OfflineNote />
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
