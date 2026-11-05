import type { CoachProfileDto } from "@shared/api-types";
import { type CoachProfileUpdateInput, coachProfileUpdateSchema } from "@shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { FileTrigger } from "react-aria-components";
import { CoachAvatar } from "../../components/domain/coaches";
import { Button } from "../../components/ui/button";
import { ErrorState, InlineError, RowsSkeleton } from "../../components/ui/feedback";
import { Switch, TextAreaField, TextField } from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { prepareImage, putImage } from "../../lib/images";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { TagInput } from "../clients/client-form";
import { OfflineNote } from "../settings/offline";
import { changedFields, issuesToFields, wholeNumber } from "../settings/validation";

interface Draft {
  displayName: string;
  title: string;
  bio: string;
  certifications: string[];
  specialties: string[];
  languages: string[];
  duprRating: string;
  yearsCoaching: string;
  isPublic: boolean;
}

function draftOf(p: CoachProfileDto): Draft {
  return {
    displayName: p.displayName ?? "",
    title: p.title ?? "",
    bio: p.bio ?? "",
    certifications: p.certifications,
    specialties: p.specialties,
    languages: p.languages,
    duprRating: p.duprRating === null ? "" : String(p.duprRating),
    yearsCoaching: p.yearsCoaching === null ? "" : String(p.yearsCoaching),
    isPublic: p.isPublic,
  };
}

function toInput(d: Draft) {
  const rating = d.duprRating.trim() ? Number(d.duprRating.trim().replace(",", ".")) : null;
  return {
    displayName: d.displayName,
    title: d.title,
    bio: d.bio,
    certifications: d.certifications,
    specialties: d.specialties,
    languages: d.languages,
    duprRating: rating === null ? null : Number.isFinite(rating) ? rating : Number.NaN,
    yearsCoaching: wholeNumber(d.yearsCoaching),
    isPublic: d.isPublic,
  };
}

const FRIENDLY: Record<string, string> = {
  displayName: "Keep the name under 80 characters.",
  title: "Keep the title under 80 characters.",
  duprRating: "Use a DUPR rating from 1.0 to 8.0, or leave it empty.",
  yearsCoaching: "Use a whole number of years, or leave it empty.",
};

export function useCoachProfile(userId: string, enabled = true) {
  return useQuery({
    queryKey: keys.coachProfile(userId),
    queryFn: () => api.get<CoachProfileDto>(`/coaches/${userId}`),
    enabled: enabled && Boolean(userId),
  });
}

/** Coach names and photos show across the app: refresh everything that shows them. */
function useRefreshCoach() {
  const qc = useQueryClient();
  return (profile: CoachProfileDto) => {
    qc.setQueryData(keys.coachProfile(profile.userId), profile);
    for (const key of [keys.coaches, keys.team, ["client"], ["progress"], ["lesson"]]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };
}

/** The editable coach profile: a draft seeded from the server, validation, and saving. */
function useCoachProfileForm(profile: CoachProfileDto | undefined, onSaved?: () => void) {
  const refresh = useRefreshCoach();
  const [draft, setDraft] = useState<Draft | null>(profile ? draftOf(profile) : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const seed = profile ? JSON.stringify(draftOf(profile)) : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed when the saved profile changes.
  useEffect(() => {
    setDraft(profile ? draftOf(profile) : null);
    setErrors({});
  }, [seed]);
  const save = useMutation({
    meta: { silent: true },
    mutationFn: (patch: CoachProfileUpdateInput) =>
      api.patch<CoachProfileDto>(`/coaches/${profile?.userId}`, patch),
    onSuccess: (p) => {
      refresh(p);
      notify({ tone: "success", title: "Coach profile saved" });
      onSaved?.();
    },
    // The server's field errors join the form's own, so editing a field clears them.
    onError: (e) => setErrors(fieldErrors(e)),
  });
  const dirty = draft !== null && JSON.stringify(draft) !== seed;
  const submit = () => {
    if (!profile || !draft) return;
    // Validate everything the form shows, then send only what changed.
    const parsed = coachProfileUpdateSchema.safeParse(toInput(draft));
    if (!parsed.success) {
      setErrors(issuesToFields(parsed.error.issues, FRIENDLY));
      return;
    }
    setErrors({});
    const before = coachProfileUpdateSchema.safeParse(toInput(draftOf(profile)));
    const patch = changedFields(parsed.data, before.success ? before.data : {});
    if (!Object.keys(patch).length) {
      onSaved?.();
      return;
    }
    save.mutate(patch);
  };
  const reset = () => {
    setDraft(profile ? draftOf(profile) : null);
    setErrors({});
    save.reset();
  };
  /** Changes one field and clears its error (a stale error would also keep the field invalid). */
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
    setErrors((e) => {
      if (!(k in e)) return e;
      const { [k]: _cleared, ...rest } = e;
      return rest;
    });
  };
  const err = (k: string) => errors[k];
  return { draft, set, dirty, save, submit, reset, err };
}

/** Upload, change, or remove a coach's photo (square-cropped; shown to the team and on the academy page). */
export function CoachPhoto({ profile }: { profile: CoachProfileDto }) {
  const online = useOnline();
  const refresh = useRefreshCoach();
  const upload = useMutation({
    meta: { silent: true },
    mutationFn: async (file: File) => {
      const blob = await prepareImage(file, { mode: "cover", maxEdge: 640, type: "image/jpeg" });
      return putImage<{ photoKey: string }>(`/coaches/${profile.userId}/photo`, blob);
    },
    onSuccess: ({ photoKey }) => {
      refresh({ ...profile, photoKey });
      notify({ tone: "success", title: "Photo updated" });
    },
  });
  const remove = useMutation({
    meta: { silent: true },
    mutationFn: () => api.del(`/coaches/${profile.userId}/photo`),
    onSuccess: () => {
      refresh({ ...profile, photoKey: null });
      notify({ tone: "neutral", title: "Photo removed", body: "Initials show instead." });
    },
  });
  const busy = upload.isPending || remove.isPending;
  const error = upload.error ?? remove.error;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <CoachAvatar coach={profile} size="lg" />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <FileTrigger
            acceptedFileTypes={["image/jpeg", "image/png", "image/webp"]}
            onSelect={(files) => {
              const file = files?.[0];
              if (file) upload.mutate(file);
            }}
          >
            <Button
              variant="light"
              size="sm"
              isDisabled={!online || busy}
              isPending={upload.isPending}
              icon={<ImagePlus aria-hidden className="size-4" />}
            >
              {profile.photoKey ? "Change photo" : "Add a photo"}
            </Button>
          </FileTrigger>
          {profile.photoKey ? (
            <Button
              variant="ghost"
              size="sm"
              isDisabled={!online || busy}
              isPending={remove.isPending}
              icon={<Trash2 aria-hidden className="size-4" />}
              onPress={() => remove.mutate()}
            >
              Remove
            </Button>
          ) : null}
        </div>
        <p className="text-[0.8125rem] text-ink-2">
          A clear face photo helps students and parents know who they're training with.
        </p>
      </div>
      {error ? (
        <div className="basis-full">
          <InlineError>{errorMessage(error)}</InlineError>
        </div>
      ) : null}
    </div>
  );
}

function ProfileFields({
  profile,
  form,
}: {
  profile: CoachProfileDto;
  form: ReturnType<typeof useCoachProfileForm>;
}) {
  const { draft, set, err } = form;
  if (!draft) return null;
  return (
    <div className="flex flex-col gap-5">
      <CoachPhoto profile={profile} />
      <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
        <TextField
          label="Name shown"
          value={draft.displayName}
          onChange={(v) => set("displayName", v)}
          placeholder={profile.accountName}
          description="Leave empty to use the name on the account."
          error={err("displayName")}
        />
        <TextField
          label="Title"
          value={draft.title}
          onChange={(v) => set("title", v)}
          placeholder="e.g. Head coach"
          error={err("title")}
        />
        <TextAreaField
          label="About"
          value={draft.bio}
          onChange={(v) => set("bio", v)}
          rows={4}
          placeholder="How you coach, who you work with, what you play"
          error={err("bio")}
          className="sm:col-span-2"
        />
        <TextField
          label="DUPR rating"
          inputMode="decimal"
          value={draft.duprRating}
          onChange={(v) => set("duprRating", v)}
          placeholder="e.g. 4.25"
          error={err("duprRating")}
        />
        <TextField
          label="Years coaching"
          type="number"
          inputMode="numeric"
          min="0"
          max="80"
          value={draft.yearsCoaching}
          onChange={(v) => set("yearsCoaching", v)}
          error={err("yearsCoaching")}
        />
        <div className="sm:col-span-2">
          <TagInput
            label="Certifications"
            value={draft.certifications}
            onChange={(v) => set("certifications", v)}
            placeholder="Type one, then Enter"
            description="Coaching licenses and courses."
            maxLength={80}
            error={err("certifications")}
          />
        </div>
        <TagInput
          label="Specialties"
          value={draft.specialties}
          onChange={(v) => set("specialties", v)}
          placeholder="Type one, then Enter"
          description="For example juniors, beginners, or tournament play."
          maxLength={60}
          error={err("specialties")}
        />
        <TagInput
          label="Languages"
          value={draft.languages}
          onChange={(v) => set("languages", v)}
          placeholder="Type one, then Enter"
          description="The languages you coach in."
          max={10}
          maxLength={40}
          error={err("languages")}
        />
      </div>
      <div className="rounded-[22px] bg-panel px-4 py-2">
        <Switch
          isSelected={draft.isPublic}
          onChange={(v) => set("isPublic", v)}
          description="Your name, photo, title, and about text can appear on the academy's public page and to its students and parents. Your email never does."
        >
          Show on the academy page
        </Switch>
      </div>
    </div>
  );
}

/** Settings: every staff member's own coach profile. */
export function MyCoachProfileSection({ userId }: { userId: string }) {
  const online = useOnline();
  const q = useCoachProfile(userId);
  const form = useCoachProfileForm(q.data);
  if (q.isPending) return <RowsSkeleton rows={3} />;
  if (!q.data) {
    return (
      <ErrorState
        title="Couldn't load your coach profile"
        message={errorMessage(q.error)}
        onRetry={() => void q.refetch()}
      />
    );
  }
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (online && form.dirty) form.submit();
      }}
    >
      <ProfileFields profile={q.data} form={form} />
      {form.save.error && !Object.keys(fieldErrors(form.save.error)).length ? (
        <div className="mt-4">
          <InlineError>{errorMessage(form.save.error)}</InlineError>
        </div>
      ) : null}
      {form.dirty ? (
        <>
          <div className="mt-4">
            <OfflineNote />
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
            <p className="mr-auto text-[0.8125rem] text-ink-2">Unsaved changes</p>
            <Button variant="ghost" onPress={form.reset}>
              Discard
            </Button>
            <Button
              type="submit"
              variant="dark"
              isDisabled={!online}
              isPending={form.save.isPending}
            >
              Save profile
            </Button>
          </div>
        </>
      ) : null}
    </form>
  );
}

/** Team: edit anyone's coach profile (people who manage the team), or your own. */
export function CoachProfileSheet({
  userId,
  name,
  onClose,
}: {
  userId: string | null;
  name: string;
  onClose: () => void;
}) {
  const online = useOnline();
  const q = useCoachProfile(userId ?? "", userId !== null);
  const form = useCoachProfileForm(q.data, onClose);
  return (
    <Sheet
      isOpen={userId !== null}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title="Coach profile"
      description={name}
      footer={
        <>
          <Button variant="light" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="dark"
            isDisabled={!online || !q.data}
            isPending={form.save.isPending}
            onPress={form.submit}
          >
            Save profile
          </Button>
        </>
      }
    >
      {q.isPending ? (
        <RowsSkeleton rows={4} />
      ) : !q.data ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (online) form.submit();
          }}
        >
          <ProfileFields profile={q.data} form={form} />
          {form.save.error && !Object.keys(fieldErrors(form.save.error)).length ? (
            <InlineError>{errorMessage(form.save.error)}</InlineError>
          ) : null}
          <OfflineNote />
          <button type="submit" hidden />
        </form>
      )}
    </Sheet>
  );
}
