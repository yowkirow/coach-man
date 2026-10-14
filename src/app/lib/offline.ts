import type { OfflinePackDto } from "@shared/api-types";
import { onlineManager, useMutationState } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
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

/** Caches the next week of sessions and rosters so the court works without signal. */
export async function prefetchOfflinePack(force = false) {
  if (!onlineManager.isOnline()) return;
  if (!force && Date.now() - lastPack < 10 * 60_000) return;
  lastPack = Date.now();
  try {
    const pack = await api.get<OfflinePackDto>("/offline-pack");
    for (const detail of pack.lessons) {
      queryClient.setQueryData(keys.lesson(detail.lesson.id), detail);
    }
    queryClient.setQueryData(
      keys.lessons(pack.from, pack.to),
      pack.lessons.map((d) => d.lesson),
    );
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
