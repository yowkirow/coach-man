import type { TeamPageEntryDto } from "@shared/api-types";
import { framingOr, framingStyle, PORTRAIT_FRAMING } from "@shared/framing";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Eye, Pencil, UserPlus } from "lucide-react";
import { useState } from "react";
import { Button, buttonClass, IconButton } from "../../components/ui/button";
import { Avatar, Card, Pill } from "../../components/ui/display";
import { ErrorState, RowsSkeleton } from "../../components/ui/feedback";
import { errorMessage, fileUrl } from "../../lib/api";
import { personOf } from "../../lib/coaches";
import { useOnline } from "../../lib/offline";
import { SectionHead } from "../clients/bits";
import { type PersonTarget, TeamPersonSheet } from "./person-sheet";
import { entryKey, moveEntry, useTeamPage, useTeamPageOrder } from "./queries";

/**
 * Someone's small picture on the list: their team page photo as they framed it (the face, by
 * default), else their square photo, else initials.
 */
function TeamThumb({ entry }: { entry: TeamPageEntryDto }) {
  const src = fileUrl(entry.portraitKey);
  const [failed, setFailed] = useState<string | null>(null);
  if (src && failed !== src) {
    return (
      <span className="block size-11 shrink-0 overflow-hidden rounded-full bg-panel">
        <img
          src={src}
          alt=""
          onError={() => setFailed(src)}
          loading="lazy"
          style={framingStyle(framingOr(entry.portraitFraming, PORTRAIT_FRAMING))}
          className="block size-full object-cover"
        />
      </span>
    );
  }
  return <Avatar person={personOf(entry.name, entry.photoKey)} size="md" />;
}

function TeamPageRow({
  entry,
  first,
  last,
  onMove,
  onEdit,
}: {
  entry: TeamPageEntryDto;
  first: boolean;
  last: boolean;
  onMove: (by: -1 | 1) => void;
  onEdit: () => void;
}) {
  const online = useOnline();
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <TeamThumb entry={entry} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium break-words">{entry.name}</span>
            {entry.kind === "listed" ? <Pill tone="outline">Not on CoachMan</Pill> : null}
            {entry.isPublic ? null : <Pill tone="panel">Hidden</Pill>}
          </p>
          {entry.title ? (
            <p className="truncate text-[0.8125rem] text-ink-2">{entry.title}</p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-1 self-end sm:self-auto">
        <IconButton
          label={`Move ${entry.name} up`}
          isDisabled={!online || first}
          onPress={() => onMove(-1)}
        >
          <ArrowUp aria-hidden className="size-4.5" />
        </IconButton>
        <IconButton
          label={`Move ${entry.name} down`}
          isDisabled={!online || last}
          onPress={() => onMove(1)}
        >
          <ArrowDown aria-hidden className="size-4.5" />
        </IconButton>
        <IconButton label={`Edit ${entry.name}`} onPress={onEdit}>
          <Pencil aria-hidden className="size-4.5" />
        </IconButton>
      </div>
    </li>
  );
}

/**
 * Team: the academy's team page (owners and admins): everyone it shows, in its order, staff with
 * their coach profiles and the people the academy adds who don't sign in. Move people up or down,
 * edit them (staff open their coach profile), add someone, and preview the page.
 */
export function TeamPageCard({
  onEditStaff,
}: {
  onEditStaff: (staff: { userId: string; name: string }) => void;
}) {
  const online = useOnline();
  const page = useTeamPage();
  const order = useTeamPageOrder();
  // A new key for every opening, so the sheet starts fresh for each person.
  const [sheet, setSheet] = useState<{ key: number; target: PersonTarget | null }>({
    key: 0,
    target: null,
  });
  const open = (target: PersonTarget) => setSheet((s) => ({ key: s.key + 1, target }));
  const close = () => setSheet((s) => ({ ...s, target: null }));
  const data = page.data;
  const entries = data?.entries ?? [];
  const hidden = entries.filter((e) => !e.isPublic).length;

  return (
    <Card label="Team page">
      <SectionHead
        title="Team page"
        count={data ? entries.length : undefined}
        action={
          data ? (
            <>
              <Link
                to="/a/$slug/team"
                params={{ slug: data.slug }}
                search={{ preview: 1 }}
                className={buttonClass("light", "md")}
              >
                <Eye aria-hidden className="size-4.5" />
                Preview team page
              </Link>
              <Button
                variant="light"
                icon={<UserPlus aria-hidden className="size-4.5" />}
                isDisabled={!online}
                onPress={() => open({ id: null, name: "" })}
              >
                Add a person
              </Button>
            </>
          ) : undefined
        }
      />
      {page.isPending ? (
        <div className="px-5 pb-2">
          <RowsSkeleton rows={3} />
        </div>
      ) : !data ? (
        <div className="px-5 pb-3">
          <ErrorState
            title="Couldn't load the team page"
            message={errorMessage(page.error)}
            onRetry={() => void page.refetch()}
          />
        </div>
      ) : (
        <>
          <p className="max-w-[65ch] px-5 text-[0.875rem] text-ink-2">
            {data.listed
              ? "Families meet these people on your academy's team page, top to bottom."
              : "Who your team page shows, top to bottom. Families see it once your academy page is listed."}
            {hidden ? " Hidden people stay off it." : ""}
          </p>
          <ol aria-label="Team page order" className="flex flex-col divide-y divide-line px-5 pb-2">
            {entries.map((e, i) => (
              <TeamPageRow
                key={entryKey(e)}
                entry={e}
                first={i === 0}
                last={i === entries.length - 1}
                onMove={(by) => order.mutate(moveEntry(entries, i, by))}
                onEdit={() =>
                  e.kind === "staff"
                    ? onEditStaff({ userId: e.userId, name: e.name })
                    : open({ id: e.id, name: e.name })
                }
              />
            ))}
          </ol>
        </>
      )}
      <TeamPersonSheet key={sheet.key} target={sheet.target} onClose={close} />
    </Card>
  );
}
