// A student's coaches over time: assignments are never overwritten. Changing coaches ends the
// current rows that no longer apply and starts new ones, so the history shows who coached when.

import type { ClientCoachRole } from "./domain";

export interface CurrentAssignment {
  id: string;
  coachUserId: string;
  role: ClientCoachRole;
}

export interface DesiredCoaches {
  primaryCoachUserId: string | null;
  assistantCoachIds: readonly string[];
}

export interface CoachChangePlan {
  /** Current rows to end (ended_on = today). */
  end: string[];
  /** Rows to start (started_on = today). */
  start: { coachUserId: string; role: ClientCoachRole }[];
  previousPrimary: string | null;
  primaryChanged: boolean;
}

/** The desired coaches tidied up: no blank ids, no duplicates, the primary never also an assistant. */
export function normalizeCoaches(desired: DesiredCoaches): DesiredCoaches {
  const primary = desired.primaryCoachUserId || null;
  const assistants = [...new Set(desired.assistantCoachIds.filter((id) => id && id !== primary))];
  return { primaryCoachUserId: primary, assistantCoachIds: assistants };
}

export function planCoachChanges(
  current: readonly CurrentAssignment[],
  desiredInput: DesiredCoaches,
): CoachChangePlan {
  const desired = normalizeCoaches(desiredInput);
  const wanted = new Map<string, ClientCoachRole>();
  if (desired.primaryCoachUserId) wanted.set(desired.primaryCoachUserId, "primary");
  for (const id of desired.assistantCoachIds) wanted.set(id, "assistant");

  const kept = new Set<string>();
  const end: string[] = [];
  for (const row of current) {
    const key = `${row.coachUserId}:${row.role}`;
    // At most one row per coach and role stays open; extras (and anything unwanted) end.
    if (wanted.get(row.coachUserId) === row.role && !kept.has(key)) kept.add(key);
    else end.push(row.id);
  }
  const start = [...wanted.entries()]
    .filter(([coachUserId, role]) => !kept.has(`${coachUserId}:${role}`))
    .map(([coachUserId, role]) => ({ coachUserId, role }));

  const previousPrimary = current.find((r) => r.role === "primary")?.coachUserId ?? null;
  return {
    end,
    start,
    previousPrimary,
    primaryChanged: previousPrimary !== desired.primaryCoachUserId,
  };
}
