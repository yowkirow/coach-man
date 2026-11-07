import { createFileRoute } from "@tanstack/react-router";
import { PublicGate, publicSearch } from "../features/public/public-gate";
import { RatesSheet } from "../features/public/rates-sheet";

export const Route = createFileRoute("/a/$slug/rates")({
  validateSearch: publicSearch,
  component: RatesRoute,
});

function RatesRoute() {
  const { slug } = Route.useParams();
  const { preview } = Route.useSearch();
  return (
    <PublicGate
      slug={slug}
      preview={preview === 1}
      titleOf={(a) => `Rates and packages · ${a.name}`}
    >
      {(page, fmt) => <RatesSheet page={page} slug={slug} fmt={fmt} />}
    </PublicGate>
  );
}
