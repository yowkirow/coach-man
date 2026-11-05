import { createFileRoute } from "@tanstack/react-router";
import { AboutPage } from "../features/public-info/about";

/** CoachMan's public home page: what it is, who it's for, and how to start (no sign-in). */
export const Route = createFileRoute("/about")({ component: AboutPage });
