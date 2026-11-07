import { createFileRoute } from "@tanstack/react-router";
import { PortalSettings } from "../../features/portal/settings";

interface SettingsSearch {
  /** "linked" when Google sends someone back after linking. */
  google?: string;
  /** Why linking Google didn't work (Better Auth's error redirect). */
  error?: string;
  error_description?: string;
}

export const Route = createFileRoute("/_portal/my/settings")({
  validateSearch: (s: Record<string, unknown>): SettingsSearch => ({
    google: s.google === "linked" ? "linked" : undefined,
    error: typeof s.error === "string" && s.error ? s.error : undefined,
    error_description:
      typeof s.error_description === "string" && s.error_description
        ? s.error_description
        : undefined,
  }),
  component: Page,
});

function Page() {
  const search = Route.useSearch();
  return (
    <PortalSettings
      google={search.google}
      error={search.error}
      description={search.error_description}
    />
  );
}
