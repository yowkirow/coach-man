import type {
  PortalAcademyRefDto,
  PortalAnnouncementDto,
  PortalAnnouncementsDto,
  PortalHomeDto,
} from "@shared/api-types";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Megaphone, Pin } from "lucide-react";
import { Card, Pill } from "../../components/ui/display";
import { EmptyState } from "../../components/ui/feedback";
import { portalApi } from "../../lib/api";
import { keys } from "../../lib/query";
import { AnnouncementBody } from "../announcements/body";
import { PortalCard, QueryGate } from "./bits";
import { useAcademyFormat, usePortalAccount } from "./queries";
import { PortalPage } from "./shell";

export function usePortalAnnouncements() {
  const userId = usePortalAccount().data?.user.id ?? "";
  return useQuery({
    queryKey: keys.portal.announcements(userId),
    queryFn: () => portalApi.get<PortalAnnouncementsDto>("/announcements"),
    enabled: Boolean(userId),
    staleTime: 0,
    gcTime: 7 * 24 * 60 * 60 * 1000,
  });
}

/** Who an announcement is for, when it's narrower than everyone. */
function audienceText(a: PortalAnnouncementDto): string | null {
  if (a.audience === "program") return a.audienceName ? `For ${a.audienceName}` : "For a program";
  if (a.audience === "event") return a.audienceName ? `For ${a.audienceName}` : "For an event";
  return null;
}

function AnnouncementItem({
  a,
  academy,
  showAcademy,
}: {
  a: PortalAnnouncementDto;
  academy:
    | Pick<PortalAcademyRefDto, "name" | "currency" | "timezone" | "locale" | "weekStartsOn">
    | undefined;
  showAcademy: boolean;
}) {
  const fmt = useAcademyFormat(academy as PortalAcademyRefDto | undefined);
  const audience = audienceText(a);
  const titleId = `portal-announcement-${a.id}`;
  const meta = [
    fmt.date(fmt.dayOf(a.publishedAt)),
    audience,
    showAcademy && academy ? academy.name : null,
  ].filter(Boolean);
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <article aria-labelledby={titleId}>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-ink-2">
          {a.pinned ? (
            <Pill tone="outline">
              <Pin aria-hidden className="size-3.5" />
              Pinned
            </Pill>
          ) : null}
          <span className="num">{meta.join(" · ")}</span>
        </p>
        <h3 id={titleId} className="mt-1.5 text-[1.125rem] leading-snug font-medium">
          {a.title}
        </h3>
        <AnnouncementBody body={a.body} className="mt-1.5 text-[0.9375rem]" />
      </article>
    </li>
  );
}

/** Home's Announcements card: the latest few that reach this family, pinned first. */
export function HomeAnnouncements({ home }: { home: PortalHomeDto }) {
  const academy = home.academies[0]?.name ?? "your academy";
  const shown = home.announcements.slice(0, 3);
  const many = home.academies.length > 1;
  return (
    <PortalCard
      title="Announcements"
      action={
        home.announcements.length ? (
          <Link
            to="/my/announcements"
            className="rounded-full px-2 py-1 text-[0.875rem] font-medium outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink"
          >
            All announcements
          </Link>
        ) : null
      }
    >
      {shown.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {shown.map((a) => (
            <AnnouncementItem
              key={a.id}
              a={a}
              academy={home.academies.find((x) => x.workspaceId === a.workspaceId)}
              showAcademy={many}
            />
          ))}
        </ul>
      ) : (
        <p className="flex items-start gap-3 text-[0.9375rem] text-ink-2">
          <Megaphone aria-hidden className="mt-0.5 size-4.5 shrink-0" />
          <span>News from {academy}, like schedule changes and events, will show here.</span>
        </p>
      )}
    </PortalCard>
  );
}

/** /my/announcements: everything live that reaches this family's students. */
export function PortalAnnouncementsPage() {
  const list = usePortalAnnouncements();
  return (
    <PortalPage title="Announcements" subtitle="News from your academy">
      <QueryGate query={list}>
        {(data) =>
          data.items.length ? (
            <div className="max-w-[760px]">
              <Card className="p-5">
                <ul className="flex flex-col divide-y divide-line">
                  {data.items.map((a) => (
                    <AnnouncementItem
                      key={a.id}
                      a={a}
                      academy={data.academies.find((x) => x.workspaceId === a.workspaceId)}
                      showAcademy={data.academies.length > 1}
                    />
                  ))}
                </ul>
              </Card>
            </div>
          ) : (
            <Card className="px-6 py-2">
              <EmptyState
                icon={<Megaphone aria-hidden className="size-5" />}
                title="No announcements right now"
                body="When your academy posts news, like schedule changes or an event, it shows here and on your home page."
              />
            </Card>
          )
        }
      </QueryGate>
    </PortalPage>
  );
}
