import { createFileRoute } from "@tanstack/react-router";
import { PortalAnnouncementsPage } from "../../features/portal/announcements";

export const Route = createFileRoute("/_portal/my/announcements")({
  component: PortalAnnouncementsPage,
});
