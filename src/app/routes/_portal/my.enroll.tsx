import { createFileRoute } from "@tanstack/react-router";
import { PortalEnroll } from "../../features/enrollment/portal-enroll";

export const Route = createFileRoute("/_portal/my/enroll")({ component: PortalEnroll });
