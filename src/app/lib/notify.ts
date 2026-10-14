import { useSyncExternalStore } from "react";

export type NoticeTone = "neutral" | "success" | "danger";

export interface Notice {
  id: number;
  tone: NoticeTone;
  title: string;
  body?: string;
  action?: { label: string; onAction: () => void };
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. */
  duration?: number;
}

let seq = 0;
let notices: Notice[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function notify(input: Omit<Notice, "id">): number {
  const id = ++seq;
  const notice: Notice = { duration: input.action ? 6000 : 4000, ...input, id };
  notices = [...notices.slice(-2), notice];
  emit();
  if (notice.duration) setTimeout(() => dismiss(id), notice.duration);
  return id;
}

export function dismiss(id: number) {
  notices = notices.filter((n) => n.id !== id);
  emit();
}

export function useNotices(): Notice[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => notices,
    () => notices,
  );
}
