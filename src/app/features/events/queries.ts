import type { EventDetailDto, EventDto } from "@shared/api-types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { keys } from "../../lib/query";

export type EventScope = "upcoming" | "past" | "all";

export function useEvents(scope: EventScope = "upcoming") {
  return useQuery({
    queryKey: keys.events(scope),
    queryFn: () => api.get<EventDto[]>(`/events?scope=${scope}`),
  });
}

export function useEvent(id: string, enabled = true) {
  return useQuery({
    queryKey: keys.event(id),
    queryFn: () => api.get<EventDetailDto>(`/events/${id}`),
    enabled: enabled && Boolean(id),
  });
}

/** Lists, the event itself, and session titles (which fall back to the event name). */
export function useInvalidateEvents() {
  const qc = useQueryClient();
  return (eventId?: string) => {
    void qc.invalidateQueries({ queryKey: ["events"] });
    if (eventId) void qc.invalidateQueries({ queryKey: keys.event(eventId) });
    void qc.invalidateQueries({ queryKey: ["lessons"] });
    void qc.invalidateQueries({ queryKey: ["lesson"] });
    void qc.invalidateQueries({ queryKey: keys.today });
  };
}
