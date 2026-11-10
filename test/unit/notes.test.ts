import { describe, expect, it } from "vitest";
import {
  canDeleteNote,
  canEditNote,
  canReadAssessment,
  canReadNote,
  canWriteCoaching,
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

describe("the front desk", () => {
  const staffOnly = { kind: "comment" as const, visibility: "staff" as const };
  const shared = { kind: "comment" as const, visibility: "shared" as const };
  const handoffNote = { kind: "handoff" as const, visibility: "staff" as const };

  it("reads only the notes the family reads", () => {
    expect(canReadNote("front_desk", shared)).toBe(true);
    expect(canReadNote("front_desk", staffOnly)).toBe(false);
    expect(canReadNote("front_desk", handoffNote)).toBe(false);
    // A handoff note is never shared, whatever it says.
    expect(canReadNote("front_desk", { kind: "handoff", visibility: "shared" })).toBe(false);
  });

  it("reads only the assessments shared with the family", () => {
    expect(canReadAssessment("front_desk", { sharedWithFamily: true })).toBe(true);
    expect(canReadAssessment("front_desk", { sharedWithFamily: false })).toBe(false);
  });

  it("writes no coaching notes, assessments, or goals", () => {
    expect(canWriteCoaching("front_desk")).toBe(false);
  });

  it("leaves people who coach reading and writing everything", () => {
    for (const role of ["owner", "admin", "coach"]) {
      expect(canWriteCoaching(role)).toBe(true);
      expect(canReadNote(role, staffOnly)).toBe(true);
      expect(canReadNote(role, handoffNote)).toBe(true);
      expect(canReadAssessment(role, { sharedWithFamily: false })).toBe(true);
    }
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
    // The front desk deletes no notes, even one they wrote while they coached.
    expect(canDeleteNote({ userId: "desk", role: "front_desk" }, comment)).toBe(false);
    expect(canDeleteNote({ userId: "desk", role: "front_desk" }, { createdBy: "desk" })).toBe(
      false,
    );
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
