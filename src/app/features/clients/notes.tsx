import type { NoteDto, ProgressDto } from "@shared/api-types";
import { uuidv7 } from "@shared/ids";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Ellipsis, NotebookPen, Pin } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, IconButton } from "../../components/ui/button";
import { Card, Pill } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { TextAreaField } from "../../components/ui/field";
import { ActionMenu, ConfirmSheet, Sheet } from "../../components/ui/overlay";
import { api, errorMessage } from "../../lib/api";
import { type Format, useFormat } from "../../lib/format";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys, type NoteVars } from "../../lib/query";
import { OfflineHint, SectionHead } from "./bits";
import { relativeDay } from "./client-utils";

const byPinnedThenNewest = (a: NoteDto, b: NoteDto) =>
  Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt;

/**
 * Saves a note about a client. Works offline: the note shows at once (marked waiting to sync)
 * and the queued request goes out when the connection returns.
 */
export function useAddNote(clientId: string) {
  const qc = useQueryClient();
  const online = useOnline();
  const create = useMutation<unknown, Error, NoteVars>({ mutationKey: ["notes", "create"] });
  return (body: string, firstName: string) => {
    const vars: NoteVars = { id: uuidv7(), clientId, body };
    const now = Date.now();
    qc.setQueryData<ProgressDto>(keys.progress(clientId), (old) =>
      old
        ? {
            ...old,
            notes: [
              {
                id: vars.id,
                clientId,
                lessonId: null,
                body,
                pinned: false,
                createdAt: now,
                updatedAt: now,
                pending: true,
              },
              ...old.notes,
            ].sort(byPinnedThenNewest),
          }
        : old,
    );
    create.mutate(vars);
    notify(
      online
        ? { tone: "success", title: "Note saved", body: `On ${firstName}'s profile.` }
        : {
            tone: "neutral",
            title: "Note saved offline",
            body: "It will sync when you're back online.",
          },
    );
  };
}

function useNoteWrites(clientId: string) {
  const qc = useQueryClient();
  const patchCache = (fn: (notes: NoteDto[]) => NoteDto[]) =>
    qc.setQueryData<ProgressDto>(keys.progress(clientId), (old) =>
      old ? { ...old, notes: fn(old.notes).sort(byPinnedThenNewest) } : old,
    );
  const update = useMutation({
    meta: { silent: true },
    mutationFn: (v: { id: string; body?: string; pinned?: boolean }) =>
      api.patch<NoteDto>(`/notes/${v.id}`, { body: v.body, pinned: v.pinned }),
    onSuccess: (note) => patchCache((notes) => notes.map((n) => (n.id === note.id ? note : n))),
  });
  const remove = useMutation({
    meta: { silent: true },
    mutationFn: (id: string) => api.del(`/notes/${id}`),
    onSuccess: (_d, id) => patchCache((notes) => notes.filter((n) => n.id !== id)),
  });
  return { update, remove };
}

export function noteWhen(n: NoteDto, fmt: Format) {
  const day = fmt.dayOf(n.createdAt);
  const rel = relativeDay(day, fmt.today());
  return rel === "Today" ? `Today, ${fmt.time(n.createdAt)}` : rel;
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
  const add = useAddNote(clientId);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        add(body.trim(), firstName);
        setBody("");
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
      <Button type="submit" variant="dark" size="sm" className="self-end" isDisabled={!body.trim()}>
        Save note
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
      description={`Only you see notes. They stay on ${firstName}'s profile.`}
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
  const fmt = useFormat();
  const online = useOnline();
  const { update } = useNoteWrites(clientId);
  const canWrite = online && !note.pending;
  return (
    <li className="flex items-start gap-3 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-ink-2">
          {note.pinned ? (
            <span className="inline-flex items-center gap-1 font-medium text-ink">
              <Pin aria-hidden className="size-3.5" />
              Pinned
            </span>
          ) : null}
          <span className="num">{noteWhen(note, fmt)}</span>
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
        <p className="mt-1.5 max-w-[65ch] whitespace-pre-line">{note.body}</p>
      </div>
      {onEdit && onDelete ? (
        <ActionMenu
          label="Note actions"
          trigger={
            <IconButton label="Note actions" size="md" isDisabled={!canWrite}>
              <Ellipsis aria-hidden className="size-5" />
            </IconButton>
          }
          actions={[
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
            { id: "edit", label: "Edit", onAction: () => onEdit(note) },
            { id: "delete", label: "Delete", tone: "danger", onAction: () => onDelete(note) },
          ]}
        />
      ) : null}
    </li>
  );
}

/** Every note about the client, pinned first, with the offline-capable composer on top. */
export function NotesCard({
  clientId,
  firstName,
  notes,
}: {
  clientId: string;
  firstName: string;
  notes: NoteDto[];
}) {
  const [editing, setEditing] = useState<NoteDto | null>(null);
  const [deleting, setDeleting] = useState<NoteDto | null>(null);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? notes : notes.slice(0, 8);
  return (
    <Card label="Notes">
      <SectionHead title="Notes" count={notes.length || undefined} />
      <div className="px-5 pb-2">
        <NoteComposer clientId={clientId} firstName={firstName} />
        {notes.length ? (
          <ol className="mt-3 flex flex-col divide-y divide-line border-t border-line">
            {shown.map((n) => (
              <NoteItem
                key={n.id}
                note={n}
                clientId={clientId}
                onEdit={setEditing}
                onDelete={setDeleting}
              />
            ))}
          </ol>
        ) : (
          <p className="mt-4 mb-3 flex items-center gap-2 text-ink-2">
            <NotebookPen aria-hidden className="size-4.5 shrink-0" />
            No notes yet. Notes from sessions land here too.
          </p>
        )}
        {notes.length > shown.length ? (
          <Button variant="ghost" size="sm" className="mb-3" onPress={() => setShowAll(true)}>
            Show {notes.length - shown.length} older notes
          </Button>
        ) : null}
      </div>
      <EditNoteSheet note={editing} clientId={clientId} onClose={() => setEditing(null)} />
      <DeleteNoteSheet note={deleting} clientId={clientId} onClose={() => setDeleting(null)} />
    </Card>
  );
}

function EditNoteSheet({
  note,
  clientId,
  onClose,
}: {
  note: NoteDto | null;
  clientId: string;
  onClose: () => void;
}) {
  const online = useOnline();
  const { update } = useNoteWrites(clientId);
  const [body, setBody] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed when a different note opens.
  useEffect(() => {
    if (note) {
      setBody(note.body);
      update.reset();
    }
  }, [note?.id]);
  const save = () =>
    note &&
    update.mutate(
      { id: note.id, body: body.trim() },
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
      title="Edit note"
      footer={
        <>
          <Button variant="light" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="dark"
            isDisabled={!online || !body.trim() || body.trim() === note?.body}
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
        {update.error ? <InlineError>{errorMessage(update.error)}</InlineError> : null}
        <OfflineHint>You're offline. New notes still save; edits need a connection.</OfflineHint>
      </div>
    </Sheet>
  );
}

function DeleteNoteSheet({
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
          <p>It's removed for good.</p>
          {remove.error ? <InlineError>{errorMessage(remove.error)}</InlineError> : null}
          <OfflineHint>You're offline. Reconnect to delete notes.</OfflineHint>
        </div>
      }
    />
  );
}
