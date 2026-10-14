import { createFileRoute } from "@tanstack/react-router";
import { Page } from "../../components/layout/app-shell";
import { PageHeader } from "../../components/ui/display";

// Placeholder: replaced by the full screen implementation.
export const Route = createFileRoute("/_app/schedule")({
  validateSearch: (s: Record<string, unknown>): { new?: "1" } => ({
    new: s.new === "1" ? "1" : undefined,
  }),
  component: () => (
    <Page>
      <PageHeader title="Schedule" />
    </Page>
  ),
});
