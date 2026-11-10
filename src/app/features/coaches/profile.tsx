import type { CoachProfileDto } from "@shared/api-types";
import { framingOr, type PhotoFraming, PORTRAIT_FRAMING } from "@shared/framing";
import { isCoachingRole, type StaffRole } from "@shared/roles";
import { type CoachProfileUpdateInput, coachProfileUpdateSchema } from "@shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { FileTrigger } from "react-aria-components";
import { CoachAvatar } from "../../components/domain/coaches";
import { PhotoFramer } from "../../components/domain/photo-framer";
import { Button } from "../../components/ui/button";
import { ErrorState, InlineError, RowsSkeleton } from "../../components/ui/feedback";
import { Switch, TextField } from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors, fileUrl } from "../../lib/api";
import { useMe } from "../../lib/hooks";
import { prepareImage, putImage } from "../../lib/images";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { OfflineNote } from "../settings/offline";
import { changedFields, issuesToFields } from "../settings/validation";
import {
  COACHING_FRIENDLY,
  type CoachingDraft,
  CoachingFields,
  coachingDraftOf,
  coachingInput,
} from "./coaching-fields";
import { PortraitField, preparePortrait } from "./portrait";

interface Draft extends CoachingDraft {
  displayName: string;
  isPublic: boolean;
}

function draftOf(p: CoachProfileDto): Draft {
  return { displayName: p.displayName ?? "", ...coachingDraftOf(p), isPublic: p.isPublic };
}

function toInput(d: Draft) {
  return { displayName: d.displayName, ...coachingInput(d), isPublic: d.isPublic };
}

const FRIENDLY: Record<string, string> = {
  displayName: "Keep the name under 80 characters.",
  ...COACHING_FRIENDLY,
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
    for (const key of [
      keys.coaches,
      keys.team,
      keys.teamPage,
      keys.publicPreview,
      ["client"],
      ["progress"],
      ["lesson"],
    ]) {
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
      notify({
        tone: "success",
        title: isCoachingRole(p.role) ? "Coach profile saved" : "Profile saved",
      });
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
  /** Changes some fields and clears their errors (a stale error would keep a field invalid). */
  const update = (patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setErrors((e) =>
      Object.keys(patch).some((k) => k in e)
        ? Object.fromEntries(Object.entries(e).filter(([k]) => !(k in patch)))
        : e,
    );
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => update({ [k]: v } as Partial<Draft>);
  const err = (k: string) => errors[k];
  return { draft, set, update, dirty, save, submit, reset, err };
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
          {isCoachingRole(profile.role)
            ? "A clear face photo helps students and parents know who they're training with."
            : "A clear face photo helps your team know who's who."}
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

/** The coach's half-body team page photo (4:5), uploaded at once like the photo above it. */
function CoachPortrait({ profile }: { profile: CoachProfileDto }) {
  const online = useOnline();
  const refresh = useRefreshCoach();
  const [adjusting, setAdjusting] = useState(false);
  const upload = useMutation({
    meta: { silent: true },
    mutationFn: async (file: File) =>
      putImage<{ portraitKey: string }>(
        `/coaches/${profile.userId}/portrait`,
        await preparePortrait(file),
      ),
    onSuccess: ({ portraitKey }) => {
      refresh({ ...profile, portraitKey, portraitFraming: null });
      notify({ tone: "success", title: "Team page photo updated" });
      // A new photo starts at the default framing: offer to line it up right away.
      setAdjusting(true);
    },
  });
  const remove = useMutation({
    meta: { silent: true },
    mutationFn: () => api.del(`/coaches/${profile.userId}/portrait`),
    onSuccess: () => {
      refresh({ ...profile, portraitKey: null, portraitFraming: null });
      notify({
        tone: "neutral",
        title: "Team page photo removed",
        body: profile.photoKey
          ? "The team page shows the square photo instead."
          : "The team page shows initials instead.",
      });
    },
  });
  const frame = useMutation({
    meta: { silent: true },
    mutationFn: (portraitFraming: PhotoFraming | null) =>
      api.patch<CoachProfileDto>(`/coaches/${profile.userId}`, { portraitFraming }),
    onSuccess: (saved) => {
      refresh(saved);
      setAdjusting(false);
      notify({ tone: "success", title: "Team page photo adjusted" });
    },
  });
  const error = upload.error ?? remove.error;
  const src = fileUrl(profile.portraitKey);
  return (
    <>
      <PortraitField
        src={src}
        framing={profile.portraitFraming}
        onChoose={(file) => upload.mutate(file)}
        onRemove={() => remove.mutate()}
        onAdjust={() => setAdjusting(true)}
        pending={upload.isPending ? "choose" : remove.isPending ? "remove" : null}
        isDisabled={!online}
        error={error ? errorMessage(error) : null}
      />
      <PhotoFramer
        isOpen={adjusting && src !== null}
        onClose={() => {
          setAdjusting(false);
          frame.reset();
        }}
        src={src}
        aspect={4 / 5}
        framing={framingOr(profile.portraitFraming, PORTRAIT_FRAMING)}
        fallback={PORTRAIT_FRAMING}
        title="Adjust your team page photo"
        description="How it sits on the academy's website: the team page, and the home page's team."
        previews={[{ label: "Team page faces", aspect: 1, round: true }]}
        onSave={(framing) => frame.mutate(framing)}
        isSaving={frame.isPending}
        error={frame.error ? errorMessage(frame.error) : null}
      />
    </>
  );
}

function ProfileFields({
  profile,
  form,
}: {
  profile: CoachProfileDto;
  form: ReturnType<typeof useCoachProfileForm>;
}) {
  const { draft, set, update, err } = form;
  if (!draft) return null;
  const name = (
    <TextField
      label="Name shown"
      value={draft.displayName}
      onChange={(v) => set("displayName", v)}
      placeholder={profile.accountName}
      description="Leave empty to use the name on the account."
      error={err("displayName")}
    />
  );
  // The front desk doesn't coach and is never on the academy's pages: a name, a title, and a photo.
  if (!isCoachingRole(profile.role)) {
    return (
      <div className="flex flex-col gap-5">
        <CoachPhoto profile={profile} />
        <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
          {name}
          <TextField
            label="Title"
            value={draft.title}
            onChange={(v) => set("title", v)}
            placeholder="e.g. Front desk"
            error={err("title")}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <CoachPhoto profile={profile} />
      <CoachPortrait profile={profile} />
      <CoachingFields voice="you" draft={draft} set={update} err={err} name={name} />
      <div className="rounded-[22px] bg-panel px-4 py-2">
        <Switch
          isSelected={draft.isPublic}
          onChange={(v) => set("isPublic", v)}
          description="Your name, photos, title, about text, highlights, and coaching details (certifications, rating, specialties, languages, years coaching) can appear on the academy's public pages and to its students and parents. Your email never does."
        >
          Show on the academy page
        </Switch>
      </div>
    </div>
  );
}

/**
 * Settings: every staff member's own profile (a coach profile for people who coach; the front
 * desk's name, title, and photo).
 */
export function MyCoachProfileSection({ userId }: { userId: string }) {
  const online = useOnline();
  const isCoach = isCoachingRole(useMe().data?.role);
  const q = useCoachProfile(userId);
  const form = useCoachProfileForm(q.data);
  if (q.isPending) return <RowsSkeleton rows={3} />;
  if (!q.data) {
    return (
      <ErrorState
        title={isCoach ? "Couldn't load your coach profile" : "Couldn't load your profile"}
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

/**
 * Team: edit anyone's profile (people who manage the team), or your own. `role` (when known) words
 * the sheet before the profile loads: the front desk's is a profile, not a coach profile.
 */
export function CoachProfileSheet({
  userId,
  name,
  role,
  onClose,
}: {
  userId: string | null;
  name: string;
  role?: StaffRole;
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
      title={isCoachingRole(role ?? q.data?.role) ? "Coach profile" : "Profile"}
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
