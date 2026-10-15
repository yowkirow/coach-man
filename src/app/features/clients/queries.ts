import type {
  ClientDetailDto,
  ClientDto,
  GroupDto,
  ProgressDto,
  StatementDto,
} from "@shared/api-types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../../lib/api";
import { useClients, useGroups } from "../../lib/hooks";
import { keys } from "../../lib/query";

export function useClientDetail(id: string) {
  return useQuery({
    queryKey: keys.client(id),
    queryFn: () => api.get<ClientDetailDto>(`/clients/${id}`),
  });
}

export function useProgress(id: string) {
  return useQuery({
    queryKey: keys.progress(id),
    queryFn: () => api.get<ProgressDto>(`/clients/${id}/progress`),
  });
}

export function useStatement(id: string) {
  return useQuery({
    queryKey: keys.statement(id),
    queryFn: () => api.get<StatementDto>(`/clients/${id}/statement`),
  });
}

/** Groups by id (archived ones included so old memberships still have a name). */
export function useGroupMap() {
  const groups = useGroups();
  return useMemo(
    () => new Map<string, GroupDto>((groups.data ?? []).map((g) => [g.id, g])),
    [groups.data],
  );
}

/** Every client including archived ones, built from the offline-cached list where possible. */
export function useAllClients() {
  const current = useClients({});
  const archived = useClients({ status: "archived" });
  const data = useMemo(
    () =>
      current.data ? [...current.data, ...(archived.data ?? [])] : (archived.data ?? undefined),
    [current.data, archived.data],
  );
  return { current, archived, data };
}

/** Refreshes everything that shows a client's identity, status, or groups. */
export function useInvalidateClient() {
  const qc = useQueryClient();
  return (clientId: string, opts: { groups?: boolean } = {}) => {
    void qc.invalidateQueries({ queryKey: ["clients"] });
    void qc.invalidateQueries({ queryKey: keys.client(clientId) });
    void qc.invalidateQueries({ queryKey: keys.today });
    void qc.invalidateQueries({ queryKey: ["lesson"] });
    if (opts.groups) {
      void qc.invalidateQueries({ queryKey: keys.groups });
      void qc.invalidateQueries({ queryKey: ["group"] });
      void qc.invalidateQueries({ queryKey: ["lessons"] });
    }
  };
}

/** Writes a fresh ClientDto into the cached profile so the header updates instantly. */
export function useStoreClient() {
  const qc = useQueryClient();
  return (dto: ClientDto) => {
    qc.setQueryData<ClientDetailDto>(keys.client(dto.id), (old) =>
      old ? { ...old, client: dto } : old,
    );
  };
}

/**
 * After any write on a profile: the list, the profile, progress, statement, credit history, and
 * Today all show something about this client.
 */
export function useRefreshClient() {
  const qc = useQueryClient();
  return (clientId: string, opts: { skip?: "progress"; groups?: boolean } = {}) => {
    void qc.invalidateQueries({ queryKey: ["clients"] });
    void qc.invalidateQueries({ queryKey: keys.client(clientId) });
    if (opts.skip !== "progress") void qc.invalidateQueries({ queryKey: keys.progress(clientId) });
    void qc.invalidateQueries({ queryKey: keys.statement(clientId) });
    void qc.invalidateQueries({ queryKey: keys.ledger(clientId) });
    void qc.invalidateQueries({ queryKey: keys.today });
    if (opts.groups) {
      void qc.invalidateQueries({ queryKey: keys.groups });
      void qc.invalidateQueries({ queryKey: ["group"] });
      void qc.invalidateQueries({ queryKey: ["lessons"] });
      void qc.invalidateQueries({ queryKey: ["lesson"] });
    }
  };
}

export function useStoreProgress() {
  const qc = useQueryClient();
  return (clientId: string, dto: ProgressDto) => qc.setQueryData(keys.progress(clientId), dto);
}
