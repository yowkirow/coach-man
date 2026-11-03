import { createFileRoute } from "@tanstack/react-router";
import { UserRound } from "lucide-react";
import { Avatar, Card, CardHeader, Pill } from "../../components/ui/display";
import { EmptyState, RowsSkeleton } from "../../components/ui/feedback";
import { fullName, plural } from "../../lib/format";
import { useAccount } from "../../lib/hooks";

export const Route = createFileRoute("/_portal/my/")({ component: PortalHome });

function PortalHome() {
  const account = useAccount();
  const data = account.data;
  const firstName = data?.user.name.trim().split(/\s+/)[0];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[2rem] leading-tight font-light tracking-[-0.02em]">
          {firstName ? `Hi, ${firstName}` : "Hi"}
        </h1>
        {data ? (
          <p className="mt-1 text-[0.9375rem] text-ink-2">Signed in as {data.user.email}</p>
        ) : null}
      </div>

      {account.isPending ? (
        <Card className="px-5 py-2">
          <RowsSkeleton rows={2} />
        </Card>
      ) : data?.family.length ? (
        data.family.map((academy) => (
          <Card key={academy.workspaceId} label={`Students at ${academy.academyName}`}>
            <CardHeader
              title={academy.academyName}
              action={<Pill tone="panel">{plural(academy.students.length, "student")}</Pill>}
            />
            <ul className="flex flex-col divide-y divide-line px-5 pb-2">
              {academy.students.map((s) => (
                <li key={s.clientId} className="flex items-center gap-3 py-3">
                  <Avatar person={s} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[1rem] font-medium">{fullName(s)}</span>
                    <span className="block text-[0.8125rem] text-ink-2">
                      {s.relation === "self"
                        ? "Your own training"
                        : "You're their parent or guardian"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ))
      ) : (
        <Card className="px-6 py-2">
          <EmptyState
            icon={<UserRound aria-hidden className="size-5" />}
            title="No students linked yet"
            body="Your academy links your account to a player. Open the invite link they sent you, then come back here."
          />
        </Card>
      )}
    </div>
  );
}
