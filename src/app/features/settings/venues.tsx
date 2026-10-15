import type { VenueDto } from "@shared/api-types";
import { venueSchema } from "@shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, IconButton } from "../../components/ui/button";
import { EmptyState, ErrorState, InlineError, RowsSkeleton } from "../../components/ui/feedback";
import { TextAreaField, TextField } from "../../components/ui/field";
import { ConfirmSheet, Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { plural } from "../../lib/format";
import { useVenues } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { OfflineNote } from "./offline";
import { SettingsSection } from "./sections";
import { changedFields, issuesToFields, wholeNumber } from "./validation";

const FRIENDLY: Record<string, string> = {
  name: "Give the venue a name.",
  courtCount: "Use a number of courts from 1 to 64, or leave it empty.",
  address: "Keep the address under 200 characters.",
  notes: "Keep notes under 500 characters.",
};

function VenueSheet({
  isOpen,
  onOpenChange,
  venue,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  venue: VenueDto | null;
}) {
  const online = useOnline();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [courts, setCourts] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<VenueDto | null>(venue);
  const editing = isOpen ? venue : shown;

  const save = useMutation({
    meta: { silent: true },
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? api.patch<VenueDto>(`/venues/${editing.id}`, body)
        : api.post<VenueDto>("/venues", body),
    onSuccess: (v) => {
      // Session cards show the venue name, so refresh them as well.
      for (const key of [keys.venues, keys.today, ["lessons"], ["lesson"]])
        void qc.invalidateQueries({ queryKey: key });
      notify({ tone: "success", title: editing ? `${v.name} saved` : `${v.name} added` });
      onOpenChange(false);
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when the sheet opens.
  useEffect(() => {
    if (!isOpen) return;
    setShown(venue);
    setName(venue?.name ?? "");
    setAddress(venue?.address ?? "");
    setCourts(venue?.courtCount ? String(venue.courtCount) : "");
    setNotes(venue?.notes ?? "");
    setErrors({});
    save.reset();
  }, [isOpen]);

  const submit = () => {
    const parsed = venueSchema.safeParse({
      name,
      address,
      courtCount: wholeNumber(courts),
      notes,
    });
    if (!parsed.success) {
      setErrors(issuesToFields(parsed.error.issues, FRIENDLY));
      return;
    }
    setErrors({});
    const body = {
      name: parsed.data.name,
      address: parsed.data.address ?? null,
      courtCount: parsed.data.courtCount ?? null,
      notes: parsed.data.notes ?? null,
    };
    if (!editing) {
      save.mutate(body);
      return;
    }
    const patch = changedFields(body, editing);
    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }
    save.mutate(patch);
  };
  const err = (k: string) => errors[k] ?? fieldErrors(save.error)[k];

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={editing ? "Edit venue" : "Add venue"}
      description="Shown on sessions so you and your players know where to be."
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="dark" isDisabled={!online} isPending={save.isPending} onPress={submit}>
            {editing ? "Save venue" : "Add venue"}
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
          placeholder="Riverside Park Courts"
          autoFocus={!editing}
          error={err("name")}
        />
        <TextField
          label="Address (optional)"
          value={address}
          onChange={setAddress}
          placeholder="Street, city"
          error={err("address")}
        />
        <TextField
          label="Courts (optional)"
          type="number"
          inputMode="numeric"
          min="1"
          max="64"
          value={courts}
          onChange={setCourts}
          error={err("courtCount")}
          className="max-w-[12rem]"
        />
        <TextAreaField
          label="Notes (optional)"
          value={notes}
          onChange={setNotes}
          rows={2}
          placeholder="Parking, gate code, lights until 10 PM…"
          error={err("notes")}
        />
        {save.error ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
        <OfflineNote />
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

export function VenuesSection() {
  const venues = useVenues();
  const online = useOnline();
  const qc = useQueryClient();
  const [venue, setVenue] = useState<VenueDto | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [removing, setRemoving] = useState<VenueDto | null>(null);
  // Keep the name while the confirm sheet animates closed.
  const [removingName, setRemovingName] = useState("");

  const remove = useMutation({
    meta: { silent: true },
    mutationFn: (v: VenueDto) => api.del(`/venues/${v.id}`),
    onSuccess: (_d, v) => {
      for (const key of [keys.venues, keys.today, ["lessons"], ["lesson"]])
        void qc.invalidateQueries({ queryKey: key });
      notify({
        tone: "success",
        title: `${v.name} removed`,
        body: "Sessions already there keep it.",
      });
      setRemoving(null);
    },
  });

  const open = (v: VenueDto | null) => {
    setVenue(v);
    setSheetOpen(true);
  };

  return (
    <SettingsSection
      id="venues"
      title="Venues"
      description="Courts and clubs you coach at. Sessions and groups can point to one."
      action={
        venues.data?.length ? (
          <Button
            variant="light"
            icon={<Plus aria-hidden className="size-4.5" />}
            isDisabled={!online}
            onPress={() => open(null)}
          >
            Add venue
          </Button>
        ) : null
      }
    >
      {venues.isPending ? (
        <RowsSkeleton rows={2} />
      ) : !venues.data ? (
        <ErrorState
          title="Couldn't load venues"
          message={errorMessage(venues.error)}
          onRetry={() => void venues.refetch()}
        />
      ) : venues.data.length === 0 ? (
        <EmptyState
          icon={<MapPin aria-hidden className="size-5" />}
          title="No venues yet"
          body="Add the courts you coach at so every session shows where to be."
          action={
            <Button variant="dark" isDisabled={!online} onPress={() => open(null)}>
              Add venue
            </Button>
          }
        />
      ) : (
        <ul className="-my-3 flex flex-col divide-y divide-line">
          {venues.data.map((v) => {
            const meta = [v.address, v.courtCount ? plural(v.courtCount, "court") : null]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={v.id} className="flex items-center gap-3 py-3">
                <span
                  aria-hidden
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-sky text-ink"
                >
                  <MapPin className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words">{v.name}</p>
                  <p className="num text-[0.8125rem] text-ink-2">{meta || "No address yet"}</p>
                  {v.notes ? (
                    <p className="line-clamp-1 text-[0.8125rem] text-ink-2">{v.notes}</p>
                  ) : null}
                </div>
                <IconButton label={`Edit ${v.name}`} isDisabled={!online} onPress={() => open(v)}>
                  <Pencil aria-hidden className="size-4.5" />
                </IconButton>
                <IconButton
                  label={`Remove ${v.name}`}
                  isDisabled={!online}
                  onPress={() => {
                    remove.reset();
                    setRemovingName(v.name);
                    setRemoving(v);
                  }}
                >
                  <Trash2 aria-hidden className="size-4.5" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
      <VenueSheet isOpen={sheetOpen} onOpenChange={setSheetOpen} venue={venue} />
      <ConfirmSheet
        isOpen={removing !== null}
        onOpenChange={(o) => {
          if (!o) setRemoving(null);
        }}
        title={`Remove ${removingName}?`}
        body={
          <div className="flex flex-col gap-3">
            <p>
              It won't be offered for new sessions or groups. Sessions already there keep it, so
              your history stays intact.
            </p>
            {remove.error ? <InlineError>{errorMessage(remove.error)}</InlineError> : null}
            <OfflineNote />
          </div>
        }
        confirmLabel="Remove venue"
        isPending={remove.isPending}
        onConfirm={() => {
          if (removing && online) remove.mutate(removing);
        }}
      />
    </SettingsSection>
  );
}
