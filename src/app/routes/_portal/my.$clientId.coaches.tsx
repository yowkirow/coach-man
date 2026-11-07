import { createFileRoute } from "@tanstack/react-router";
import { PortalCoaches } from "../../features/portal/coaches";

export const Route = createFileRoute("/_portal/my/$clientId/coaches")({ component: Page });

function Page() {
  const { clientId } = Route.useParams();
  return <PortalCoaches clientId={clientId} />;
}
