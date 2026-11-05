import { createFileRoute } from "@tanstack/react-router";
import { EnrollWizard } from "../features/enrollment/wizard";
import { PublicGate } from "../features/public/public-gate";

interface EnrollSearch {
  /** The tier (package template) being enrolled in. */
  package?: string;
  /** Google's error redirect when sign-in didn't finish. */
  error?: string;
}

export const Route = createFileRoute("/a/$slug/enroll")({
  validateSearch: (s: Record<string, unknown>): EnrollSearch => ({
    package: typeof s.package === "string" && s.package ? s.package : undefined,
    error: typeof s.error === "string" && s.error ? s.error : undefined,
  }),
  component: EnrollRoute,
});

function EnrollRoute() {
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  return (
    <PublicGate slug={slug} preview={false} titleOf={(a) => `Enroll · ${a.name}`}>
      {(page, fmt) => (
        <EnrollWizard
          academy={page.academy}
          slug={slug}
          tierId={search.package ?? ""}
          fmt={fmt}
          googleError={search.error}
        />
      )}
    </PublicGate>
  );
}
