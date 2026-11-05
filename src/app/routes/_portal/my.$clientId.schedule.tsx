import { createFileRoute } from "@tanstack/react-router";
import { PortalSchedule } from "../../features/portal/schedule";

export const Route = createFileRoute("/_portal/my/$clientId/schedule")({ component: Page });

function Page() {
  const { clientId } = Route.useParams();
  return <PortalSchedule clientId={clientId} />;
}
