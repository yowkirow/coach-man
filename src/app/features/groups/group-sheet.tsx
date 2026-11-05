import type { GroupDto } from "@shared/api-types";
import { useMutation } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Label, Radio, RadioGroup } from "react-aria-components";
import { type CoachChoice, CoachFields } from "../../components/domain/coaches";
import { Button } from "../../components/ui/button";
import { InlineError } from "../../components/ui/feedback";
import { SelectField, TextAreaField, TextField } from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { plural, useFormat } from "../../lib/format";
import { useCan, useGroups, useHasTeam, useMe, useRates, useVenues } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { OfflineNote } from "../schedule/choice";
import { GROUP_COLORS, useInvalidateGroups } from "./queries";

/** Round colour swatches (radio group); a custom colour already on the group stays selectable. */
export function ColorSwatches({
  value,
  onChange,
  current,
}: {
  value: string;
  onChange: (hex: string) => void;
  current?: string | null;
}) {
  const custom =
    current && !GROUP_COLORS.some((c) => c.hex.toLowerCase() === current.toLowerCase())
      ? [{ hex: current, name: "Current colour" }]
      : [];
  const options = [...GROUP_COLORS.map((c) => ({ hex: c.hex, name: c.name })), ...custom];
  return (
    <RadioGroup
      value={value}
      onChange={onChange}
      orientation="horizontal"
      className="flex flex-col gap-1.5"
    >
      <Label className="text-[0.8125rem] font-medium text-ink-2">Colour</Label>
      <div className="-ml-1 flex flex-wrap gap-0.5">
        {options.map((o) => (
          <Radio
            key={o.hex}
            value={o.hex}
            aria-label={o.name}
            className="group flex size-11 cursor-pointer items-center justify-center rounded-full outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-ink"
          >
            <span
              className="flex size-8 items-center justify-center rounded-full shadow-[inset_0_0_0_1px_rgb(17_17_17/0.12)] transition-shadow duration-150 group-data-[selected]:shadow-[0_0_0_2px_#fff,0_0_0_4px_#111]"
              style={{ backgroundColor: o.hex }}
            >
              <Check
                aria-hidden
                strokeWidth={3}
                className="size-4 text-ink opacity-0 group-data-[selected]:opacity-100"
              />
            </span>
          </Radio>
        ))}
      </div>
    </RadioGroup>
  );
}

interface Draft {
  name: string;
  level: string;
  color: string;
  capacity: string;
  rateId: string;
  venueId: string;
  description: string;
}

const EMPTY: Draft = {
  name: "",
  level: "",
  color: GROUP_COLORS[0].hex,
  capacity: "",
  rateId: "none",
  venueId: "none",
  description: "",
};

/** Creates a group or edits one. Sessions keep their own copies of rate, venue, and size. */
export function GroupSheet({
  isOpen,
  onOpenChange,
  group,
  onSaved,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to create a new group. */
  group?: GroupDto | null;
  onSaved?: (group: GroupDto, created: boolean) => void;
}) {
  const fmt = useFormat();
  const can = useCan();
  const online = useOnline();
  const invalidate = useInvalidateGroups();
  const groups = useGroups();
  const rates = useRates();
  const venues = useVenues();
  const hasTeam = useHasTeam();
  const me = useMe().data;
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [coaches, setCoaches] = useState<CoachChoice>({ lead: null, assistants: [] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const activeRates = (rates.data ?? []).filter((r) => r.active && r.kind !== "court_fee");
  const venueList = venues.data ?? [];

  const save = useMutation({
    meta: { silent: true },
    mutationFn: (body: Record<string, unknown>) =>
      group
        ? api.patch<GroupDto>(`/groups/${group.id}`, body)
        : api.post<GroupDto>("/groups", body),
    onSuccess: (saved) => {
      invalidate(saved.id);
      notify({
        tone: "success",
        title: group ? "Group updated" : `${saved.name} created`,
        body: group ? undefined : "Add members and a weekly session next.",
      });
      onSaved?.(saved, !group);
      onOpenChange(false);
    },
  });

  // Re-seed each time the sheet opens. New groups get a colour no other group uses yet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-seed when the sheet opens.
  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    save.reset();
    setCoaches(
      group
        ? { lead: group.coachUserId, assistants: group.assistantCoachIds }
        : { lead: me?.user.id ?? null, assistants: [] },
    );
    if (group) {
      setDraft({
        name: group.name,
        level: group.level ?? "",
        color: group.color ?? GROUP_COLORS[0].hex,
        capacity: group.capacity ? String(group.capacity) : "",
        rateId: group.defaultRateId ?? "none",
        venueId: group.defaultVenueId ?? "none",
        description: group.description ?? "",
      });
      return;
    }
    const used = new Set((groups.data ?? []).map((g) => g.color?.toLowerCase()));
    setDraft({
      ...EMPTY,
      color: (GROUP_COLORS.find((c) => !used.has(c.hex)) ?? GROUP_COLORS[0]).hex,
      rateId: activeRates.find((r) => r.kind === "group")?.id ?? "none",
      venueId: venueList.length === 1 ? (venueList[0]?.id ?? "none") : "none",
    });
  }, [isOpen]);

  const serverErrors = fieldErrors(save.error);
  const err = (k: string) => errors[k] ?? serverErrors[k];

  const submit = () => {
    const errs: Record<string, string> = {};
    if (!draft.name.trim()) errs.name = "Name the group.";
    const cap = draft.capacity.trim() ? Number(draft.capacity) : null;
    if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > 500))
      errs.capacity = "Use a whole number from 1 to 500.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    save.mutate({
      name: draft.name.trim(),
      level: draft.level.trim() || null,
      color: draft.color,
      capacity: cap,
      defaultRateId: draft.rateId === "none" ? null : draft.rateId,
      defaultVenueId: draft.venueId === "none" ? null : draft.venueId,
      description: draft.description.trim() || null,
      ...(hasTeam ? { coachUserId: coaches.lead, assistantCoachIds: coaches.assistants } : {}),
    });
  };

  // A saved rate stays selectable even after it was switched off on the rate card.
  const rateOptions = [
    { id: "none", label: "No default rate" },
    ...activeRates.map((r) => ({
      id: r.id,
      label: r.name,
      description: can.money
        ? `${fmt.money(r.priceMinor)} per ${r.unit === "hour" ? "hour" : "session"}`
        : undefined,
    })),
    ...(draft.rateId !== "none" && !activeRates.some((r) => r.id === draft.rateId)
      ? [{ id: draft.rateId, label: "Current rate (switched off)" }]
      : []),
  ];

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="lg"
      title={group ? "Edit group" : "New group"}
      description={
        group
          ? "Changes apply to sessions you add from now on. Sessions already scheduled keep their details."
          : "A class that meets every week. Its members are booked into each session automatically."
      }
      footer={
        <>
          {!online ? <OfflineNote className="mr-auto" /> : null}
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="dark" isDisabled={!online} isPending={save.isPending} onPress={submit}>
            {group ? "Save changes" : "Create group"}
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
        <div className="grid gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <TextField
            label="Name"
            value={draft.name}
            onChange={(name) => set({ name })}
            placeholder="e.g. Tuesday beginners"
            error={err("name")}
            isRequired
            autoFocus={!group}
          />
          <TextField
            label="Level (optional)"
            value={draft.level}
            onChange={(level) => set({ level })}
            placeholder="e.g. 3.0–3.5 or Ages 9–14"
            error={err("level")}
          />
        </div>

        <ColorSwatches
          value={draft.color}
          onChange={(color) => set({ color })}
          current={group?.color}
        />

        <TextField
          label="Size limit (optional)"
          type="number"
          min="1"
          max="500"
          inputMode="numeric"
          value={draft.capacity}
          onChange={(capacity) => set({ capacity })}
          placeholder="No limit"
          description={
            group && draft.capacity && Number(draft.capacity) < group.memberCount
              ? `The group already has ${plural(group.memberCount, "member")}. Nobody is removed.`
              : "Also used as the session size when you schedule the group."
          }
          error={err("capacity")}
          className="sm:max-w-[16rem]"
        />

        {hasTeam ? (
          <CoachFields
            value={coaches}
            onChange={setCoaches}
            description={
              group
                ? "Used for sessions you add from now on. To change who runs sessions already scheduled, edit one and apply it to the following sessions."
                : "Runs the group's sessions and gets their reminders."
            }
            error={err("coachUserId") ?? err("assistantCoachIds")}
          />
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Default rate"
            options={rateOptions}
            value={draft.rateId}
            onChange={(rateId) => set({ rateId })}
            description="Charged to members who pay per session."
            error={err("defaultRateId")}
          />
          <SelectField
            label="Default venue"
            options={[
              { id: "none", label: "No default venue" },
              ...venueList.map((v) => ({
                id: v.id,
                label: v.name,
                description: v.courtCount ? plural(v.courtCount, "court") : undefined,
              })),
            ]}
            value={draft.venueId}
            onChange={(venueId) => set({ venueId })}
            error={err("defaultVenueId")}
          />
        </div>

        <TextAreaField
          label="Description (optional)"
          value={draft.description}
          onChange={(description) => set({ description })}
          placeholder="What the group works on and who it's for"
          error={err("description")}
        />

        {save.error ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
