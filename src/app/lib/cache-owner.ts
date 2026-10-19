import type { QueryClient } from "@tanstack/react-query";

/** localStorage key naming the coach whose data this device's offline cache holds. */
export const CACHE_OWNER_KEY = "coachman-cache-owner";

export interface OwnerStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Records `userId` as the owner of this device's cache. If another coach owned it, their cached
 * data and queued offline changes are dropped first, so nothing from their workspace is shown or
 * replayed under the new session. Returns true when that happened.
 */
export function switchCacheOwner(
  userId: string,
  client: QueryClient,
  store: OwnerStore | null,
): boolean {
  let previous: string | null = null;
  try {
    previous = store?.getItem(CACHE_OWNER_KEY) ?? null;
  } catch {
    previous = null;
  }
  const switched = previous !== null && previous !== userId;
  if (switched) {
    client.getMutationCache().clear();
    void client.resetQueries({ predicate: (q) => q.queryKey[0] !== "me" });
  }
  try {
    store?.setItem(CACHE_OWNER_KEY, userId);
  } catch {
    // Storage unavailable (private mode): ownership can't be tracked, nothing else to do.
  }
  return switched;
}
