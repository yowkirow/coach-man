/**
 * localStorage prefix of the enrollment wizard's saved answers (one draft per academy and tier,
 * see features/enrollment/draft.ts). They can hold a child's medical notes and emergency contacts,
 * so they follow the offline copy's rule: gone at sign-out, and when someone else signs in.
 */
export const ENROLL_DRAFT_PREFIX = "coachman.enroll.v1:";

export interface DraftStore {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

function draftOwner(raw: string | null): string | null {
  try {
    const owner = raw ? (JSON.parse(raw) as { userId?: unknown }).userId : null;
    return typeof owner === "string" ? owner : null;
  } catch {
    return null;
  }
}

/**
 * Deletes this device's enrollment drafts: all of them, or every one not started by `keepUserId`
 * (a draft that can't be read counts as someone else's).
 */
export function clearEnrollDrafts(store: DraftStore | null, keepUserId?: string) {
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(ENROLL_DRAFT_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      if (keepUserId !== undefined && draftOwner(store.getItem(key)) === keepUserId) continue;
      store.removeItem(key);
    }
  } catch {
    // Storage blocked: nothing could have been saved there either.
  }
}
