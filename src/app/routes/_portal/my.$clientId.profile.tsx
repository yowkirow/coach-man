import { createFileRoute } from "@tanstack/react-router";
import { PortalProfile } from "../../features/portal/profile";

export const Route = createFileRoute("/_portal/my/$clientId/profile")({ component: Page });

function Page() {
  const { clientId } = Route.useParams();
  return <PortalProfile clientId={clientId} />;
}
