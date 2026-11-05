import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_portal/my/$clientId/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/my/$clientId/progress", params, replace: true });
  },
});
