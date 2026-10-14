import { createFileRoute } from "@tanstack/react-router";
import { Page } from "../../components/layout/app-shell";
import { PageHeader } from "../../components/ui/display";

// Placeholder: replaced by the full screen implementation.
export const Route = createFileRoute("/_app/money")({
  validateSearch: (s: Record<string, unknown>): { record?: "1" } => ({
    record: s.record === "1" ? "1" : undefined,
  }),
  component: () => (
    <Page>
      <PageHeader title="Money" />
    </Page>
  ),
});
