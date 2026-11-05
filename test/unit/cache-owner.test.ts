import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { CACHE_OWNER_KEY, type OwnerStore, switchCacheOwner } from "../../src/app/lib/cache-owner";

function memoryStore(): OwnerStore & { value: () => string | null } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    value: () => map.get(CACHE_OWNER_KEY) ?? null,
  };
}

function queueOfflineChange(client: QueryClient) {
  client.getMutationCache().build(client, {
    mutationKey: ["attendance"],
    mutationFn: async () => undefined,
  });
}

describe("offline cache ownership", () => {
  it("adopts the first coach without dropping anything", () => {
    const client = new QueryClient();
    const store = memoryStore();
    client.setQueryData(["today"], { lessons: ["a"] });
    expect(switchCacheOwner("coach-a", client, store)).toBe(false);
    expect(client.getQueryData(["today"])).toEqual({ lessons: ["a"] });
    expect(store.value()).toBe("coach-a");
  });

  it("keeps the cache and queued changes when the same coach signs back in", () => {
    const client = new QueryClient();
    const store = memoryStore();
    switchCacheOwner("coach-a", client, store);
    client.setQueryData(["today"], { lessons: ["a"] });
    queueOfflineChange(client);
    expect(switchCacheOwner("coach-a", client, store)).toBe(false);
    expect(client.getQueryData(["today"])).toEqual({ lessons: ["a"] });
    expect(client.getMutationCache().getAll()).toHaveLength(1);
  });

  it("drops another coach's data and queued changes, keeping the new coach's profile", () => {
    const client = new QueryClient();
    const store = memoryStore();
    switchCacheOwner("coach-a", client, store);
    client.setQueryData(["today"], { lessons: ["a"] });
    client.setQueryData(["clients", {}], [{ id: "client-of-a" }]);
    client.setQueryData(["me"], { user: { id: "coach-b" } });
    queueOfflineChange(client);

    expect(switchCacheOwner("coach-b", client, store)).toBe(true);
    expect(client.getQueryData(["today"])).toBeUndefined();
    expect(client.getQueryData(["clients", {}])).toBeUndefined();
    expect(client.getQueryData(["me"])).toEqual({ user: { id: "coach-b" } });
    expect(client.getMutationCache().getAll()).toHaveLength(0);
    expect(store.value()).toBe("coach-b");
  });

  it("drops the previous person's family portal data too, keeping the new person's account", () => {
    const client = new QueryClient();
    const store = memoryStore();
    switchCacheOwner("parent-a", client, store);
    client.setQueryData(["portal", "parent-a", "home"], { students: ["child-of-a"] });
    client.setQueryData(["portal", "parent-a", "money", "c1"], { balanceMinor: 1500 });
    client.setQueryData(["account"], { user: { id: "parent-b" } });

    expect(switchCacheOwner("parent-b", client, store)).toBe(true);
    expect(client.getQueryData(["portal", "parent-a", "home"])).toBeUndefined();
    expect(client.getQueryData(["portal", "parent-a", "money", "c1"])).toBeUndefined();
    expect(client.getQueryData(["account"])).toEqual({ user: { id: "parent-b" } });

    // An account still cached for someone else goes with the rest.
    client.setQueryData(["account"], { user: { id: "parent-b" } });
    expect(switchCacheOwner("parent-c", client, store)).toBe(true);
    expect(client.getQueryData(["account"])).toBeUndefined();
  });

  it("still works when storage is unavailable", () => {
    const client = new QueryClient();
    const broken: OwnerStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    client.setQueryData(["today"], { lessons: ["a"] });
    expect(switchCacheOwner("coach-a", client, broken)).toBe(false);
    expect(switchCacheOwner("coach-a", client, null)).toBe(false);
    expect(client.getQueryData(["today"])).toEqual({ lessons: ["a"] });
  });
});
