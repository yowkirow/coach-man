import { createFileRoute } from "@tanstack/react-router";
import { PortalHome } from "../../features/portal/home";
import { usePortalAccount } from "../../features/portal/queries";

export const Route = createFileRoute("/_portal/my/")({ component: Home });

function Home() {
  const name = usePortalAccount().data?.user.name.trim().split(/\s+/)[0];
  return <PortalHome greetingName={name} />;
}
