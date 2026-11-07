import { createFileRoute, Outlet } from "@tanstack/react-router";

/** A linked student's pages (/my/<clientId>/…); the API answers 404 for anyone else's. */
export const Route = createFileRoute("/_portal/my/$clientId")({ component: Outlet });
