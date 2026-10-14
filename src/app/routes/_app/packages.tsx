import { createFileRoute } from "@tanstack/react-router";
import { Page } from "../../components/layout/app-shell";
import { PageHeader } from "../../components/ui/display";

// Placeholder: replaced by the full screen implementation.
export const Route = createFileRoute("/_app/packages")({
  validateSearch: (s: Record<string, unknown>): { sell?: "1" } => ({
    sell: s.sell === "1" ? "1" : undefined,
  }),
  component: () => (
    <Page>
      <PageHeader title="Packages & rates" />
    </Page>
  ),
});
