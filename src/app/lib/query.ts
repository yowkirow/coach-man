import type {
  CoachSummaryDto,
  LessonDetailDto,
  MeDto,
  NoteDto,
  RosterEntryDto,
  TodayDto,
} from "@shared/api-types";
import type { AttendanceStatus, NoteKind, NoteVisibility } from "@shared/domain";
import { CONSUMING_STATUSES } from "@shared/domain";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { MutationCache, QueryClient, type QueryKey } from "@tanstack/react-query";
import { del, get, set } from "idb-keyval";
import { ApiRequestError, api } from "./api";
import { notify } from "./notify";

export const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export const CACHE_BUSTER = "coachman-cache-v1";

export const keys = {
  me: ["me"] as const,
  account: ["account"] as const,
  today: ["today"] as const,
  lesson: (id: string) => ["lesson", id] as const,
  lessons: (from: string, to: string) => ["lessons", from, to] as const,
  clients: (filters: Record<string, string | undefined> = {}) => ["clients", filters] as const,
  client: (id: string) => ["client", id] as const,
  progress: (clientId: string) => ["progress", clientId] as const,
  statement: (clientId: string) => ["statement", clientId] as const,
  ledger: (clientId: string) => ["ledger", clientId] as const,
  groups: ["groups"] as const,
  group: (id: string) => ["group", id] as const,
  rates: ["rates"] as const,
  packages: ["packages"] as const,
  venues: ["venues"] as const,
  skills: ["skills"] as const,
  events: (scope: string) => ["events", scope] as const,
  event: (id: string) => ["event", id] as const,
  money: (month: string) => ["money", month] as const,
  balances: ["balances"] as const,
  notificationPrefs: ["notification-prefs"] as const,
  academy: ["academy"] as const,
  team: ["team"] as const,
  coaches: ["coaches"] as const,
  coachProfile: (userId: string) => ["coach-profile", userId] as const,
  familyAccess: (clientId: string) => ["family-access", clientId] as const,
  consentDocuments: ["consent-documents"] as const,
  clientConsents: (clientId: string) => ["client-consents", clientId] as const,
  /** Public academy pages: never persisted (not in PERSISTED). */
  publicAcademy: (slug: string) => ["public-academy", slug] as const,
  publicPreview: ["public-preview"] as const,
  publicConsents: (slug: string) => ["public-consents", slug] as const,
  publicSessions: (slug: string, programId: string) =>
    ["public-sessions", slug, programId] as const,
  /** The enrollment wizard's choices for the signed-in person (never persisted). */
  enrollmentContext: (slug: string) => ["enrollment-context", slug] as const,
  /** The staff inbox (never persisted: decisions need a connection anyway). */
  enrollments: (status: string) => ["enrollments", status] as const,
  enrollment: (id: string) => ["enrollment", id] as const,
  enrollmentCount: ["enrollment-count"] as const,
  renewalsDue: ["renewals-due"] as const,
  /** Payment proofs to review (never persisted: reviewing needs a connection anyway). */
  paymentProofs: (status: string) => ["payment-proofs", status] as const,
  proofCount: ["proof-count"] as const,
  clientProofs: (clientId: string) => ["client-proofs", clientId] as const,
  /** Announcements, by tab (never persisted: composing needs a connection anyway). */
  announcements: (status: string) => ["announcements", status] as const,
  /** The contact address of CoachMan's public pages (persisted, so they read offline too). */
  publicConfig: ["public-config"] as const,
  /**
   * The family portal's reads, under the signed-in person's id: another person signing in on
   * the same device never sees them, even before the cache owner switches.
   */
  portal: {
    all: ["portal"] as const,
    home: (userId: string) => ["portal", userId, "home"] as const,
    student: (userId: string, clientId: string) => ["portal", userId, "student", clientId] as const,
    schedule: (userId: string, clientId: string, from: string, to: string) =>
      ["portal", userId, "schedule", clientId, from, to] as const,
    progress: (userId: string, clientId: string) =>
      ["portal", userId, "progress", clientId] as const,
    money: (userId: string, clientId: string) => ["portal", userId, "money", clientId] as const,
    consents: (userId: string, clientId: string) =>
      ["portal", userId, "consents", clientId] as const,
    academy: (userId: string, workspaceId: string) =>
      ["portal", userId, "academy", workspaceId] as const,
    enroll: (userId: string) => ["portal", userId, "enroll"] as const,
    enrollments: (userId: string, clientId: string) =>
      ["portal", userId, "enrollments", clientId] as const,
    proofs: (userId: string, clientId: string) => ["portal", userId, "proofs", clientId] as const,
    announcements: (userId: string) => ["portal", userId, "announcements"] as const,
    notifications: (userId: string) => ["portal", userId, "notifications"] as const,
  },
};

/** Query families kept in IndexedDB so the app can open and read offline. */
const PERSISTED = new Set([
  "me",
  "account",
  "today",
  "lesson",
  "lessons",
  "clients",
  "client",
  "progress",
  "groups",
  "group",
  "rates",
  "packages",
  "venues",
  "skills",
  "coaches",
  "academy",
  // The family portal reads offline too (its keys carry the person's id).
  "portal",
  // The public pages' contact address (not personal, the same for everyone).
  "public-config",
]);

export function shouldPersistQuery(key: QueryKey, status: string): boolean {
  return status === "success" && typeof key[0] === "string" && PERSISTED.has(key[0]);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: CACHE_MAX_AGE,
      retry: (count, err) =>
        !(err instanceof ApiRequestError && err.status >= 400 && err.status < 500) && count < 2,
    },
    mutations: { retry: 0 },
  },
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      if (mutation.meta?.silent) return;
      if (err instanceof ApiRequestError && err.status === 409) {
        notify({ tone: "danger", title: "Needs attention", body: err.message, duration: 8000 });
        void queryClient.invalidateQueries();
      }
    },
  }),
});

export const persister = createAsyncStoragePersister({
  storage: {
    getItem: async (key) => (await get<string>(key)) ?? null,
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key),
  },
  key: "coachman-query-cache",
  throttleTime: 1000,
});

// ---------------------------------------------------------------------------
// Offline-capable mutations. Defaults are registered by key so mutations that were paused
// offline and persisted to IndexedDB can resume after the app restarts.
// ---------------------------------------------------------------------------

export interface AttendanceVars {
  lessonId: string;
  attendanceId: string;
  status: AttendanceStatus;
  packageId?: string | "none";
  complimentary?: boolean;
  note?: string | null;
  mutationId: string;
}

export interface NoteVars {
  id: string;
  clientId?: string | null;
  lessonId?: string | null;
  body: string;
  /** Coaches only unless "shared"; handoff notes are always coaches only. */
  visibility?: NoteVisibility;
  kind?: NoteKind;
}

/** The note as it will look once saved, shown at once (and while offline) with "waiting to sync". */
export function optimisticNote(vars: NoteVars): NoteDto {
  const me = queryClient.getQueryData<MeDto>(keys.me);
  const author = me
    ? (queryClient
        .getQueryData<CoachSummaryDto[]>(keys.coaches)
        ?.find((c) => c.userId === me.user.id) ?? {
        userId: me.user.id,
        name: me.user.name,
        photoKey: null,
      })
    : null;
  const kind = vars.kind ?? "comment";
  const now = Date.now();
  return {
    id: vars.id,
    clientId: vars.clientId ?? null,
    lessonId: vars.lessonId ?? null,
    body: vars.body,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    createdBy: me?.user.id ?? null,
    author: author ? { userId: author.userId, name: author.name, photoKey: author.photoKey } : null,
    kind,
    visibility: kind === "handoff" ? "staff" : (vars.visibility ?? "staff"),
    editedAt: null,
    pending: true,
  };
}

export interface CompleteVars {
  lessonId: string;
  mutationId: string;
}

const isIn = (s: AttendanceStatus) => CONSUMING_STATUSES.includes(s);

function patchRoster(entry: RosterEntryDto, vars: AttendanceVars): RosterEntryDto {
  const funded = Boolean(entry.consumedPackageId || entry.chargeId);
  const willUse = isIn(vars.status) && !vars.complimentary;
  let remaining = entry.packageRemaining;
  if (remaining !== null) {
    if (!funded && willUse && entry.usablePackages.length > 0 && vars.packageId !== "none")
      remaining -= 1;
    if (entry.consumedPackageId && !willUse) remaining += 1;
  }
  return {
    ...entry,
    status: vars.status,
    packageRemaining: remaining,
    checkedInAt: willUse ? (entry.checkedInAt ?? Date.now()) : null,
    note: vars.note === undefined ? entry.note : vars.note,
    pending: true,
  };
}

const countIn = (roster: RosterEntryDto[]) => roster.filter((r) => isIn(r.status)).length;

function applyOptimisticAttendance(vars: AttendanceVars) {
  queryClient.setQueryData<LessonDetailDto>(keys.lesson(vars.lessonId), (old) => {
    if (!old) return old;
    const roster = old.roster.map((r) =>
      r.attendanceId === vars.attendanceId ? patchRoster(r, vars) : r,
    );
    return { ...old, roster, lesson: { ...old.lesson, checkedInCount: countIn(roster) } };
  });
  queryClient.setQueryData<TodayDto>(keys.today, (old) =>
    old
      ? {
          ...old,
          lessons: old.lessons.map((l) => {
            if (l.id !== vars.lessonId) return l;
            const roster = l.roster.map((r) =>
              r.attendanceId === vars.attendanceId ? patchRoster(r, vars) : r,
            );
            return { ...l, roster, checkedInCount: countIn(roster) };
          }),
        }
      : old,
  );
}

export function storeLesson(detail: LessonDetailDto) {
  queryClient.setQueryData(keys.lesson(detail.lesson.id), detail);
  queryClient.setQueryData<TodayDto>(keys.today, (old) =>
    old
      ? {
          ...old,
          lessons: old.lessons.map((l) =>
            l.id === detail.lesson.id ? { ...l, ...detail.lesson, roster: detail.roster } : l,
          ),
        }
      : old,
  );
}

queryClient.setMutationDefaults(["attendance"], {
  mutationFn: (vars: AttendanceVars) =>
    api.post<{ replay: boolean; lesson: LessonDetailDto }>(
      `/attendance/${vars.attendanceId}`,
      {
        status: vars.status,
        packageId: vars.packageId,
        complimentary: vars.complimentary,
        note: vars.note,
        mutationId: vars.mutationId,
      },
      { idempotencyKey: vars.mutationId },
    ),
  onMutate: async (vars: AttendanceVars) => {
    await queryClient.cancelQueries({ queryKey: keys.lesson(vars.lessonId) });
    applyOptimisticAttendance(vars);
  },
  onSuccess: (data: { lesson: LessonDetailDto }) => storeLesson(data.lesson),
  onError: (_err: unknown, vars: AttendanceVars) => {
    void queryClient.invalidateQueries({ queryKey: keys.lesson(vars.lessonId) });
    void queryClient.invalidateQueries({ queryKey: keys.today });
  },
  onSettled: () => {
    void queryClient.invalidateQueries({ queryKey: ["clients"] });
    void queryClient.invalidateQueries({ queryKey: ["client"] });
  },
});

queryClient.setMutationDefaults(["notes", "create"], {
  mutationFn: (vars: NoteVars) => api.post<NoteDto>("/notes", vars, { idempotencyKey: vars.id }),
  // A dropped request (network blip, server hiccup) shouldn't lose a note: the idempotency key
  // makes resending safe. Refusals (4xx) are final.
  retry: (count: number, err: unknown) =>
    count < 3 && !(err instanceof ApiRequestError && err.status < 500),
  retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 8000),
  onMutate: (vars: NoteVars) => {
    if (vars.lessonId) {
      const optimistic = optimisticNote(vars);
      queryClient.setQueryData<LessonDetailDto>(keys.lesson(vars.lessonId), (old) =>
        old ? { ...old, notes: [...old.notes, optimistic] } : old,
      );
    }
  },
  onSettled: (_d: unknown, _e: unknown, vars: NoteVars) => {
    if (vars.lessonId) void queryClient.invalidateQueries({ queryKey: keys.lesson(vars.lessonId) });
    if (vars.clientId)
      void queryClient.invalidateQueries({ queryKey: keys.progress(vars.clientId) });
  },
});

queryClient.setMutationDefaults(["lessons", "complete"], {
  mutationFn: (vars: CompleteVars) =>
    api.post<LessonDetailDto>(
      `/lessons/${vars.lessonId}/complete`,
      {},
      { idempotencyKey: vars.mutationId },
    ),
  onMutate: (vars: CompleteVars) => {
    queryClient.setQueryData<LessonDetailDto>(keys.lesson(vars.lessonId), (old) =>
      old
        ? { ...old, lesson: { ...old.lesson, status: "completed", completedAt: Date.now() } }
        : old,
    );
  },
  onSuccess: (data: LessonDetailDto) => storeLesson(data),
});
