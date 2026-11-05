import { createFileRoute } from "@tanstack/react-router";
import { PortalConsents } from "../../features/portal/consents";

export const Route = createFileRoute("/_portal/my/$clientId/consents")({ component: Page });

function Page() {
  const { clientId } = Route.useParams();
  return <PortalConsents clientId={clientId} />;
}
