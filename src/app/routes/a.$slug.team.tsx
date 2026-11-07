import { createFileRoute } from "@tanstack/react-router";
import { PublicGate, publicSearch } from "../features/public/public-gate";
import { TeamPage } from "../features/public/team-page";

export const Route = createFileRoute("/a/$slug/team")({
  validateSearch: publicSearch,
  component: TeamRoute,
});

function TeamRoute() {
  const { slug } = Route.useParams();
  const { program, preview } = Route.useSearch();
  return (
    <PublicGate slug={slug} preview={preview === 1} titleOf={(a) => `Meet the team · ${a.name}`}>
      {(page, fmt) => <TeamPage page={page} slug={slug} programId={program} fmt={fmt} />}
    </PublicGate>
  );
}
