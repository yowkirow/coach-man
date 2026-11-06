import { createFileRoute } from "@tanstack/react-router";
import { EnrollWizard } from "../features/enrollment/wizard";
import { EnrollNowPage } from "../features/public/enroll-page";
import { PublicGate, publicSearch } from "../features/public/public-gate";

interface EnrollSearch {
  /** The tier (package template) being enrolled in; without one, Enroll now lists them. */
  package?: string;
  /** Enroll now's program on show. */
  program?: string;
  /** Staff previewing Enroll now before the site is shared. */
  preview?: 1;
  /** Google's error redirect when sign-in didn't finish. */
  error?: string;
}

export const Route = createFileRoute("/a/$slug/enroll")({
  validateSearch: (s: Record<string, unknown>): EnrollSearch => ({
    ...publicSearch(s),
    package: typeof s.package === "string" && s.package ? s.package : undefined,
    error: typeof s.error === "string" && s.error ? s.error : undefined,
  }),
  component: EnrollRoute,
});

function EnrollRoute() {
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  if (!search.package) {
    return (
      <PublicGate
        slug={slug}
        preview={search.preview === 1}
        titleOf={(a) => `Enroll now · ${a.name}`}
      >
        {(page, fmt) => (
          <EnrollNowPage page={page} slug={slug} programId={search.program} fmt={fmt} />
        )}
      </PublicGate>
    );
  }
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
