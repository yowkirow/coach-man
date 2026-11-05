import type { AnnouncementState } from "@shared/announcements";
import type { AnnouncementListDto } from "@shared/api-types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { keys } from "../../lib/query";

export function useAnnouncementList(status: AnnouncementState, enabled = true) {
  return useQuery({
    queryKey: keys.announcements(status),
    queryFn: () => api.get<AnnouncementListDto>(`/announcements?status=${status}`),
    enabled,
    // Scheduled ones go live on their own: check again while the page is open.
    refetchInterval: 60_000,
  });
}

/** Every tab, and Today's card (which shows the live ones). */
export function useInvalidateAnnouncements() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["announcements"] });
    void qc.invalidateQueries({ queryKey: keys.today });
  };
}
