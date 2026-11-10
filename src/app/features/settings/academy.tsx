import { STAFF_ROLE_LABELS, STAFF_ROLE_NOUNS } from "@shared/roles";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, ArrowUpRight, Check, IdCardLanyard } from "lucide-react";
import { Button, buttonClass } from "../../components/ui/button";
import { Card, Pill } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { accountApi, errorMessage } from "../../lib/api";
import { plural } from "../../lib/format";
import { useAccount, useMe } from "../../lib/hooks";
import { clearLocalData, useOnline, usePendingChanges } from "../../lib/offline";
import { SettingsSection } from "./sections";

/** Switches the academy the staff app works in, then reloads with a clean offline copy. */
function useSwitchAcademy() {
  return useMutation({
    meta: { silent: true },
    mutationFn: async (workspaceId: string) => {
      await accountApi.post("/active-workspace", { workspaceId });
      // The offline copy holds the other academy's clients and sessions: start fresh.
      await clearLocalData();
    },
    onSuccess: () => window.location.assign("/"),
  });
}

/**
 * The academies this person is staff in (with their role in each) and, when a parent or student
 * too, the way to their family portal. Renders nothing for someone in a single academy.
 * `framed` puts it in its own card (the More page); Settings frames it in a section.
 */
export function AcademySwitcher({ framed = false }: { framed?: boolean }) {
  const me = useMe().data;
  const account = useAccount().data;
  const online = useOnline();
  const pending = usePendingChanges();
  const switchTo = useSwitchAcademy();
  if (!me || !account) return null;
  const others = account.staff.filter((s) => s.workspaceId !== me.workspace.id);
  const family = account.family.length > 0;
  if (!others.length && !family) return null;

  const body = (
    <div className="flex flex-col gap-3">
      <ul className="-mx-2 flex flex-col">
        <li className="flex items-center gap-3 rounded-2xl px-2 py-2.5">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-lime text-ink"
          >
            <Check className="size-4.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{me.workspace.name}</span>
            <span className="block text-[0.8125rem] text-ink-2">You're working here now</span>
          </span>
          <Pill tone="panel">{STAFF_ROLE_LABELS[me.role] ?? "Coach"}</Pill>
        </li>
        {others.map((s) => (
          <li key={s.workspaceId} className="flex items-center gap-3 rounded-2xl px-2 py-2.5">
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-panel text-ink"
            >
              <ArrowLeftRight className="size-4.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{s.name}</span>
              <span className="block text-[0.8125rem] text-ink-2">{STAFF_ROLE_LABELS[s.role]}</span>
            </span>
            <Button
              variant="light"
              size="sm"
              isDisabled={!online || pending > 0}
              isPending={switchTo.isPending && switchTo.variables === s.workspaceId}
              onPress={() => switchTo.mutate(s.workspaceId)}
              aria-label={`Switch to ${s.name}`}
            >
              Switch
            </Button>
          </li>
        ))}
        {family ? (
          <li>
            <Link
              to="/my"
              className="flex items-center gap-3 rounded-2xl px-2 py-2.5 outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
            >
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sky text-ink"
              >
                <ArrowUpRight className="size-4.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">My family</span>
                <span className="block text-[0.8125rem] text-ink-2">
                  Your own or your children's training
                </span>
              </span>
            </Link>
          </li>
        ) : null}
      </ul>
      {pending > 0 && others.length ? (
        <p className="rounded-2xl bg-amber-soft px-4 py-3 text-[0.875rem]">
          {plural(pending, "change")} from this device still need to sync before you switch.
        </p>
      ) : null}
      {switchTo.error ? <InlineError>{errorMessage(switchTo.error)}</InlineError> : null}
    </div>
  );
  if (!framed) return body;
  return (
    <Card label="Academies" className="px-5 pt-5 pb-3">
      <h2 className="mb-2 text-[1.125rem] font-medium">
        {others.length ? "Your academies" : "Your accounts"}
      </h2>
      {body}
    </Card>
  );
}

/** Settings card: which academy you're in, your role, and switching. */
export function AcademySection() {
  const me = useMe().data;
  const account = useAccount().data;
  if (!me) return null;
  const canSwitch = Boolean(
    account &&
      (account.family.length > 0 || account.staff.some((s) => s.workspaceId !== me.workspace.id)),
  );
  return (
    <SettingsSection
      id="academy"
      title="Academy"
      action={
        <Link to="/team" className={buttonClass("light", "sm")}>
          <IdCardLanyard aria-hidden className="size-4" />
          {me.can?.team ? "Team and invites" : "Team"}
        </Link>
      }
      description={
        <>
          You're in <span className="font-medium text-ink">{me.workspace.name}</span> as{" "}
          {STAFF_ROLE_NOUNS[me.role] ?? STAFF_ROLE_NOUNS.coach}.
          {me.can?.money
            ? ""
            : " Money, packages, and academy settings are handled by its owner and admins."}
        </>
      }
    >
      {canSwitch ? <AcademySwitcher /> : null}
    </SettingsSection>
  );
}
