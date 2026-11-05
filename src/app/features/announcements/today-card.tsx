import { announcementExcerpt } from "@shared/announcements";
import type { AnnouncementDto } from "@shared/api-types";
import { Link } from "@tanstack/react-router";
import { Megaphone, Pin } from "lucide-react";
import { useState } from "react";
import { Card, CardHeader } from "../../components/ui/display";
import { Sheet } from "../../components/ui/overlay";
import { useFormat } from "../../lib/format";
import { AnnouncementBody } from "./body";
import { audienceLine, whenLine } from "./list";

/**
 * Today's announcements card (every staff role): the live ones, pinned first then newest, each
 * opening in full. Hidden when nothing is live.
 */
export function TodayAnnouncements({ items }: { items: AnnouncementDto[] | undefined }) {
  const fmt = useFormat();
  const [open, setOpen] = useState<AnnouncementDto | null>(null);
  if (!items?.length) return null;
  const shown = items.slice(0, 3);
  return (
    <Card label="Announcements">
      <CardHeader
        title="Announcements"
        action={
          <Link
            to="/announcements"
            className="rounded-full px-2 py-1 text-[0.875rem] font-medium outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink"
          >
            {items.length > shown.length ? `All ${items.length}` : "All"}
          </Link>
        }
      />
      <ul className="flex flex-col px-3 pb-3">
        {shown.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => setOpen(a)}
              className="flex w-full cursor-pointer items-start gap-3 rounded-2xl px-2 py-2.5 text-left outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
            >
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-panel text-ink"
              >
                {a.pinned ? <Pin className="size-4.5" /> : <Megaphone className="size-4.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {a.title}
                  {a.pinned ? <span className="sr-only"> (pinned)</span> : null}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-[0.8125rem] text-ink-2">
                  {announcementExcerpt(a.body)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Sheet
        isOpen={Boolean(open)}
        onOpenChange={(v) => {
          if (!v) setOpen(null);
        }}
        title={open?.title ?? "Announcement"}
        description={open ? `${audienceLine(open)} · ${whenLine(open, fmt)}` : undefined}
      >
        {open ? <AnnouncementBody body={open.body} className="text-[0.9375rem]" /> : null}
      </Sheet>
    </Card>
  );
}
