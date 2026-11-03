import { Link } from "@tanstack/react-router";
import { LockKeyhole } from "lucide-react";
import { buttonClass } from "../ui/button";
import { Card, PageHeader } from "../ui/display";
import { EmptyState } from "../ui/feedback";
import { Page } from "./app-shell";

/** A staff page this role can't use (a coach opening Money from an old link, say). */
export function NoAccess({ title, body }: { title: string; body: string }) {
  return (
    <Page className="flex flex-col gap-5">
      <PageHeader title={title} />
      <Card className="px-6 py-2">
        <EmptyState
          icon={<LockKeyhole aria-hidden className="size-5" />}
          title="Your academy's owner and admins handle this"
          body={body}
          action={
            <Link to="/" className={buttonClass("dark")}>
              Go to Today
            </Link>
          }
        />
      </Card>
    </Page>
  );
}
