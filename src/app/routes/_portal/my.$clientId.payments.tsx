import { createFileRoute } from "@tanstack/react-router";
import { PortalPayments } from "../../features/portal/payments";

export const Route = createFileRoute("/_portal/my/$clientId/payments")({ component: Page });

function Page() {
  const { clientId } = Route.useParams();
  return <PortalPayments clientId={clientId} />;
}
