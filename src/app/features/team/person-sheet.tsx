import type { TeamPersonDto } from "@shared/api-types";
import { framingOr, type PhotoFraming, PORTRAIT_FRAMING, sameFraming } from "@shared/framing";
import { type TeamPersonInput, teamPersonSchema } from "@shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { PhotoFramer } from "../../components/domain/photo-framer";
import { Button } from "../../components/ui/button";
import { ErrorState, InlineError, RowsSkeleton } from "../../components/ui/feedback";
import { Switch, TextField } from "../../components/ui/field";
import { ConfirmSheet, Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors, fileUrl } from "../../lib/api";
import { putImage } from "../../lib/images";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import {
  COACHING_FRIENDLY,
  type CoachingDraft,
  CoachingFields,
  coachingDraftOf,
  coachingInput,
} from "../coaches/coaching-fields";
import { PortraitField, preparePortrait } from "../coaches/portrait";
import { OfflineNote } from "../settings/offline";
import { changedFields, issuesToFields } from "../settings/validation";
import { useRefreshTeamPage, useTeamPerson } from "./queries";

interface Draft extends CoachingDraft {
  name: string;
  isPublic: boolean;
}

function draftOf(p: TeamPersonDto | undefined): Draft {
  if (p) return { name: p.name, ...coachingDraftOf(p), isPublic: p.isPublic };
  return {
    name: "",
    ...coachingDraftOf({
      title: null,
      bio: null,
      certifications: [],
      highlights: [],
      specialties: [],
      languages: [],
      duprRating: null,
      yearsCoaching: null,
    }),
    isPublic: true,
  };
}

function toInput(d: Draft) {
  return { name: d.name, ...coachingInput(d), isPublic: d.isPublic };
}

/** Two framings that place a photo the same way (none counts as one). */
const sameOrNone = (a: PhotoFraming | null, b: PhotoFraming | null) =>
  a === null || b === null ? a === b : sameFraming(a, b);

const FRIENDLY: Record<string, string> = {
  name: "Add their name, up to 80 characters.",
  ...COACHING_FRIENDLY,
};

/** Who the sheet is for: someone on the page (`id`), or someone new (`id: null`). */
export interface PersonTarget {
  id: string | null;
  name: string;
}

/**
 * Adds or edits someone on the team page who doesn't sign in to CoachMan: the coach profile's
 * fields (without account things), their team page photo, and whether the page shows them. A new
 * person is saved first and their photo uploaded right after, in one press; if the photo fails,
 * they stay added and the sheet carries on as an edit, so saving again retries it. Render it with
 * a new `key` for each person it opens for.
 */
export function TeamPersonSheet({
  target,
  onClose,
}: {
  target: PersonTarget | null;
  onClose: () => void;
}) {
  const online = useOnline();
  const qc = useQueryClient();
  const refresh = useRefreshTeamPage();
  const [createdId, setCreatedId] = useState<string | null>(null);
  const id = target?.id ?? createdId;
  const q = useTeamPerson(target ? id : null);
  const person = id ? q.data : undefined;
  const [draft, setDraft] = useState<Draft>(() => draftOf(undefined));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [dropPhoto, setDropPhoto] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The photo's framing while editing: undefined keeps the saved one (null = the default).
  const [framing, setFraming] = useState<PhotoFraming | null | undefined>(undefined);
  const [adjusting, setAdjusting] = useState(false);

  // Seed the form from the saved person once they load, and again after each save.
  const seed = person ? JSON.stringify(draftOf(person)) : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed when the saved person changes.
  useEffect(() => {
    if (person) setDraft(draftOf(person));
  }, [seed]);
  useEffect(() => () => (photo ? URL.revokeObjectURL(photo.url) : undefined), [photo]);

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErrors((e) =>
      Object.keys(patch).some((k) => k in e)
        ? Object.fromEntries(Object.entries(e).filter(([k]) => !(k in patch)))
        : e,
    );
  };
  const err = (k: string) => errors[k];

  const choose = async (file: File) => {
    setPreparing(true);
    setPhotoError(null);
    try {
      const blob = await preparePortrait(file);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
      setDropPhoto(false);
      // A new photo starts at the default framing: offer to line it up right away.
      setFraming(null);
      setAdjusting(true);
    } catch (e) {
      setPhotoError(errorMessage(e));
    } finally {
      setPreparing(false);
    }
  };

  const save = useMutation({
    meta: { silent: true },
    mutationFn: async (v: {
      input: Partial<TeamPersonInput>;
      photo: Blob | null;
      dropPhoto: boolean;
      /** The photo's framing to keep (undefined: as saved). */
      framing: PhotoFraming | null | undefined;
    }) => {
      let saved: TeamPersonDto;
      const created = !id;
      if (!id) {
        saved = await api.post<TeamPersonDto>("/team-page/people", v.input);
        // They're on the page now, whatever happens to the photo.
        qc.setQueryData(keys.teamPerson(saved.id), saved);
        setCreatedId(saved.id);
        refresh();
      } else if (Object.keys(v.input).length || !person) {
        saved = await api.patch<TeamPersonDto>(`/team-page/people/${id}`, v.input);
      } else {
        saved = person;
      }
      if (v.photo) {
        const { portraitKey } = await putImage<{ portraitKey: string }>(
          `/team-page/people/${saved.id}/portrait`,
          v.photo,
        );
        // A new photo starts unframed on the server.
        saved = { ...saved, portraitKey, portraitFraming: null };
      } else if (v.dropPhoto && saved.portraitKey) {
        await api.del(`/team-page/people/${saved.id}/portrait`);
        saved = { ...saved, portraitKey: null, portraitFraming: null };
      }
      if (
        v.framing !== undefined &&
        saved.portraitKey &&
        !sameOrNone(v.framing, saved.portraitFraming)
      ) {
        saved = await api.patch<TeamPersonDto>(`/team-page/people/${saved.id}`, {
          portraitFraming: v.framing,
        });
      }
      return { saved, created };
    },
    onSuccess: ({ saved, created }) => {
      refresh(saved);
      notify({
        tone: "success",
        title: created ? `${saved.name} added` : `${saved.name} saved`,
        body: created
          ? saved.isPublic
            ? "They show on the team page."
            : "Hidden from the team page until you show them."
          : undefined,
      });
      onClose();
    },
    // The server's field errors join the form's own, so editing a field clears them.
    onError: (e) => setErrors(fieldErrors(e)),
  });

  const remove = useMutation({
    meta: { silent: true },
    mutationFn: (personId: string) => api.del(`/team-page/people/${personId}`),
    onSuccess: (_d, personId) => {
      qc.removeQueries({ queryKey: keys.teamPerson(personId) });
      refresh();
      notify({
        tone: "neutral",
        title: `${person?.name ?? target?.name ?? "They"} deleted`,
        body: "They're off the team page, with their photo.",
      });
      setConfirmDelete(false);
      onClose();
    },
    onError: () => setConfirmDelete(false),
  });

  const submit = () => {
    if (save.isPending || preparing) return;
    // Check everything the form shows, then send what's new (all of it for someone new).
    const parsed = teamPersonSchema.safeParse(toInput(draft));
    if (!parsed.success) {
      setErrors(issuesToFields(parsed.error.issues, FRIENDLY));
      return;
    }
    setErrors({});
    let input: Partial<TeamPersonInput> = parsed.data;
    if (id && person) {
      const before = teamPersonSchema.safeParse(toInput(draftOf(person)));
      input = changedFields(parsed.data, before.success ? before.data : {});
      const reframed =
        framing !== undefined && !sameOrNone(framing, person.portraitFraming ?? null);
      if (!Object.keys(input).length && !photo && !(dropPhoto && person.portraitKey) && !reframed) {
        onClose();
        return;
      }
    }
    save.mutate({ input, photo: photo?.blob ?? null, dropPhoto, framing });
  };

  const name = person?.name ?? target?.name ?? "";
  // The sheet keeps its title while a new person is saved (their photo uploads after).
  const editing = Boolean(target?.id);
  const shown = photo?.url ?? (dropPhoto ? null : fileUrl(person?.portraitKey));
  const shownFraming =
    framing !== undefined ? framing : photo ? null : (person?.portraitFraming ?? null);
  const loading = id !== null && q.isPending;
  const saveError =
    save.error && !Object.keys(fieldErrors(save.error)).length
      ? createdId && !target?.id
        ? `${errorMessage(save.error)} ${draft.name.trim()} was added without the photo. Save to try the photo again.`
        : errorMessage(save.error)
      : null;

  return (
    <>
      <Sheet
        isOpen={target !== null}
        onOpenChange={(o) => !o && onClose()}
        size="lg"
        title={editing ? `Edit ${name}` : "Add a person"}
        description={
          editing
            ? "On your team page. They don't sign in to CoachMan."
            : "Someone your team page shows who doesn't sign in to CoachMan, like a guest coach."
        }
        footer={
          <>
            {id ? (
              <Button
                variant="ghost"
                className="mr-auto"
                icon={<Trash2 aria-hidden className="size-4.5" />}
                isDisabled={!online || !person || save.isPending}
                onPress={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            ) : null}
            <Button variant="light" onPress={onClose}>
              Cancel
            </Button>
            <Button
              variant="dark"
              isDisabled={!online || loading || (id !== null && !person) || preparing}
              isPending={save.isPending}
              onPress={submit}
            >
              {editing || (id && !save.isPending) ? "Save" : "Add person"}
            </Button>
          </>
        }
      >
        {loading ? (
          <RowsSkeleton rows={4} />
        ) : id !== null && !person ? (
          <ErrorState
            title="Couldn't load this person"
            message={errorMessage(q.error)}
            onRetry={() => void q.refetch()}
          />
        ) : (
          <form
            noValidate
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (online) submit();
            }}
          >
            <PortraitField
              src={shown}
              framing={shownFraming}
              onChoose={(file) => void choose(file)}
              onRemove={() => {
                setPhoto(null);
                setDropPhoto(true);
                setFraming(undefined);
              }}
              onAdjust={() => setAdjusting(true)}
              pending={preparing ? "choose" : null}
              isDisabled={save.isPending}
              error={photoError}
            />
            <CoachingFields
              voice="they"
              draft={draft}
              set={update}
              err={err}
              name={
                <TextField
                  label="Name"
                  value={draft.name}
                  onChange={(v) => update({ name: v })}
                  autoComplete="off"
                  autoFocus={!id}
                  error={err("name")}
                />
              }
            />
            <div className="rounded-[22px] bg-panel px-4 py-2">
              <Switch
                isSelected={draft.isPublic}
                onChange={(v) => update({ isPublic: v })}
                description="Their name, photo, title, about text, highlights, and coaching details can appear on the academy's public pages."
              >
                Show on the team page
              </Switch>
            </div>
            {saveError ? <InlineError>{saveError}</InlineError> : null}
            {remove.error ? <InlineError>{errorMessage(remove.error)}</InlineError> : null}
            <OfflineNote />
            <button type="submit" hidden />
          </form>
        )}
      </Sheet>
      <PhotoFramer
        isOpen={adjusting && shown !== null}
        onClose={() => setAdjusting(false)}
        src={shown}
        aspect={4 / 5}
        framing={framingOr(shownFraming, PORTRAIT_FRAMING)}
        fallback={PORTRAIT_FRAMING}
        title={name ? `Adjust ${name}'s photo` : "Adjust the photo"}
        description="How it sits on the team page. It's kept when you save."
        previews={[{ label: "Team page faces", aspect: 1, round: true }]}
        saveLabel="Done"
        onSave={(next) => {
          setFraming(next);
          setAdjusting(false);
        }}
      />
      {id ? (
        <ConfirmSheet
          isOpen={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete ${name}?`}
          body="They come off the team page right away, with their photo. This can't be undone."
          confirmLabel="Delete"
          isPending={remove.isPending}
          onConfirm={() => online && remove.mutate(id)}
        />
      ) : null}
    </>
  );
}
