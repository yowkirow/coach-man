import type { EventDto } from "@shared/api-types";
import {
  EVENT_KIND_LABELS,
  EVENT_STATUSES,
  type EventKind,
  type EventStatus,
} from "@shared/domain";
import { addDays, compareDates, DATE_RE, daysBetween } from "@shared/time";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { InlineError } from "../../components/ui/feedback";
import {
  MoneyField,
  Segmented,
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { plural, useFormat } from "../../lib/format";
import { useVenues } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { OfflineNote, WrapSegmented } from "../schedule/choice";
import { EVENT_KIND_ORDER, EVENT_STATUS_LABEL, plainAmount } from "./event-meta";
import { useInvalidateEvents } from "./queries";

interface Draft {
  kind: EventKind;
  name: string;
  startsOn: string;
  endsOn: string;
  venueId: string;
  capacity: string;
  price: number | null;
  earlyPrice: number | null;
  earlyUntil: string;
  level: string;
  ageMin: string;
  ageMax: string;
  description: string;
  status: EventStatus;
}

function fromEvent(e: EventDto): Draft {
  return {
    kind: e.kind,
    name: e.name,
    startsOn: e.startsOn,
    endsOn: e.endsOn,
    venueId: e.venueId ?? "none",
    capacity: e.capacity ? String(e.capacity) : "",
    price: e.priceMinor,
    earlyPrice: e.earlyBirdPriceMinor,
    earlyUntil: e.earlyBirdUntil ?? "",
    level: e.level ?? "",
    ageMin: e.ageMin !== null ? String(e.ageMin) : "",
    ageMax: e.ageMax !== null ? String(e.ageMax) : "",
    description: e.description ?? "",
    status: e.status,
  };
}

const wholeIn = (v: string, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max;
};

/** Creates an event or edits every detail of one, including early-bird pricing and status. */
export function EventSheet({
  isOpen,
  onOpenChange,
  event,
  onSaved,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to create a new event. */
  event?: EventDto | null;
  onSaved?: (event: EventDto, created: boolean) => void;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const venues = useVenues();
  const invalidate = useInvalidateEvents();
  const today = fmt.today();
  const [draft, setDraft] = useState<Draft>(() => blank(today));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = useMutation({
    meta: { silent: true },
    mutationFn: (body: Record<string, unknown>) =>
      event
        ? api.patch<EventDto>(`/events/${event.id}`, body)
        : api.post<EventDto>("/events", body),
    onSuccess: (saved) => {
      invalidate(saved.id);
      const promoted = event ? saved.registeredCount - event.registeredCount : 0;
      notify({
        tone: "success",
        title: event ? "Event updated" : `${saved.name} created`,
        body:
          promoted > 0
            ? `${plural(promoted, "player")} moved off the waitlist.`
            : event
              ? undefined
              : "Register players and add its sessions next.",
      });
      onSaved?.(saved, !event);
      onOpenChange(false);
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-seed when the sheet opens.
  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    save.reset();
    setDraft(event ? fromEvent(event) : blank(today));
  }, [isOpen]);

  const serverErrors = fieldErrors(save.error);
  const err = (k: string) => errors[k] ?? serverErrors[k];

  const submit = () => {
    const d = draft;
    const errs: Record<string, string> = {};
    if (!d.name.trim()) errs.name = "Name the event.";
    if (!DATE_RE.test(d.startsOn)) errs.startsOn = "Pick the first day.";
    if (!DATE_RE.test(d.endsOn)) errs.endsOn = "Pick the last day.";
    else if (DATE_RE.test(d.startsOn) && compareDates(d.endsOn, d.startsOn) < 0)
      errs.endsOn = "This is before the first day.";
    if (d.capacity && !wholeIn(d.capacity, 1, 1000))
      errs.capacity = "Use a whole number from 1 to 1,000.";
    if (d.price === null) errs.priceMinor = "Enter a price, or 0 if it's free.";
    if (d.earlyPrice !== null && !DATE_RE.test(d.earlyUntil))
      errs.earlyBirdUntil = "Pick the last early-bird day.";
    if (d.earlyPrice === null && d.earlyUntil)
      errs.earlyBirdPriceMinor = "Enter the early-bird price, or clear the date.";
    if (d.ageMin && !wholeIn(d.ageMin, 3, 100)) errs.ageMin = "Use an age from 3 to 100.";
    if (d.ageMax && !wholeIn(d.ageMax, 3, 100)) errs.ageMax = "Use an age from 3 to 100.";
    if (!errs.ageMin && !errs.ageMax && d.ageMin && d.ageMax && Number(d.ageMax) < Number(d.ageMin))
      errs.ageMax = "This is below the youngest age.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    save.mutate({
      kind: d.kind,
      name: d.name.trim(),
      description: d.description.trim() || null,
      startsOn: d.startsOn,
      endsOn: d.endsOn,
      venueId: d.venueId === "none" ? null : d.venueId,
      capacity: d.capacity ? Number(d.capacity) : null,
      priceMinor: d.price ?? 0,
      earlyBirdPriceMinor: d.earlyPrice,
      earlyBirdUntil: d.earlyPrice !== null ? d.earlyUntil : null,
      level: d.level.trim() || null,
      ageMin: d.ageMin ? Number(d.ageMin) : null,
      ageMax: d.ageMax ? Number(d.ageMax) : null,
      status: d.status,
    });
  };

  const validRange =
    DATE_RE.test(draft.startsOn) &&
    DATE_RE.test(draft.endsOn) &&
    compareDates(draft.endsOn, draft.startsOn) >= 0;
  const days = validRange ? daysBetween(draft.startsOn, draft.endsOn) + 1 : null;
  const below =
    event && draft.capacity && Number(draft.capacity) < event.registeredCount
      ? `${plural(event.registeredCount, "player")} already registered. Nobody is removed.`
      : null;

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="lg"
      title={event ? "Edit event" : "New event"}
      description={
        event
          ? "Price changes apply to new registrations. Players already registered keep their price."
          : "Camps, academies, clinics, tournaments, and socials. Registrations fill up to capacity, then join a waitlist."
      }
      footer={
        <>
          {!online ? <OfflineNote className="mr-auto" /> : null}
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="dark" isDisabled={!online} isPending={save.isPending} onPress={submit}>
            {event ? "Save changes" : "Create event"}
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
        <WrapSegmented
          label="Type"
          value={draft.kind}
          onChange={(v) => set({ kind: v as EventKind })}
          options={EVENT_KIND_ORDER.map((k) => ({ id: k, label: EVENT_KIND_LABELS[k] }))}
        />

        <TextField
          label="Name"
          value={draft.name}
          onChange={(name) => set({ name })}
          placeholder={`e.g. Summer ${EVENT_KIND_LABELS[draft.kind].toLowerCase()} · Juniors`}
          error={err("name")}
          isRequired
          autoFocus={!event}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="First day"
            type="date"
            value={draft.startsOn}
            onChange={(startsOn) =>
              set({
                startsOn,
                // Keep the range valid while the first day moves.
                endsOn:
                  DATE_RE.test(startsOn) &&
                  DATE_RE.test(draft.endsOn) &&
                  compareDates(draft.endsOn, startsOn) < 0
                    ? startsOn
                    : draft.endsOn,
              })
            }
            error={err("startsOn")}
            isRequired
          />
          <TextField
            label="Last day"
            type="date"
            value={draft.endsOn}
            min={DATE_RE.test(draft.startsOn) ? draft.startsOn : undefined}
            onChange={(endsOn) => set({ endsOn })}
            error={err("endsOn")}
            description={days ? (days === 1 ? "A one-day event" : `${days} days`) : undefined}
            isRequired
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <SelectField
            label="Venue"
            options={[
              { id: "none", label: "No venue" },
              ...(venues.data ?? []).map((v) => ({ id: v.id, label: v.name })),
            ]}
            value={draft.venueId}
            onChange={(venueId) => set({ venueId })}
            error={err("venueId")}
          />
          <TextField
            label="Capacity"
            type="number"
            min="1"
            max="1000"
            inputMode="numeric"
            value={draft.capacity}
            onChange={(capacity) => set({ capacity })}
            placeholder="No limit"
            description={below ?? "Extra sign-ups join the waitlist."}
            error={err("capacity")}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <MoneyField
            label="Price"
            currency={fmt.currency}
            valueMinor={draft.price}
            onChange={(price) => set({ price })}
            placeholder={plainAmount(0, fmt)}
            error={err("priceMinor")}
            isRequired
          />
          <MoneyField
            label="Early-bird price"
            currency={fmt.currency}
            valueMinor={draft.earlyPrice}
            onChange={(earlyPrice) => set({ earlyPrice })}
            placeholder="Optional"
            error={err("earlyBirdPriceMinor")}
          />
          <TextField
            label="Early-bird until"
            type="date"
            value={draft.earlyUntil}
            max={DATE_RE.test(draft.endsOn) ? draft.endsOn : undefined}
            onChange={(earlyUntil) => set({ earlyUntil })}
            error={err("earlyBirdUntil")}
            description={draft.earlyPrice !== null ? "Last day of the early-bird price" : undefined}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <TextField
            label="Level (optional)"
            value={draft.level}
            onChange={(level) => set({ level })}
            placeholder="e.g. 2.5–3.5 or All levels"
            error={err("level")}
          />
          <TextField
            label="Youngest age"
            type="number"
            min="3"
            max="100"
            inputMode="numeric"
            value={draft.ageMin}
            onChange={(ageMin) => set({ ageMin })}
            placeholder="Any"
            error={err("ageMin")}
          />
          <TextField
            label="Oldest age"
            type="number"
            min="3"
            max="100"
            inputMode="numeric"
            value={draft.ageMax}
            onChange={(ageMax) => set({ ageMax })}
            placeholder="Any"
            error={err("ageMax")}
          />
        </div>

        <TextAreaField
          label="Description (optional)"
          value={draft.description}
          onChange={(description) => set({ description })}
          rows={4}
          placeholder="What players do, what to bring, and anything parents should know"
          error={err("description")}
        />

        {event ? (
          <WrapSegmented
            label="Status"
            value={draft.status}
            onChange={(v) => set({ status: v as EventStatus })}
            options={EVENT_STATUSES.map((s) => ({ id: s, label: EVENT_STATUS_LABEL[s] }))}
            error={err("status")}
          />
        ) : (
          <Segmented
            label="Status"
            value={draft.status}
            onChange={(v) => set({ status: v as EventStatus })}
            options={[
              { id: "draft", label: "Draft" },
              { id: "open", label: "Open" },
            ]}
            className="sm:max-w-[22rem]"
          />
        )}

        {save.error ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

function blank(today: string): Draft {
  const start = addDays(today, 14);
  return {
    kind: "camp",
    name: "",
    startsOn: start,
    endsOn: addDays(start, 4),
    venueId: "none",
    capacity: "",
    price: null,
    earlyPrice: null,
    earlyUntil: "",
    level: "",
    ageMin: "",
    ageMax: "",
    description: "",
    status: "open",
  };
}
