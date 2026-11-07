import type { ClientListItemDto } from "@shared/api-types";
import { useSyncExternalStore } from "react";
import { useHasTeam, useMe } from "./hooks";

/** A coach's name as Avatar wants it (initials from the first and last words). */
export function personOf(name: string, photoKey?: string | null) {
  const [first = "", ...rest] = name.trim().split(/\s+/);
  return { firstName: first || "?", lastName: rest.join(" "), photoKey: photoKey ?? null };
}

interface Coached {
  coachUserId: string | null;
  assistantCoachIds?: readonly string[];
}

/** The lead coach first, then the assistants. */
export function coachIdsOf(s: Coached): string[] {
  return [...(s.coachUserId ? [s.coachUserId] : []), ...(s.assistantCoachIds ?? [])];
}

/** A session (or program, or event) this person leads or assists. */
export function isMine(s: Coached, userId: string | undefined): boolean {
  return Boolean(userId) && coachIdsOf(s).includes(userId as string);
}

/** A student this person coaches now, as primary or assistant. */
export function isMyStudent(
  c: Pick<ClientListItemDto, "primaryCoachUserId" | "assistantCoachIds">,
  userId: string | undefined,
): boolean {
  if (!userId) return false;
  return c.primaryCoachUserId === userId || Boolean(c.assistantCoachIds?.includes(userId));
}

export type SessionScope = "mine" | "everyone";

const listeners = new Set<() => void>();
/** This page's choices, so the toggle works even where localStorage doesn't. */
const chosen = new Map<string, SessionScope>();
const scopeKey = (userId: string) => `coachman.sessionScope.${userId}`;

function readScope(userId: string): SessionScope | null {
  const here = chosen.get(userId);
  if (here) return here;
  try {
    const value = localStorage.getItem(scopeKey(userId));
    return value === "mine" || value === "everyone" ? value : null;
  } catch {
    return null;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * "Mine / Everyone" on Today and the Schedule, remembered on this device for each person. Coaches
 * start on their own sessions; owners and admins on everyone's. A one-person academy has no choice
 * to make, so it always shows everything.
 */
export function useSessionScope() {
  const me = useMe().data;
  const enabled = useHasTeam();
  const userId = me?.user.id ?? "";
  const stored = useSyncExternalStore(
    subscribe,
    () => (userId ? readScope(userId) : null),
    () => null,
  );
  const scope: SessionScope = !enabled
    ? "everyone"
    : (stored ?? (me?.role === "coach" ? "mine" : "everyone"));
  const setScope = (value: SessionScope) => {
    if (!userId) return;
    chosen.set(userId, value);
    try {
      localStorage.setItem(scopeKey(userId), value);
    } catch {
      // Private mode: the choice lasts until the page closes.
    }
    for (const l of listeners) l();
  };
  return { scope, setScope, enabled, userId };
}

/** The sessions a scope shows. */
export function inScope<T extends Coached>(
  sessions: readonly T[],
  scope: SessionScope,
  userId: string,
): T[] {
  return scope === "mine" ? sessions.filter((s) => isMine(s, userId)) : [...sessions];
}
