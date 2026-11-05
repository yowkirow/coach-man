import { createFileRoute } from "@tanstack/react-router";
import { PortalNotifications } from "../../features/portal/notifications";

export const Route = createFileRoute("/_portal/my/notifications")({
  component: PortalNotifications,
});
