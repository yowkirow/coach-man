import { createFileRoute } from "@tanstack/react-router";
import { PortalMore } from "../../features/portal/more";

export const Route = createFileRoute("/_portal/my/more")({ component: PortalMore });
