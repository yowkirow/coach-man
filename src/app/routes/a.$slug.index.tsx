import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "../features/public/landing-page";
import { PublicGate, publicSearch } from "../features/public/public-gate";

export const Route = createFileRoute("/a/$slug/")({
  validateSearch: publicSearch,
  component: PublicAcademyRoute,
});

function PublicAcademyRoute() {
  const { slug } = Route.useParams();
  const { program, preview } = Route.useSearch();
  return (
    <PublicGate
      slug={slug}
      preview={preview === 1}
      titleOf={(a) => (a.tagline ? `${a.name} · ${a.tagline}` : a.name)}
    >
      {(page, fmt) => <LandingPage page={page} slug={slug} programId={program} fmt={fmt} />}
    </PublicGate>
  );
}
