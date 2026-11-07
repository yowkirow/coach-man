import type { PickupDto } from "@shared/api-types";
import { telHref } from "@shared/safety";
import { ImagePlus, Phone, Trash2, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { FileTrigger } from "react-aria-components";
import { Button } from "../../components/ui/button";
import { Avatar } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { TextAreaField, TextField } from "../../components/ui/field";
import { ConfirmSheet, Sheet } from "../../components/ui/overlay";
import { errorMessage, fieldErrors } from "../../lib/api";
import { prepareImage } from "../../lib/images";
import { useOnline } from "../../lib/offline";

export function personOf(name: string) {
  const [firstName = "", ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(" ") };
}

/** A "Call" pill for a phone number (tap to call on a phone). */
export function CallButton({ phone, name }: { phone: string; name: string }) {
  return (
    <a
      href={telHref(phone)}
      aria-label={`Call ${name}, ${phone}`}
      className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-ink px-4 text-[0.9375rem] font-medium text-white outline-none transition-colors hover:bg-night-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <Phone aria-hidden className="size-4.5" />
      Call
    </a>
  );
}

/**
 * The people allowed to pick a junior up, with their photos, relationship, notes, and a Call
 * button. `photoUrl` turns a key into a URL (staff and family read photos through their own
 * file routes); `onEdit` makes each row editable.
 */
export function PickupList({
  pickups,
  photoUrl,
  onEdit,
}: {
  pickups: PickupDto[];
  photoUrl: (key: string | null) => string | null;
  onEdit?: (p: PickupDto) => void;
}) {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {pickups.map((p) => (
        <li key={p.id} className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0">
          <Avatar person={personOf(p.name)} size="lg" src={photoUrl(p.photoKey)} />
          <div className="min-w-0 flex-1">
            <p className="text-[1rem] font-medium">{p.name}</p>
            {p.relationship ? (
              <p className="text-[0.8125rem] text-ink-2">{p.relationship}</p>
            ) : null}
            {p.phone ? <p className="num mt-0.5 text-[0.875rem]">{p.phone}</p> : null}
            {p.notes ? (
              <p className="mt-1 text-[0.8125rem] whitespace-pre-line text-ink-2">{p.notes}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {p.phone ? <CallButton phone={p.phone} name={p.name} /> : null}
            {onEdit ? (
              <Button variant="light" size="sm" onPress={() => onEdit(p)}>
                Edit<span className="sr-only"> {p.name}</span>
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

interface Form {
  name: string;
  relationship: string;
  phone: string;
  notes: string;
}

const formOf = (p: PickupDto | null): Form => ({
  name: p?.name ?? "",
  relationship: p?.relationship ?? "",
  phone: p?.phone ?? "",
  notes: p?.notes ?? "",
});

/** A face photo, square-cropped and shrunk on the device before it's sent (1.5 MB max). */
export function preparePickupPhoto(file: File): Promise<Blob> {
  return prepareImage(file, { mode: "cover", maxEdge: 640, type: "image/jpeg" });
}

/** Builds the multipart body the pickup routes take: `data` (JSON) and, if any, `photo`. */
export function pickupBody(data: Record<string, unknown>, photo: Blob | null): FormData | object {
  if (!photo) return data;
  const form = new FormData();
  form.set("data", JSON.stringify(data));
  form.set("photo", photo, "photo.jpg");
  return form;
}

/**
 * Adds or edits an authorized pickup person: name, relationship, phone, notes, and a photo (a
 * face photo helps the coach at the court). Shared by staff and families; `save` sends it.
 */
export function PickupSheet({
  isOpen,
  onOpenChange,
  pickup,
  studentName,
  photoUrl,
  save,
  remove,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = a new person. */
  pickup: PickupDto | null;
  studentName: string;
  photoUrl: (key: string | null) => string | null;
  save: (body: FormData | object) => Promise<unknown>;
  remove?: (p: PickupDto) => Promise<unknown>;
}) {
  const online = useOnline();
  const [form, setForm] = useState<Form>(() => formOf(pickup));
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [dropPhoto, setDropPhoto] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<null | "save" | "remove" | "photo">(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: start fresh each time it opens.
  useEffect(() => {
    if (!isOpen) return;
    setForm(formOf(pickup));
    setPhoto(null);
    setDropPhoto(false);
    setErrors({});
    setError(null);
  }, [isOpen, pickup?.id]);
  useEffect(() => () => (photo ? URL.revokeObjectURL(photo.url) : undefined), [photo]);

  const set = (key: keyof Form) => (v: string) => {
    setForm((f) => ({ ...f, [key]: v }));
    setErrors((e) => ({ ...e, [key]: "" }));
  };

  const choose = async (file: File) => {
    setPending("photo");
    setError(null);
    try {
      const blob = await preparePickupPhoto(file);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
      setDropPhoto(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  const submit = async () => {
    if (!form.name.trim()) {
      setErrors({ name: "Add the person's name." });
      return;
    }
    setPending("save");
    setError(null);
    try {
      await save(
        pickupBody(
          {
            name: form.name.trim(),
            relationship: form.relationship,
            phone: form.phone,
            notes: form.notes,
            ...(dropPhoto && !photo ? { removePhoto: true } : {}),
          },
          photo?.blob ?? null,
        ),
      );
      onOpenChange(false);
    } catch (err) {
      const fields = fieldErrors(err);
      setErrors(fields);
      if (!Object.keys(fields).length || fields.photo) setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  const shown = photo?.url ?? (dropPhoto ? null : photoUrl(pickup?.photoKey ?? null));
  const label = form.name.trim() || "New person";
  return (
    <>
      <Sheet
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        title={pickup ? `Edit ${pickup.name}` : "Add a pickup person"}
        description={`Someone allowed to pick ${studentName} up after training.`}
        footer={
          <>
            {pickup && remove ? (
              <Button
                variant="ghost"
                className="mr-auto text-[#b42318]"
                isDisabled={!online || pending !== null}
                onPress={() => setConfirmRemove(true)}
              >
                Remove
              </Button>
            ) : null}
            <Button variant="light" onPress={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="dark"
              isPending={pending === "save"}
              isDisabled={!online || (pending !== null && pending !== "save")}
              onPress={() => void submit()}
            >
              {pickup ? "Save" : "Add person"}
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex items-center gap-4">
            <Avatar person={personOf(label)} size="lg" src={shown} />
            <div className="flex flex-wrap gap-2">
              <FileTrigger
                acceptedFileTypes={["image/jpeg", "image/png", "image/webp", "image/heic"]}
                onSelect={(files) => {
                  const file = files?.[0];
                  if (file) void choose(file);
                }}
              >
                <Button
                  variant="light"
                  size="sm"
                  isPending={pending === "photo"}
                  icon={<ImagePlus aria-hidden className="size-4" />}
                >
                  {shown ? "Change photo" : "Add a photo"}
                </Button>
              </FileTrigger>
              {shown ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 aria-hidden className="size-4" />}
                  onPress={() => {
                    setPhoto(null);
                    setDropPhoto(true);
                  }}
                >
                  Remove photo
                </Button>
              ) : null}
            </div>
          </div>
          <TextField
            label="Name"
            value={form.name}
            onChange={set("name")}
            autoComplete="off"
            error={errors.name || undefined}
            autoFocus={!pickup}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              label="Relationship"
              value={form.relationship}
              onChange={set("relationship")}
              placeholder="Grandmother, driver…"
              error={errors.relationship || undefined}
            />
            <TextField
              label="Phone"
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={set("phone")}
              error={errors.phone || undefined}
            />
          </div>
          <TextAreaField
            label="Notes for the coach"
            value={form.notes}
            onChange={set("notes")}
            rows={2}
            placeholder="Car and plate number, or anything that helps the coach know them"
            error={errors.notes || undefined}
          />
          <p className="flex items-start gap-2 text-[0.8125rem] text-ink-2">
            <UserRound aria-hidden className="mt-0.5 size-4 shrink-0" />
            The photo is private: only the academy's staff and {studentName}'s family see it.
          </p>
          {error ? <InlineError>{error}</InlineError> : null}
          {!online ? (
            <p className="rounded-2xl bg-amber-soft px-4 py-3 text-[0.875rem]">
              You're offline. Reconnect to save changes.
            </p>
          ) : null}
        </form>
      </Sheet>
      {pickup && remove ? (
        <ConfirmSheet
          isOpen={confirmRemove}
          onOpenChange={setConfirmRemove}
          title={`Remove ${pickup.name}?`}
          body={`${pickup.name} will no longer be listed as allowed to pick ${studentName} up.`}
          confirmLabel="Remove"
          isPending={pending === "remove"}
          onConfirm={async () => {
            setPending("remove");
            try {
              await remove(pickup);
              setConfirmRemove(false);
              onOpenChange(false);
            } catch (err) {
              setConfirmRemove(false);
              setError(errorMessage(err));
            } finally {
              setPending(null);
            }
          }}
        />
      ) : null}
    </>
  );
}
