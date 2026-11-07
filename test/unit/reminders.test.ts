import { describe, expect, it } from "vitest";
import {
  digestScope,
  digestSessions,
  isRecipient,
  sessionRecipients,
} from "../../src/worker/services/reminders";

const team = [
  { userId: "owner", role: "owner" },
  { userId: "admin", role: "admin" },
  { userId: "sam", role: "coach" },
  { userId: "kim", role: "member" },
];

describe("session reminder recipients", () => {
  it("goes to the lead coach and the assistants", () => {
    expect(sessionRecipients({ coachUserId: "sam", assistantCoachIds: ["kim"] }, team)).toEqual([
      "sam",
      "kim",
    ]);
    expect(sessionRecipients({ coachUserId: "sam", assistantCoachIds: [] }, team)).toEqual(["sam"]);
    // An owner who coaches the session hears about it as its coach.
    expect(sessionRecipients({ coachUserId: "owner", assistantCoachIds: [] }, team)).toEqual([
      "owner",
    ]);
  });

  it("falls back to owners and admins when nobody coaches it", () => {
    expect(sessionRecipients({ coachUserId: null, assistantCoachIds: [] }, team)).toEqual([
      "owner",
      "admin",
    ]);
  });

  it("treats coaches who left the team as no coach", () => {
    expect(
      sessionRecipients({ coachUserId: "gone", assistantCoachIds: ["also-gone"] }, team),
    ).toEqual(["owner", "admin"]);
    expect(sessionRecipients({ coachUserId: "gone", assistantCoachIds: ["kim"] }, team)).toEqual([
      "kim",
    ]);
  });

  it("never names anyone twice", () => {
    expect(
      sessionRecipients({ coachUserId: "sam", assistantCoachIds: ["sam", "kim", "kim"] }, team),
    ).toEqual(["sam", "kim"]);
    expect(
      sessionRecipients({ coachUserId: null, assistantCoachIds: [] }, [
        ...team,
        { userId: "owner", role: "owner" },
      ]),
    ).toEqual(["owner", "admin"]);
  });

  it("answers per person", () => {
    const session = { coachUserId: "sam", assistantCoachIds: [] };
    expect(isRecipient(session, "sam", team)).toBe(true);
    expect(isRecipient(session, "owner", team)).toBe(false);
    expect(isRecipient({ coachUserId: null, assistantCoachIds: [] }, "sam", team)).toBe(false);
  });
});

describe("daily digests", () => {
  const sessions = [
    { id: "a", coachUserId: "sam", assistantCoachIds: [] },
    { id: "b", coachUserId: "kim", assistantCoachIds: ["sam"] },
    { id: "c", coachUserId: null, assistantCoachIds: [] },
    { id: "d", coachUserId: "owner", assistantCoachIds: [] },
  ];

  it("gives owners and admins the whole academy", () => {
    expect(digestScope("owner")).toBe("academy");
    expect(digestScope("admin,member")).toBe("academy");
    expect(
      digestSessions(sessions, { userId: "admin", role: "admin" }, team).map((s) => s.id),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("gives a coach the sessions they lead or assist", () => {
    expect(digestScope("coach")).toBe("own");
    expect(digestScope("member")).toBe("own");
    expect(
      digestSessions(sessions, { userId: "sam", role: "coach" }, team).map((s) => s.id),
    ).toEqual(["a", "b"]);
    expect(
      digestSessions(sessions, { userId: "kim", role: "member" }, team).map((s) => s.id),
    ).toEqual(["b"]);
  });
});
