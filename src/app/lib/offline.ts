import type { OfflinePackDto } from "@shared/api-types";
import { onlineManager, useMutationState } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
import { switchCacheOwner } from "./cache-owner";
import { keys, queryClient } from "./query";

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
}

/** Mutations that are queued (offline) or in flight. */
export function usePendingChanges(): number {
  return useMutationState({ filters: { status: "pending" }, select: (m) => m.mutationId }).length;
}

let lastPack = 0;

let markRestored: () => void = () => undefined;
const restored = new Promise<void>((resolve) => {
  markRestored = resolve;
});

/** Called by the persistence provider once the IndexedDB cache has loaded. */
export function onCacheRestored() {
  markRestored();
}

/** Resolves once the persisted cache has loaded; never waits longer than `ms`. */
export function whenCacheRestored(ms = 2000): Promise<void> {
  return Promise.race([restored, new Promise<void>((resolve) => setTimeout(resolve, ms))]);
}

function deviceStorage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

let resumed = false;

/**
 * Call once the signed-in coach is known and the cache has been restored. A different coach on
 * this device starts clean; the same coach signing back in keeps their cache, and their queued
 * offline changes resume.
 */
export function claimCache(userId: string) {
  if (switchCacheOwner(userId, queryClient, deviceStorage())) lastPack = 0;
  if (!resumed) {
    resumed = true;
    void queryClient.resumePausedMutations().then(() => queryClient.invalidateQueries());
  }
}

/** Caches the next week of sessions and rosters so the court works without signal. */
export async function prefetchOfflinePack(force = false) {
  if (!onlineManager.isOnline()) return;
  if (!force && Date.now() - lastPack < 10 * 60_000) return;
  lastPack = Date.now();
  const startedAt = Date.now();
  try {
    const pack = await api.get<OfflinePackDto>("/offline-pack");
    // The pack was built before any check-in made while it downloaded. Don't let it overwrite
    // lessons with changes in flight or data that is already newer than the pack.
    const busy = new Set(
      queryClient
        .getMutationCache()
        .getAll()
        .filter((m) => m.state.status === "pending" || m.state.isPaused)
        .map((m) => (m.state.variables as { lessonId?: string } | undefined)?.lessonId),
    );
    const isNewer = (key: readonly unknown[]) =>
      (queryClient.getQueryState(key)?.dataUpdatedAt ?? 0) > startedAt;
    for (const detail of pack.lessons) {
      const key = keys.lesson(detail.lesson.id);
      if (busy.has(detail.lesson.id) || isNewer(key)) continue;
      queryClient.setQueryData(key, detail);
    }
    const listKey = keys.lessons(pack.from, pack.to);
    if (!isNewer(listKey)) {
      queryClient.setQueryData(
        listKey,
        pack.lessons.map((d) => d.lesson),
      );
    }
    await Promise.allSettled([
      queryClient.prefetchQuery({ queryKey: keys.today, queryFn: () => api.get("/today") }),
      queryClient.prefetchQuery({ queryKey: keys.clients({}), queryFn: () => api.get("/clients") }),
      queryClient.prefetchQuery({ queryKey: keys.groups, queryFn: () => api.get("/groups") }),
    ]);
  } catch {
    lastPack = 0;
  }
}

export function useOfflinePack() {
  const online = useOnline();
  useEffect(() => {
    if (!online) return;
    void prefetchOfflinePack();
    const id = setInterval(() => void prefetchOfflinePack(), 15 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void prefetchOfflinePack();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [online]);
}

/** Ask the browser not to evict our offline data (matters on iOS). */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) {
      await navigator.storage.persist?.();
    }
  } catch {
    // Best effort.
  }
}

/** Wipe local caches on sign-out so the next coach on this device starts clean. */
export async function clearLocalData() {
  queryClient.clear();
  queryClient.getMutationCache().clear();
  const { clear } = await import("idb-keyval");
  await clear();
}
