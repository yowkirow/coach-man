// Coach comments: who may change a note, and who may ever see it. Notes are coaches-only unless
// their author shares them; handoff notes (written when a student's primary coach changes) are
// always coaches-only. The Worker enforces these rules; the app uses them to offer the right actions.

import type { NoteKind, NoteVisibility } from "./domain";
import { normalizeRole } from "./roles";

export interface NoteRef {
  createdBy: string | null;
  kind: NoteKind;
  visibility: NoteVisibility;
  body: string;
}

/** The visibility a note is stored with: handoff notes are forced to coaches only. */
export function noteVisibilityFor(
  kind: NoteKind,
  requested: NoteVisibility | null | undefined,
): NoteVisibility {
  return kind === "handoff" ? "staff" : (requested ?? "staff");
}

/** Owners and admins look after the academy's records (they may delete anyone's note). */
export function isAcademyAdmin(role: string | null | undefined): boolean {
  const r = normalizeRole(role);
  return r === "owner" || r === "admin";
}

/** Only the author changes what a note says or who sees it. */
export function canEditNote(actorId: string, note: Pick<NoteRef, "createdBy">): boolean {
  return Boolean(note.createdBy) && note.createdBy === actorId;
}

/** The author, or the academy's owners and admins. */
export function canDeleteNote(
  actor: { userId: string; role: string },
  note: Pick<NoteRef, "createdBy">,
): boolean {
  return canEditNote(actor.userId, note) || isAcademyAdmin(actor.role);
}

/** What a student and their parents may read: shared comments only, never handoffs. */
export function isFamilyVisible(note: Pick<NoteRef, "kind" | "visibility">): boolean {
  return note.kind !== "handoff" && note.visibility === "shared";
}

export type NoteUpdatePlan =
  | {
      ok: true;
      set: { body?: string; pinned?: boolean; visibility?: NoteVisibility; editedAt?: number };
    }
  | { ok: false; message: string };

/**
 * Turns a PATCH into the update to store. Pinning is open to every coach (it changes no words);
 * text and visibility are the author's alone, and changing either marks the note edited.
 */
export function planNoteUpdate(
  actorId: string,
  note: NoteRef,
  patch: { body?: string; pinned?: boolean; visibility?: NoteVisibility },
  now: number,
): NoteUpdatePlan {
  const set: { body?: string; pinned?: boolean; visibility?: NoteVisibility; editedAt?: number } =
    {};
  if (patch.pinned !== undefined) set.pinned = patch.pinned;
  if (patch.body === undefined && patch.visibility === undefined) return { ok: true, set };
  if (!canEditNote(actorId, note)) {
    return { ok: false, message: "Only the coach who wrote this note can change it." };
  }
  let changed = false;
  if (patch.body !== undefined && patch.body !== note.body) {
    set.body = patch.body;
    changed = true;
  }
  if (patch.visibility !== undefined) {
    const visibility = noteVisibilityFor(note.kind, patch.visibility);
    if (visibility !== note.visibility) {
      set.visibility = visibility;
      changed = true;
    }
  }
  if (changed) set.editedAt = now;
  return { ok: true, set };
}
