import type { PublicAcademyDto, PublicAcademyPreviewDto } from "@shared/api-types";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, publicApi } from "../../lib/api";
import { type Format, makeFormat } from "../../lib/format";
import { keys } from "../../lib/query";

/** The id of the JSON block the Worker writes into /a/* pages (src/worker/lib/page-meta.ts). */
const DATA_ID = "cm-public-academy";

/** The page data the Worker sent with the HTML, when it's for this academy. */
function embedded(slug: string): PublicAcademyDto | undefined {
  if (typeof document === "undefined") return undefined;
  const el = document.getElementById(DATA_ID);
  if (!el?.textContent) return undefined;
  try {
    const data = JSON.parse(el.textContent) as PublicAcademyDto;
    return data.slug === slug ? data : undefined;
  } catch {
    return undefined;
  }
}

export type PublicPage =
  | { kind: "public"; academy: PublicAcademyDto }
  | { kind: "preview"; academy: PublicAcademyPreviewDto };

/**
 * A listed academy's public page data (no sign-in), or with `preview` the signed-in staff
 * member's own academy as families will see it, listed or not. Never persisted offline.
 */
export function usePublicAcademy(slug: string, preview: boolean) {
  const open = useQuery({
    queryKey: keys.publicAcademy(slug),
    queryFn: () => publicApi.get<PublicAcademyDto>(`/academies/${encodeURIComponent(slug)}`),
    initialData: () => embedded(slug),
    // The embedded copy is as fresh as the page itself.
    initialDataUpdatedAt: () => (embedded(slug) ? Date.now() : undefined),
    staleTime: 60_000,
    enabled: !preview,
  });
  const staff = useQuery({
    queryKey: keys.publicPreview,
    queryFn: () => api.get<PublicAcademyPreviewDto>("/academy/public-preview"),
    enabled: preview,
    staleTime: 0,
  });
  const query = preview ? staff : open;
  let page: PublicPage | undefined;
  if (preview && staff.data) page = { kind: "preview", academy: staff.data };
  else if (!preview && open.data) page = { kind: "public", academy: open.data };
  return { page, isPending: query.isPending, error: query.error, refetch: query.refetch };
}

/** Money, dates, and times the way the academy formats them. */
export function usePublicFormat(a: PublicAcademyDto | undefined): Format {
  const currency = a?.currency ?? "USD";
  const timezone = a?.timezone ?? "UTC";
  const locale = a?.locale ?? "en-US";
  const weekStartsOn = a?.weekStartsOn ?? 1;
  return useMemo(
    () => makeFormat({ currency, timezone, locale, weekStartsOn }),
    [currency, timezone, locale, weekStartsOn],
  );
}
