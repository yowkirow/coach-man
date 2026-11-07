import { dehydrate, hydrate, QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  isOfflineMutationKey,
  resumeQueuedChanges,
  shouldPersistMutation,
} from "../../src/app/lib/outbox";

const never = () => new Promise<never>(() => undefined);

type State = Parameters<typeof shouldPersistMutation>[0]["state"];
const state = (patch: Partial<State>): State =>
  ({
    context: undefined,
    data: undefined,
    error: null,
    failureCount: 0,
    failureReason: null,
    isPaused: false,
    status: "idle",
    variables: undefined,
    submittedAt: 0,
    ...patch,
  }) as State;

describe("isOfflineMutationKey", () => {
  it("matches the court changes by key prefix", () => {
    expect(isOfflineMutationKey(["attendance"])).toBe(true);
    expect(isOfflineMutationKey(["notes", "create"])).toBe(true);
    expect(isOfflineMutationKey(["lessons", "complete"])).toBe(true);
    expect(isOfflineMutationKey(["attendance", "lesson-1"])).toBe(true);
  });

  it("leaves out every other change", () => {
    expect(isOfflineMutationKey(undefined)).toBe(false);
    expect(isOfflineMutationKey([])).toBe(false);
    expect(isOfflineMutationKey(["notes"])).toBe(false);
    expect(isOfflineMutationKey(["notes", "update"])).toBe(false);
    expect(isOfflineMutationKey(["groups", "update"])).toBe(false);
  });
});

describe("shouldPersistMutation", () => {
  it("saves changes waiting for a connection, whatever they are", () => {
    const paused = state({ status: "pending", isPaused: true });
    expect(shouldPersistMutation({ state: paused, options: { mutationKey: ["groups"] } })).toBe(
      true,
    );
  });

  it("saves court changes still in flight, and only those", () => {
    const inFlight = state({ status: "pending" });
    expect(
      shouldPersistMutation({ state: inFlight, options: { mutationKey: ["attendance"] } }),
    ).toBe(true);
    expect(shouldPersistMutation({ state: inFlight, options: { mutationKey: ["groups"] } })).toBe(
      false,
    );
    expect(shouldPersistMutation({ state: inFlight, options: {} })).toBe(false);
  });

  it("drops changes that finished", () => {
    for (const status of ["success", "error", "idle"] as const) {
      expect(
        shouldPersistMutation({
          state: state({ status }),
          options: { mutationKey: ["attendance"] },
        }),
      ).toBe(false);
    }
  });
});

describe("a court change in flight when the app closes", () => {
  it("is saved on the device and sent once when the app reopens", async () => {
    // The app before it closes: a note on its way, and a catalog edit on its way.
    const before = new QueryClient();
    before.setMutationDefaults(["notes", "create"], { mutationFn: never });
    const note = { id: "note-1", body: "Low resets all session." };
    void before
      .getMutationCache()
      .build(before, { mutationKey: ["notes", "create"] })
      .execute(note);
    void before
      .getMutationCache()
      .build(before, { mutationKey: ["groups", "update"], mutationFn: never })
      .execute({ id: "g1" });
    const saved = dehydrate(before, {
      shouldDehydrateMutation: shouldPersistMutation,
      shouldDehydrateQuery: () => false,
    });
    expect(saved.mutations.map((m) => m.mutationKey)).toEqual([["notes", "create"]]);

    // The app reopens with what the device saved.
    const after = new QueryClient();
    const send = vi.fn(async (vars: unknown) => vars);
    after.setMutationDefaults(["notes", "create"], { mutationFn: send });
    hydrate(after, JSON.parse(JSON.stringify(saved)));
    await resumeQueuedChanges(after);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toEqual(note);
    expect(
      after
        .getMutationCache()
        .getAll()
        .map((m) => m.state.status),
    ).toEqual(["success"]);
  });

  it("isn't sent twice while it's still running in this session", async () => {
    const client = new QueryClient();
    const send = vi.fn(never);
    client.setMutationDefaults(["attendance"], { mutationFn: send });
    void client
      .getMutationCache()
      .build(client, { mutationKey: ["attendance"] })
      .execute({ a: 1 });
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);

    void resumeQueuedChanges(client);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(send).toHaveBeenCalledTimes(1);
  });
});
