import type { QueryClient } from "@tanstack/react-query";

// The court changes: a check-in, a note, finishing a session. They show at once, work offline,
// and carry an idempotency key, so sending one again is always safe. Their mutation defaults are
// registered by key (lib/query.ts), so a copy restored from this device can run after a restart.
export const OFFLINE_MUTATION_KEYS: readonly (readonly string[])[] = [
  ["attendance"],
  ["notes", "create"],
  ["lessons", "complete"],
];

export function isOfflineMutationKey(key: readonly unknown[] | undefined): boolean {
  if (!key) return false;
  return OFFLINE_MUTATION_KEYS.some(
    (prefix) => prefix.length <= key.length && prefix.every((part, i) => key[i] === part),
  );
}

/** The parts of a TanStack mutation these rules read. */
interface MutationLike {
  state: { isPaused: boolean; status: string };
  options: { mutationKey?: readonly unknown[] };
}

/**
 * Which changes are saved on the device: any waiting for a connection, and court changes still in
 * flight. A weak signal can hold a request for seconds while the phone reports it's online; if the
 * app closes or reloads then, the saved copy goes out again when it reopens.
 */
export function shouldPersistMutation(m: MutationLike): boolean {
  return (
    m.state.isPaused ||
    (m.state.status === "pending" && isOfflineMutationKey(m.options.mutationKey))
  );
}

/**
 * Sends the changes this device saved: those paused offline, and court changes that were in flight
 * when the app last closed. `continue()` runs a restored change again and leaves one still running
 * in this session alone; offline, they wait for the connection.
 */
export function resumeQueuedChanges(client: QueryClient): Promise<unknown> {
  const queued = client
    .getMutationCache()
    .getAll()
    .filter(
      (m) =>
        m.state.status === "pending" &&
        (m.state.isPaused || isOfflineMutationKey(m.options.mutationKey)),
    );
  return Promise.all(queued.map((m) => m.continue().catch(() => undefined)));
}
