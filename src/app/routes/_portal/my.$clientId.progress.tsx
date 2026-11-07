import { createFileRoute } from "@tanstack/react-router";
import { PortalProgress } from "../../features/portal/progress";

export const Route = createFileRoute("/_portal/my/$clientId/progress")({ component: Page });

function Page() {
  const { clientId } = Route.useParams();
  return <PortalProgress clientId={clientId} />;
}
