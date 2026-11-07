import type { TeamPageDto, TeamPageEntryDto, TeamPersonDto } from "@shared/api-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../../lib/api";
import { notify } from "../../lib/notify";
import { keys } from "../../lib/query";

/** Everyone on the academy's team page, in its order (owners and admins). */
export function useTeamPage(enabled = true) {
  return useQuery({
    queryKey: keys.teamPage,
    queryFn: () => api.get<TeamPageDto>("/team-page"),
    enabled,
  });
}

/** A display-only person, for editing (`null` while adding someone new). */
export function useTeamPerson(id: string | null) {
  return useQuery({
    queryKey: keys.teamPerson(id ?? ""),
    queryFn: () => api.get<TeamPersonDto>(`/team-page/people/${id}`),
    enabled: id !== null,
  });
}

/** After a change to someone on the page: the page's list, the person, and the public preview. */
export function useRefreshTeamPage() {
  const qc = useQueryClient();
  return (person?: TeamPersonDto) => {
    if (person) qc.setQueryData(keys.teamPerson(person.id), person);
    void qc.invalidateQueries({ queryKey: keys.teamPage });
    void qc.invalidateQueries({ queryKey: keys.publicPreview });
  };
}

/** What PUT /team-page/order takes for an entry (staff by user id). */
export function entryRef(e: TeamPageEntryDto): { kind: TeamPageEntryDto["kind"]; id: string } {
  return { kind: e.kind, id: e.kind === "staff" ? e.userId : e.id };
}

/** A stable key for an entry (a user id and a person's id never meet, but kinds keep them apart). */
export function entryKey(e: TeamPageEntryDto): string {
  const { kind, id } = entryRef(e);
  return `${kind}:${id}`;
}

/** The entries with the one at `index` swapped with its neighbour `by` away (unchanged at an end). */
export function moveEntry(
  entries: readonly TeamPageEntryDto[],
  index: number,
  by: -1 | 1,
): TeamPageEntryDto[] {
  const next = [...entries];
  const other = index + by;
  const a = next[index];
  const b = next[other];
  if (!a || !b) return next;
  next[index] = b;
  next[other] = a;
  return next;
}

/** Moves still saving, sent one after another in the order they were made. */
const orderQueue: { chain: Promise<unknown>; pending: number } = {
  chain: Promise.resolve(),
  pending: 0,
};

/**
 * Saves a new order for the team page, showing it right away. A quick series of moves is saved in
 * order, each from the one before, and the page is refetched once the last one lands.
 */
export function useTeamPageOrder() {
  const qc = useQueryClient();
  return useMutation({
    meta: { silent: true },
    mutationFn: (entries: TeamPageEntryDto[]) => {
      const run = orderQueue.chain.then(() =>
        api.put<TeamPageDto>("/team-page/order", { entries: entries.map(entryRef) }),
      );
      orderQueue.chain = run.catch(() => undefined);
      return run;
    },
    onMutate: async (entries) => {
      orderQueue.pending += 1;
      await qc.cancelQueries({ queryKey: keys.teamPage });
      const prev = qc.getQueryData<TeamPageDto>(keys.teamPage);
      qc.setQueryData<TeamPageDto>(keys.teamPage, (old) => (old ? { ...old, entries } : old));
      return { prev };
    },
    onError: (err, _entries, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.teamPage, ctx.prev);
      notify({ tone: "danger", title: "Couldn't change the order", body: errorMessage(err) });
    },
    onSettled: () => {
      orderQueue.pending = Math.max(0, orderQueue.pending - 1);
      if (orderQueue.pending > 0) return;
      // Staff pickers list coaches in the page's order too.
      for (const key of [keys.teamPage, keys.publicPreview, keys.coaches, keys.team]) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}
