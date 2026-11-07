import { describe, expect, it } from "vitest";
import {
  canDeleteNote,
  canEditNote,
  isFamilyVisible,
  noteVisibilityFor,
  planNoteUpdate,
} from "../../src/shared/notes";
import { noteSchema } from "../../src/shared/schemas";

const comment = {
  createdBy: "sam",
  kind: "comment" as const,
  visibility: "staff" as const,
  body: "Work on the third-shot drop.",
};
const handoff = { ...comment, kind: "handoff" as const };
const NOW = 1_800_000_000_000;

describe("note visibility", () => {
  it("is coaches-only unless the author shares it", () => {
    expect(noteVisibilityFor("comment", undefined)).toBe("staff");
    expect(noteVisibilityFor("comment", null)).toBe("staff");
    expect(noteVisibilityFor("comment", "shared")).toBe("shared");
  });

  it("forces handoff notes to coaches-only", () => {
    expect(noteVisibilityFor("handoff", "shared")).toBe("staff");
    expect(noteVisibilityFor("handoff", undefined)).toBe("staff");
  });

  it("shows families only shared comments, never handoffs", () => {
    expect(isFamilyVisible({ kind: "comment", visibility: "shared" })).toBe(true);
    expect(isFamilyVisible({ kind: "comment", visibility: "staff" })).toBe(false);
    expect(isFamilyVisible({ kind: "handoff", visibility: "shared" })).toBe(false);
  });

  it("needs a student for a handoff note", () => {
    const lessonId = "0190f0c0-0000-7000-8000-000000000001";
    const clientId = "0190f0c0-0000-7000-8000-000000000002";
    expect(noteSchema.safeParse({ lessonId, body: "x", kind: "handoff" }).success).toBe(false);
    expect(noteSchema.safeParse({ clientId, body: "x", kind: "handoff" }).success).toBe(true);
    expect(noteSchema.safeParse({ lessonId, body: "x", visibility: "everyone" }).success).toBe(
      false,
    );
  });
});

describe("who may change a note", () => {
  it("lets only the author edit", () => {
    expect(canEditNote("sam", comment)).toBe(true);
    expect(canEditNote("kim", comment)).toBe(false);
    expect(canEditNote("sam", { createdBy: null })).toBe(false);
  });

  it("lets the author or an owner or admin delete", () => {
    expect(canDeleteNote({ userId: "sam", role: "coach" }, comment)).toBe(true);
    expect(canDeleteNote({ userId: "kim", role: "coach" }, comment)).toBe(false);
    expect(canDeleteNote({ userId: "boss", role: "owner" }, comment)).toBe(true);
    expect(canDeleteNote({ userId: "boss", role: "admin" }, comment)).toBe(true);
    expect(canDeleteNote({ userId: "boss", role: "member" }, comment)).toBe(false);
  });

  it("marks a note edited when its author changes the words or who sees it", () => {
    expect(planNoteUpdate("sam", comment, { body: "Drop, then reset." }, NOW)).toEqual({
      ok: true,
      set: { body: "Drop, then reset.", editedAt: NOW },
    });
    expect(planNoteUpdate("sam", comment, { visibility: "shared" }, NOW)).toEqual({
      ok: true,
      set: { visibility: "shared", editedAt: NOW },
    });
    // Saving the same words changes nothing.
    expect(planNoteUpdate("sam", comment, { body: comment.body }, NOW)).toEqual({
      ok: true,
      set: {},
    });
  });

  it("refuses edits from anyone but the author", () => {
    const res = planNoteUpdate("kim", comment, { body: "Mine now" }, NOW);
    expect(res.ok).toBe(false);
    expect(planNoteUpdate("boss", comment, { visibility: "shared" }, NOW).ok).toBe(false);
  });

  it("lets any coach pin, without marking the note edited", () => {
    expect(planNoteUpdate("kim", comment, { pinned: true }, NOW)).toEqual({
      ok: true,
      set: { pinned: true },
    });
  });

  it("keeps a handoff note coaches-only even when its author asks to share it", () => {
    expect(planNoteUpdate("sam", handoff, { visibility: "shared" }, NOW)).toEqual({
      ok: true,
      set: {},
    });
  });
});
