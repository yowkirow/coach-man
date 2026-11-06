import { describe, expect, it } from "vitest";
import {
  clearEnrollDrafts,
  type DraftStore,
  ENROLL_DRAFT_PREFIX,
} from "../../src/app/lib/enroll-drafts";

function memoryStore(entries: Record<string, string>): DraftStore & { keys: () => string[] } {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    removeItem: (key) => void map.delete(key),
    keys: () => [...map.keys()].sort(),
  };
}

const draft = (userId: string | null) => JSON.stringify({ v: 1, userId, step: "who" });

describe("enrollment drafts on a shared device", () => {
  const device = () =>
    memoryStore({
      [`${ENROLL_DRAFT_PREFIX}pickle-spot:tier-a`]: draft("parent-a"),
      [`${ENROLL_DRAFT_PREFIX}pickle-spot:tier-b`]: draft("parent-a"),
      [`${ENROLL_DRAFT_PREFIX}pickle-spot:tier-c`]: draft("parent-b"),
      [`${ENROLL_DRAFT_PREFIX}other-club:tier-a`]: "{not json",
      "coachman-cache-owner": "parent-a",
      "unrelated-app:key": "kept",
    });

  it("signing out deletes every draft and nothing else", () => {
    const store = device();
    clearEnrollDrafts(store);
    expect(store.keys()).toEqual(["coachman-cache-owner", "unrelated-app:key"]);
  });

  it("someone else signing in deletes the drafts that aren't theirs", () => {
    const store = device();
    clearEnrollDrafts(store, "parent-a");
    expect(store.keys()).toEqual([
      "coachman-cache-owner",
      `${ENROLL_DRAFT_PREFIX}pickle-spot:tier-a`,
      `${ENROLL_DRAFT_PREFIX}pickle-spot:tier-b`,
      "unrelated-app:key",
    ]);
  });

  it("does nothing without storage, or when storage refuses", () => {
    expect(() => clearEnrollDrafts(null)).not.toThrow();
    const blocked: DraftStore = {
      length: 1,
      key: () => {
        throw new Error("SecurityError");
      },
      getItem: () => null,
      removeItem: () => undefined,
    };
    expect(() => clearEnrollDrafts(blocked, "parent-a")).not.toThrow();
  });
});
