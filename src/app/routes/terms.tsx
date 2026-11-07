import { createFileRoute } from "@tanstack/react-router";
import { TermsOfUse } from "../features/public-info/terms";

/** The terms of use (public, no sign-in). */
export const Route = createFileRoute("/terms")({ component: TermsOfUse });
