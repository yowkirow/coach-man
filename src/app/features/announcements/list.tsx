import {
  ANNOUNCEMENT_STATE_LABELS,
  ANNOUNCEMENT_STATES,
  type AnnouncementState,
} from "@shared/announcements";
import type { AnnouncementDto } from "@shared/api-types";
import { useMutation } from "@tanstack/react-query";
import { Megaphone, Pin, Plus } from "lucide-react";
import { useState } from "react";
import { Page, ShellAside } from "../../components/layout/app-shell";
import { Button } from "../../components/ui/button";
import { Card, KpiTile, PageHeader, Pill } from "../../components/ui/display";
import { EmptyState, ErrorState, RowsSkeleton } from "../../components/ui/feedback";
import { ActionMenu, ConfirmSheet } from "../../components/ui/overlay";
import { api, errorMessage } from "../../lib/api";
import { type Format, plural, useFormat } from "../../lib/format";
import { useCan } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { AnnouncementBody } from "./body";
import { AnnouncementSheet } from "./composer";
import { useAnnouncementList, useInvalidateAnnouncements } from "./queries";

const at = (epoch: number, fmt: Format) => `${fmt.date(fmt.dayOf(epoch))}, ${fmt.time(epoch)}`;

/** Who it's for, in words ("For everyone", "For the members of Juniors"). */
export function audienceLine(a: Pick<AnnouncementDto, "audience" | "audienceName">): string {
  if (a.audience === "program") {
    return a.audienceName ? `For the members of ${a.audienceName}` : "For a program's members";
  }
  if (a.audience === "event") {
    return a.audienceName ? `For the players in ${a.audienceName}` : "For an event's players";
  }
  return "For everyone";
}

/** When it was (or will be) published, and when it ends. */
export function whenLine(a: AnnouncementDto, fmt: Format): string {
  const end = a.expiresAt ? ` · ends ${at(a.expiresAt, fmt)}` : "";
  switch (a.state) {
    case "draft":
      return `Last edited ${at(a.updatedAt, fmt)}`;
    case "scheduled":
      return `Goes live ${a.publishedAt ? at(a.publishedAt, fmt) : "later"}${end}`;
    case "live":
      return `Published ${a.publishedAt ? at(a.publishedAt, fmt) : ""}${end}`;
    case "expired":
      return `Ended ${a.expiresAt ? at(a.expiresAt, fmt) : ""}`;
  }
}

export function StatePill({ state }: { state: AnnouncementState }) {
  switch (state) {
    case "live":
      return <Pill tone="lime">Live</Pill>;
    case "scheduled":
      return <Pill tone="violet">Scheduled</Pill>;
    case "draft":
      return <Pill tone="outline">Draft</Pill>;
    case "expired":
      return <Pill tone="panel">Ended</Pill>;
  }
}

export function PinnedPill() {
  return (
    <Pill tone="outline">
      <Pin aria-hidden className="size-3.5" />
      Pinned
    </Pill>
  );
}

function AnnouncementCard({
  a,
  canCompose,
  onEdit,
}: {
  a: AnnouncementDto;
  canCompose: boolean;
  onEdit: (a: AnnouncementDto) => void;
}) {
  const fmt = useFormat();
  const invalidate = useInvalidateAnnouncements();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const unpublish = useMutation({
    meta: { silent: true },
    mutationFn: () => api.post<AnnouncementDto>(`/announcements/${a.id}/unpublish`),
    onSuccess: () => {
      invalidate();
      notify({
        tone: "neutral",
        title: "Moved back to drafts",
        body: "Families no longer see it. Publish it again whenever you're ready.",
      });
    },
    onError: (err) =>
      notify({ tone: "danger", title: "Couldn't unpublish it", body: errorMessage(err) }),
  });
  const remove = useMutation({
    meta: { silent: true },
    mutationFn: () => api.del(`/announcements/${a.id}`),
    onSuccess: () => {
      invalidate();
      setConfirmDelete(false);
      notify({ tone: "neutral", title: "Announcement deleted" });
    },
  });
  const titleId = `announcement-${a.id}`;
  return (
    <article aria-labelledby={titleId} className="rounded-[28px] bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatePill state={a.state} />
            {a.pinned ? <PinnedPill /> : null}
          </div>
          <h3 id={titleId} className="mt-2 text-[1.125rem] leading-snug font-medium">
            {a.title}
          </h3>
          <p className="num mt-1 text-[0.8125rem] text-ink-2">
            {audienceLine(a)} · {whenLine(a, fmt)}
            {a.author ? ` · by ${a.author.name}` : ""}
          </p>
        </div>
        {canCompose ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="light" size="sm" onPress={() => onEdit(a)}>
              Edit
            </Button>
            <ActionMenu
              label={`More for “${a.title}”`}
              actions={[
                ...(a.state === "live" || a.state === "scheduled"
                  ? [
                      {
                        id: "unpublish",
                        label: "Unpublish (back to drafts)",
                        onAction: () => unpublish.mutate(),
                      },
                    ]
                  : []),
                {
                  id: "delete",
                  label: "Delete",
                  tone: "danger" as const,
                  onAction: () => {
                    remove.reset();
                    setConfirmDelete(true);
                  },
                },
              ]}
            />
          </div>
        ) : null}
      </div>
      <AnnouncementBody body={a.body} className="mt-3 text-[0.9375rem]" />
      <ConfirmSheet
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this announcement?"
        body={
          <div className="flex flex-col gap-3">
            <p>
              “{a.title}” is removed for good
              {a.state === "live" ? ", and families stop seeing it" : ""}. To keep it for later,
              unpublish it instead.
            </p>
            {remove.error ? <p className="text-[#b42318]">{errorMessage(remove.error)}</p> : null}
          </div>
        }
        confirmLabel="Delete announcement"
        isPending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </article>
  );
}

const EMPTY: Record<AnnouncementState, { title: string; body: string }> = {
  live: {
    title: "Nothing live right now",
    body: "Publish an announcement and families see it on their home page; your team sees it on Today.",
  },
  scheduled: {
    title: "Nothing scheduled",
    body: "Schedule an announcement to go live later, like a reminder the day before a camp.",
  },
  draft: { title: "No drafts", body: "Save an announcement as a draft to finish it later." },
  expired: {
    title: "Nothing has ended yet",
    body: "Announcements with an end move here once it passes, so families stop seeing them.",
  },
};

const TILE: Record<AnnouncementState, "lime" | "violet" | "sky" | "amber"> = {
  live: "lime",
  scheduled: "violet",
  draft: "sky",
  expired: "amber",
};

/**
 * Announcements (staff): owners and admins write, schedule, edit, unpublish, and delete them in
 * four tabs (Drafts, Scheduled, Live, Expired); everyone else on the team reads the live ones.
 */
export function AnnouncementsPage({
  tab,
  onTab,
  startNew,
  onStarted,
}: {
  tab: AnnouncementState;
  onTab: (tab: AnnouncementState) => void;
  /** Open the composer on arrival (`?new=1`). */
  startNew?: boolean;
  onStarted?: () => void;
}) {
  const can = useCan();
  const canCompose = can.announcements;
  const current = canCompose ? tab : "live";
  const list = useAnnouncementList(current);
  const counts = list.data?.counts;
  const [editing, setEditing] = useState<AnnouncementDto | null>(null);
  const [open, setOpen] = useState(Boolean(startNew));
  const compose = (a: AnnouncementDto | null) => {
    setEditing(a);
    setOpen(true);
  };
  const tabs = canCompose
    ? (["draft", "scheduled", "live", "expired"] as const)
    : (["live"] as const);

  return (
    <>
      <ShellAside>
        <div className="flex flex-col gap-5">
          <div className="px-1">
            <h2 className="text-[1.75rem] leading-tight font-light tracking-[-0.01em]">
              Announcements
            </h2>
            <p className="mt-1 text-[0.875rem] text-night-ink-2">News for families and your team</p>
          </div>
          {canCompose ? (
            <>
              <div className="grid grid-cols-2 gap-2.5">
                {ANNOUNCEMENT_STATES.map((s) => (
                  <KpiTile
                    key={s}
                    label={ANNOUNCEMENT_STATE_LABELS[s]}
                    value={counts ? counts[s] : "–"}
                    tint={TILE[s]}
                    hint={`Show ${ANNOUNCEMENT_STATE_LABELS[s].toLowerCase()}`}
                    onPress={() => onTab(s)}
                  />
                ))}
              </div>
              <Button
                variant="lime"
                icon={<Plus aria-hidden className="size-4.5" />}
                onPress={() => compose(null)}
              >
                New announcement
              </Button>
            </>
          ) : null}
        </div>
      </ShellAside>
      <Page className="flex flex-col gap-5">
        <PageHeader
          title="Announcements"
          subtitle={
            canCompose
              ? "Families see live ones on their home page, and your team on Today."
              : "News from your academy. Owners and admins write them."
          }
          actions={
            canCompose ? (
              <Button
                variant="dark"
                icon={<Plus aria-hidden className="size-4.5" />}
                onPress={() => compose(null)}
              >
                New announcement
              </Button>
            ) : null
          }
        />
        {tabs.length > 1 ? (
          <nav aria-label="Announcement lists">
            <ul className="-mx-1 flex flex-wrap gap-2 px-1">
              {tabs.map((s) => {
                const on = s === current;
                return (
                  <li key={s}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => onTab(s)}
                      className={`inline-flex h-11 cursor-pointer items-center gap-2 rounded-full px-4 text-[0.9375rem] font-medium outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                        on ? "bg-ink text-white" : "bg-card text-ink hover:bg-panel"
                      }`}
                    >
                      {ANNOUNCEMENT_STATE_LABELS[s]}
                      <span className={`num ${on ? "text-white/70" : "text-ink-2"}`}>
                        {counts ? counts[s] : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}

        {list.isPending ? (
          <Card className="p-5">
            <RowsSkeleton rows={3} />
          </Card>
        ) : list.error && !list.data ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : list.data?.items.length ? (
          <section aria-label={ANNOUNCEMENT_STATE_LABELS[current]} className="flex flex-col gap-3">
            <p className="sr-only">{plural(list.data.items.length, "announcement")}</p>
            {list.data.items.map((a) => (
              <AnnouncementCard
                key={a.id}
                a={a}
                canCompose={canCompose}
                onEdit={(x) => compose(x)}
              />
            ))}
          </section>
        ) : (
          <Card className="px-6 py-2">
            <EmptyState
              icon={<Megaphone aria-hidden className="size-5" />}
              title={EMPTY[current].title}
              body={
                canCompose ? EMPTY[current].body : "When the academy posts news, it shows here."
              }
              action={
                canCompose ? (
                  <Button variant="dark" onPress={() => compose(null)}>
                    New announcement
                  </Button>
                ) : undefined
              }
            />
          </Card>
        )}
      </Page>
      {canCompose ? (
        <AnnouncementSheet
          isOpen={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) onStarted?.();
          }}
          announcement={editing}
        />
      ) : null}
    </>
  );
}
