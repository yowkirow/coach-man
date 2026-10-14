import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, FileUp, Share, Smartphone } from "lucide-react";
import { MORE_LINKS, Page } from "../../components/layout/app-shell";
import { Button } from "../../components/ui/button";
import { Avatar, Bento, Card, PageHeader } from "../../components/ui/display";
import { SignOutButton } from "../../features/settings/sign-out";
import { useMe } from "../../lib/hooks";
import { useInstallPrompt } from "../../lib/pwa";

export const Route = createFileRoute("/_app/more")({ component: More });

const DESCRIPTIONS: Record<string, string> = {
  "/groups": "Classes, squads, and their weekly sessions",
  "/events": "Camps, academies, clinics, and registrations",
  "/packages": "Your rate card and credit packages",
  "/settings": "Workspace, passkeys, reminders, and data",
};

function More() {
  const me = useMe().data;
  const install = useInstallPrompt();
  const [firstName, ...rest] = (me?.user.name ?? "Coach").split(" ");
  const coach = { firstName: firstName ?? "Coach", lastName: rest.join(" ") };

  return (
    <Page className="flex flex-col gap-5">
      <PageHeader title="More" />

      <Card className="flex items-center gap-4 p-5" label="Account">
        <Avatar person={coach} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[1.125rem] font-medium">{me?.user.name ?? "Coach"}</p>
          <p className="truncate text-[0.875rem] text-ink-2">
            {me?.workspace.name}
            {me?.user.email ? ` · ${me.user.email}` : ""}
          </p>
        </div>
      </Card>

      <nav aria-label="More sections">
        <ul className="grid gap-3 sm:grid-cols-2">
          {MORE_LINKS.map((l) => (
            <li key={l.to}>
              <Link
                to={l.to}
                className="flex h-full items-center gap-4 rounded-[24px] bg-card p-4 outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-lime text-ink">
                  <l.icon aria-hidden className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[1.0625rem] font-medium">{l.label}</span>
                  <span className="block text-[0.875rem] text-ink-2">{DESCRIPTIONS[l.to]}</span>
                </span>
                <ArrowUpRight aria-hidden className="size-4.5 shrink-0 text-ink-3" />
              </Link>
            </li>
          ))}
          <li>
            <Link
              to="/import"
              className="flex h-full items-center gap-4 rounded-[24px] bg-card p-4 outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-lavender text-ink">
                <FileUp aria-hidden className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[1.0625rem] font-medium">Import clients</span>
                <span className="block text-[0.875rem] text-ink-2">
                  Bring your list over from a spreadsheet
                </span>
              </span>
              <ArrowUpRight aria-hidden className="size-4.5 shrink-0 text-ink-3" />
            </Link>
          </li>
        </ul>
      </nav>

      {!install.installed ? (
        <Bento
          tone="lime"
          title="Install CoachMan"
          subtitle="Opens full screen, loads instantly, and works offline on court."
        >
          {install.canPrompt ? (
            <Button
              variant="dark"
              icon={<Smartphone aria-hidden className="size-4.5" />}
              onPress={() => void install.prompt()}
            >
              Install app
            </Button>
          ) : install.ios ? (
            <p className="text-[0.9375rem]">
              In Safari, tap <Share aria-label="Share" className="inline size-4 align-[-2px]" />{" "}
              then “Add to Home Screen”.
            </p>
          ) : (
            <p className="text-[0.9375rem]">Use your browser's “Install app” menu option.</p>
          )}
        </Bento>
      ) : null}

      <div>
        <SignOutButton />
      </div>
    </Page>
  );
}
