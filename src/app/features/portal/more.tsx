import { Link } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  ArrowUpRight,
  type LucideIcon,
  Settings,
  Share,
  Smartphone,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Bento, Card } from "../../components/ui/display";
import { useInstallPrompt } from "../../lib/pwa";
import { SignOutButton } from "../settings/sign-out";
import { AcademyCard } from "./academy";
import { PortalAvatar } from "./bits";
import { usePortalAccount, usePortalHome } from "./queries";
import { PortalPage, useCurrentStudent } from "./shell";

function LinkCard({
  to,
  params,
  icon: Icon,
  title,
  body,
  tone = "lime",
}: {
  to: string;
  params?: { clientId: string };
  icon: LucideIcon;
  title: string;
  body: string;
  tone?: "lime" | "lavender" | "sky";
}) {
  const fill = { lime: "bg-lime", lavender: "bg-lavender", sky: "bg-sky" }[tone];
  return (
    <Link
      to={to}
      params={params as never}
      className="flex h-full items-center gap-4 rounded-[24px] bg-card p-4 outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
    >
      <span
        className={`flex size-12 shrink-0 items-center justify-center rounded-full ${fill} text-ink`}
      >
        <Icon aria-hidden className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[1rem] font-medium">{title}</span>
        <span className="block text-[0.875rem] text-ink-2">{body}</span>
      </span>
      <ArrowUpRight aria-hidden className="size-4.5 shrink-0 text-ink-3" />
    </Link>
  );
}

/** More: the account, the student's coaches and profile, settings, the academy, and installing. */
export function PortalMore() {
  const account = usePortalAccount().data;
  const home = usePortalHome().data;
  const { current } = useCurrentStudent();
  const install = useInstallPrompt();
  const whose = current ? (current.relation === "self" ? "Your" : `${current.firstName}'s`) : null;
  const staff = account?.staff[0];
  return (
    <PortalPage title="More">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-5">
          {account ? (
            <Card label="Account" className="flex items-center gap-4 p-5">
              <PortalAvatar name={account.user.name} photoKey={null} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[1.125rem] font-medium">{account.user.name}</p>
                <p className="truncate text-[0.875rem] text-ink-2">
                  {account.emailIsPlaceholder ? "Passkey account" : account.user.email}
                </p>
              </div>
            </Card>
          ) : null}
          <nav aria-label="More">
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {current && whose ? (
                <>
                  <li>
                    <LinkCard
                      to="/my/$clientId/coaches"
                      params={{ clientId: current.clientId }}
                      icon={UsersRound}
                      title="Coaches"
                      body={`${whose} coaches and their profiles`}
                    />
                  </li>
                  <li>
                    <LinkCard
                      to="/my/$clientId/profile"
                      params={{ clientId: current.clientId }}
                      icon={UserRound}
                      title="Profile"
                      body={`${whose} details, health, and emergency contact`}
                    />
                  </li>
                </>
              ) : null}
              <li>
                <LinkCard
                  to="/my/settings"
                  icon={Settings}
                  title="Settings"
                  body="Signing in, passkeys, Google, and installing the app"
                  tone="lavender"
                />
              </li>
              {staff ? (
                <li>
                  <LinkCard
                    to="/"
                    icon={ArrowLeftRight}
                    title="Coach view"
                    body={`Back to ${staff.name}'s staff app`}
                    tone="sky"
                  />
                </li>
              ) : null}
            </ul>
          </nav>
          {!install.installed ? (
            <Bento
              tone="lime"
              title="Install the app"
              subtitle="Opens full screen from your home screen, and shows what you last opened without signal."
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
        </div>
        <div className="flex flex-col gap-5">
          {(home?.academies ?? []).map((a) => (
            <AcademyCard key={a.workspaceId} academy={a} />
          ))}
        </div>
      </div>
    </PortalPage>
  );
}
