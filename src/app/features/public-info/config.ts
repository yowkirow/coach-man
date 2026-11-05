import type { PublicConfigDto } from "@shared/api-types";
import { useQuery } from "@tanstack/react-query";
import { publicApi } from "../../lib/api";
import { keys } from "../../lib/query";

/** The Worker writes the settings into /about, /privacy, and /terms (no request on first paint). */
function fromPage(): PublicConfigDto | undefined {
  if (typeof document === "undefined") return undefined;
  const el = document.getElementById("cm-public-config");
  if (!el?.textContent) return undefined;
  try {
    const data = JSON.parse(el.textContent) as Partial<PublicConfigDto>;
    return typeof data.contactEmail === "string" ? { contactEmail: data.contactEmail } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The public pages' settings (the contact address, `PUBLIC_CONTACT_EMAIL`): from the page itself
 * when the Worker served it, else from GET /api/public/config. Kept on the device, so an installed
 * app's cached shell shows the address offline too.
 */
export function usePublicConfig() {
  return useQuery({
    queryKey: keys.publicConfig,
    queryFn: () => publicApi.get<PublicConfigDto>("/config"),
    initialData: fromPage,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
}
