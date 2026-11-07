import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPolicy } from "../features/public-info/privacy";

/** The privacy policy (public, no sign-in). */
export const Route = createFileRoute("/privacy")({ component: PrivacyPolicy });
