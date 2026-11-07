import type { QueryClient } from "@tanstack/react-query";

/** localStorage key naming the coach whose data this device's offline cache holds. */
export const CACHE_OWNER_KEY = "coachman-cache-owner";

export interface OwnerStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Records `userId` as the owner of this device's cache. If someone else owned it, their cached
 * data (staff screens and family portal alike) and queued offline changes are dropped first, so
 * nothing of theirs is shown or replayed under the new session. The new person's own profile
 * (`me`) and account, already fetched, are kept. Returns true when that happened.
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
    void client.resetQueries({
      predicate: (q) => {
        if (q.queryKey[0] === "me") return false;
        if (q.queryKey[0] === "account") {
          return (q.state.data as { user?: { id?: string } } | undefined)?.user?.id !== userId;
        }
        return true;
      },
    });
  }
  try {
    store?.setItem(CACHE_OWNER_KEY, userId);
  } catch {
    // Storage unavailable (private mode): ownership can't be tracked, nothing else to do.
  }
  return switched;
}
