import { createFileRoute } from "@tanstack/react-router";
import { Page } from "../../components/layout/app-shell";
import { PageHeader } from "../../components/ui/display";

// Placeholder: replaced by the full screen implementation.
export const Route = createFileRoute("/_app/groups/$groupId")({
  component: () => (
    <Page>
      <PageHeader title="Group" />
    </Page>
  ),
});
