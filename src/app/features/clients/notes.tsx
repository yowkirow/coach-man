import type { NoteDto, ProgressDto } from "@shared/api-types";
import type { NoteKind, NoteVisibility } from "@shared/domain";
import { uuidv7 } from "@shared/ids";
import { canDeleteNote, canEditNote } from "@shared/notes";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Ellipsis, Pin } from "lucide-react";
import { useEffect, useState } from "react";
import { CoachAvatar } from "../../components/domain/coaches";
import { Button, IconButton } from "../../components/ui/button";
import { Pill } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { Switch, TextAreaField } from "../../components/ui/field";
import { ActionMenu, ConfirmSheet, Sheet } from "../../components/ui/overlay";
import { api, errorMessage } from "../../lib/api";
import { type Format, useFormat } from "../../lib/format";
import { useMe } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys, type NoteVars, optimisticNote } from "../../lib/query";
import { OfflineHint } from "./bits";
import { relativeDay } from "./client-utils";

export const byPinnedThenNewest = (a: NoteDto, b: NoteDto) =>
  Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt;

/**
 * Saves a note about a client. Works offline: the note shows at once (marked waiting to sync)
 * and the queued request goes out when the connection returns. Notes are coaches-only unless
 * shared; handoff notes always stay with the coaches.
 */
export function useAddNote(clientId: string) {
  const qc = useQueryClient();
  const online = useOnline();
  const create = useMutation<unknown, Error, NoteVars>({ mutationKey: ["notes", "create"] });
  return (
    body: string,
    firstName: string,
    opts: { visibility?: NoteVisibility; kind?: NoteKind } = {},
  ) => {
    const vars: NoteVars = { id: uuidv7(), clientId, body, ...opts };
    qc.setQueryData<ProgressDto>(keys.progress(clientId), (old) =>
      old ? { ...old, notes: [optimisticNote(vars), ...old.notes].sort(byPinnedThenNewest) } : old,
    );
    create.mutate(vars);
    const title = opts.kind === "handoff" ? "Handoff note saved" : "Note saved";
    notify(
      online
        ? {
            tone: "success",
            title,
            body:
              opts.visibility === "shared"
                ? `On ${firstName}'s profile, shared with ${firstName} and their parents.`
                : `On ${firstName}'s profile, for coaches only.`,
          }
        : {
            tone: "neutral",
            title: `${title} offline`,
            body: "It will sync when you're back online.",
          },
    );
  };
}

export function useNoteWrites(clientId: string) {
  const qc = useQueryClient();
  const patchCache = (fn: (notes: NoteDto[]) => NoteDto[]) =>
    qc.setQueryData<ProgressDto>(keys.progress(clientId), (old) =>
      old ? { ...old, notes: fn(old.notes).sort(byPinnedThenNewest) } : old,
    );
  const update = useMutation({
    meta: { silent: true },
    mutationFn: (v: { id: string; body?: string; pinned?: boolean; visibility?: NoteVisibility }) =>
      api.patch<NoteDto>(`/notes/${v.id}`, {
        body: v.body,
        pinned: v.pinned,
        visibility: v.visibility,
      }),
    onSuccess: (note) => patchCache((notes) => notes.map((n) => (n.id === note.id ? note : n))),
  });
  const remove = useMutation({
    meta: { silent: true },
    mutationFn: (id: string) => api.del(`/notes/${id}`),
    onSuccess: (_d, id) => patchCache((notes) => notes.filter((n) => n.id !== id)),
  });
  return { update, remove };
}

export function noteWhen(n: Pick<NoteDto, "createdAt">, fmt: Format) {
  const day = fmt.dayOf(n.createdAt);
  const rel = relativeDay(day, fmt.today());
  return rel === "Today" ? `Today, ${fmt.time(n.createdAt)}` : rel;
}

/** The explicit "Share with student & parents" control, saying what each setting means. */
export function ShareSwitch({
  isSelected,
  onChange,
  firstName,
}: {
  isSelected: boolean;
  onChange: (v: boolean) => void;
  firstName: string;
}) {
  return (
    <div className="rounded-[22px] bg-panel px-4 py-1.5">
      <Switch
        isSelected={isSelected}
        onChange={onChange}
        description={
          isSelected
            ? `${firstName} and their parents can read this note in the family portal. Coaches always see it.`
            : `Only coaches see this note. Turn this on to also show it to ${firstName} and their parents in the family portal.`
        }
      >
        Share with student & parents
      </Switch>
    </div>
  );
}

/** Composer for a quick note. Saving clears it; it never blocks on the network. */
export function NoteComposer({
  clientId,
  firstName,
  autoFocus,
  onSaved,
  rows = 3,
}: {
  clientId: string;
  firstName: string;
  autoFocus?: boolean;
  onSaved?: () => void;
  rows?: number;
}) {
  const [body, setBody] = useState("");
  const [shared, setShared] = useState(false);
  const add = useAddNote(clientId);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        add(body.trim(), firstName, { visibility: shared ? "shared" : "staff" });
        setBody("");
        setShared(false);
        onSaved?.();
      }}
    >
      <TextAreaField
        label={`Note about ${firstName}`}
        rows={rows}
        autoFocus={autoFocus}
        value={body}
        onChange={setBody}
        placeholder="What clicked today, what to work on next…"
        description="Notes save even without signal and sync later."
      />
      <ShareSwitch isSelected={shared} onChange={setShared} firstName={firstName} />
      <Button type="submit" variant="dark" size="sm" className="self-end" isDisabled={!body.trim()}>
        {shared ? "Save and share" : "Save note"}
      </Button>
    </form>
  );
}

/** The quick "Add note" action from the header circles. */
export function NoteSheet({
  isOpen,
  onOpenChange,
  clientId,
  firstName,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  firstName: string;
}) {
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Add a note"
      description={`Every coach at the academy can read notes on ${firstName}'s profile. Share one with ${firstName} and their parents when it helps them.`}
    >
      <NoteComposer
        clientId={clientId}
        firstName={firstName}
        autoFocus
        rows={5}
        onSaved={() => onOpenChange(false)}
      />
    </Sheet>
  );
}

/** Who wrote a note, when, and who can see it. */
export function NoteByline({ note }: { note: NoteDto }) {
  const fmt = useFormat();
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-ink-2">
      {note.author ? (
        <span className="inline-flex items-center gap-1.5 font-medium text-ink">
          <CoachAvatar coach={note.author} size="xs" />
          {note.author.name}
        </span>
      ) : null}
      <span className="num">{noteWhen(note, fmt)}</span>
      {note.editedAt ? (
        <span title={`Edited ${fmt.date(fmt.dayOf(note.editedAt))}, ${fmt.time(note.editedAt)}`}>
          · Edited
        </span>
      ) : null}
      {note.pinned ? (
        <span className="inline-flex items-center gap-1 font-medium text-ink">
          <Pin aria-hidden className="size-3.5" />
          Pinned
        </span>
      ) : null}
      {note.kind === "handoff" ? <Pill tone="outline">Handoff · coaches only</Pill> : null}
      {note.visibility === "shared" && note.kind !== "handoff" ? (
        <Pill tone="sky">Shared with family</Pill>
      ) : null}
      {note.lessonId ? (
        <Link
          to="/sessions/$lessonId"
          params={{ lessonId: note.lessonId }}
          className="rounded-full outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink"
        >
          From a session
        </Link>
      ) : null}
      {note.pending ? <Pill tone="amber">Waiting to sync</Pill> : null}
    </div>
  );
}

export function NoteItem({
  note,
  clientId,
  onEdit,
  onDelete,
}: {
  note: NoteDto;
  clientId: string;
  onEdit?: (n: NoteDto) => void;
  onDelete?: (n: NoteDto) => void;
}) {
  const me = useMe().data;
  const online = useOnline();
  const { update } = useNoteWrites(clientId);
  const canWrite = online && !note.pending;
  const actor = { userId: me?.user.id ?? "", role: me?.role ?? "coach" };
  const actions =
    onEdit && onDelete
      ? [
          {
            id: "pin",
            label: note.pinned ? "Unpin" : "Pin to top",
            onAction: () =>
              update.mutate(
                { id: note.id, pinned: !note.pinned },
                {
                  onError: (err) =>
                    notify({
                      tone: "danger",
                      title: "Couldn't update the note",
                      body: errorMessage(err),
                    }),
                },
              ),
          },
          ...(canEditNote(actor.userId, note)
            ? [{ id: "edit", label: "Edit", onAction: () => onEdit(note) }]
            : []),
          ...(canDeleteNote(actor, note)
            ? [
                {
                  id: "delete",
                  label: "Delete",
                  tone: "danger" as const,
                  onAction: () => onDelete(note),
                },
              ]
            : []),
        ]
      : [];
  return (
    <li className="flex items-start gap-3 py-3.5">
      <div className="min-w-0 flex-1">
        <NoteByline note={note} />
        <p className="mt-1.5 max-w-[65ch] whitespace-pre-line">{note.body}</p>
      </div>
      {actions.length ? (
        <ActionMenu
          label="Note actions"
          trigger={
            <IconButton label="Note actions" size="md" isDisabled={!canWrite}>
              <Ellipsis aria-hidden className="size-5" />
            </IconButton>
          }
          actions={actions}
        />
      ) : null}
    </li>
  );
}

/** Edit a note's words, and whether the student and parents see it (the author only). */
export function EditNoteSheet({
  note,
  clientId,
  firstName,
  onClose,
}: {
  note: NoteDto | null;
  clientId: string;
  firstName: string;
  onClose: () => void;
}) {
  const online = useOnline();
  const { update } = useNoteWrites(clientId);
  const [body, setBody] = useState("");
  const [shared, setShared] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed when a different note opens.
  useEffect(() => {
    if (note) {
      setBody(note.body);
      setShared(note.visibility === "shared");
      update.reset();
    }
  }, [note?.id]);
  const handoff = note?.kind === "handoff";
  const visibility: NoteVisibility = !handoff && shared ? "shared" : "staff";
  const changed = Boolean(note && (body.trim() !== note.body || visibility !== note.visibility));
  const save = () =>
    note &&
    update.mutate(
      { id: note.id, body: body.trim(), visibility: handoff ? undefined : visibility },
      {
        onSuccess: () => {
          notify({ tone: "success", title: "Note updated" });
          onClose();
        },
      },
    );
  return (
    <Sheet
      isOpen={note !== null}
      onOpenChange={(o) => !o && onClose()}
      title={handoff ? "Edit handoff note" : "Edit note"}
      footer={
        <>
          <Button variant="light" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="dark"
            isDisabled={!online || !body.trim() || !changed}
            isPending={update.isPending}
            onPress={save}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextAreaField label="Note" rows={6} autoFocus value={body} onChange={setBody} />
        {handoff ? (
          <p className="rounded-2xl bg-panel px-4 py-3 text-[0.875rem] text-ink-2">
            Handoff notes are for coaches only. {firstName} and their parents never see them.
          </p>
        ) : (
          <ShareSwitch isSelected={shared} onChange={setShared} firstName={firstName} />
        )}
        {update.error ? <InlineError>{errorMessage(update.error)}</InlineError> : null}
        <OfflineHint>You're offline. New notes still save; edits need a connection.</OfflineHint>
      </div>
    </Sheet>
  );
}

export function DeleteNoteSheet({
  note,
  clientId,
  onClose,
}: {
  note: NoteDto | null;
  clientId: string;
  onClose: () => void;
}) {
  const online = useOnline();
  const { remove } = useNoteWrites(clientId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear old errors when a note opens.
  useEffect(() => {
    if (note) remove.reset();
  }, [note?.id]);
  return (
    <ConfirmSheet
      isOpen={note !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Delete this note?"
      confirmLabel="Delete note"
      isPending={remove.isPending}
      onConfirm={() => {
        if (!note || !online) return;
        remove.mutate(note.id, {
          onSuccess: () => {
            notify({ tone: "neutral", title: "Note deleted" });
            onClose();
          },
        });
      }}
      body={
        <div className="flex flex-col gap-3">
          <p className="line-clamp-4 rounded-2xl bg-panel px-4 py-3 text-ink">{note?.body}</p>
          <p>
            It's removed for good
            {note?.author ? `, including for ${note.author.name}, who wrote it` : ""}.
          </p>
          {remove.error ? <InlineError>{errorMessage(remove.error)}</InlineError> : null}
          <OfflineHint>You're offline. Reconnect to delete notes.</OfflineHint>
        </div>
      }
    />
  );
}
