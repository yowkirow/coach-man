import type { GroupDto, PackageTemplateDto } from "@shared/api-types";
import { Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  Globe,
  Pencil,
  Printer,
  Star,
  Ticket,
  UsersRound,
} from "lucide-react";
import { copyText } from "../../components/domain/invite-link";
import { Button, buttonClass, IconButton } from "../../components/ui/button";
import { Card, Pill } from "../../components/ui/display";
import { ErrorState, RowsSkeleton } from "../../components/ui/feedback";
import { Switch } from "../../components/ui/field";
import { errorMessage } from "../../lib/api";
import { plural, useFormat } from "../../lib/format";
import { useAcademy, useGroups } from "../../lib/hooks";
import { useOnline } from "../../lib/offline";
import {
  moveAmong,
  templateValidityText,
  useProgramPublic,
  useReorder,
  useTierFlags,
} from "./catalog";

const byOrder = (a: GroupDto, b: GroupDto) =>
  (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name);

/** Why a tier marked public still isn't on the page, if it isn't. */
function hiddenReason(t: PackageTemplateDto, program: GroupDto | undefined): string | null {
  if (!t.isPublic) return null;
  if (!t.active) return "Not for sale, so it's hidden";
  if (program && !program.isPublic) return "Hidden until its program is public";
  return null;
}

function TierRow({
  tier,
  program,
  first,
  last,
  onMove,
  onEdit,
}: {
  tier: PackageTemplateDto;
  program: GroupDto | undefined;
  first: boolean;
  last: boolean;
  onMove: (by: -1 | 1) => void;
  onEdit: () => void;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const flags = useTierFlags();
  const hidden = hiddenReason(tier, program);
  const meta = [
    tier.sessionsLabel || plural(tier.credits, "session"),
    templateValidityText(tier),
    tier.active ? null : "Not for sale",
  ].filter(Boolean);
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`font-medium break-words ${tier.active ? "" : "text-ink-2"}`}>
            {tier.name}
          </span>
          {tier.highlight ? (
            <Pill tone="amber">
              <Star aria-hidden className="size-3" />
              Featured
            </Pill>
          ) : null}
        </p>
        <p className="num mt-0.5 text-[0.8125rem] text-ink-2">
          {fmt.moneyShort(tier.priceMinor)} · {meta.join(" · ")}
        </p>
        {hidden ? <p className="mt-0.5 text-[0.8125rem] text-ink-2">{hidden}</p> : null}
      </div>
      <div className="flex items-center gap-1">
        <div className="mr-1 min-w-24">
          <Switch
            isSelected={tier.isPublic ?? false}
            isDisabled={!online}
            onChange={(isPublic) => flags.mutate({ id: tier.id, name: tier.name, isPublic })}
            aria-label={`Public: ${tier.name} on the academy page`}
          >
            <span className="text-[0.875rem]">Public</span>
          </Switch>
        </div>
        <IconButton
          label={tier.highlight ? `Stop featuring ${tier.name}` : `Feature ${tier.name}`}
          aria-pressed={tier.highlight ?? false}
          variant={tier.highlight ? "lime" : "ghost"}
          isDisabled={!online}
          onPress={() =>
            flags.mutate({ id: tier.id, name: tier.name, highlight: !(tier.highlight ?? false) })
          }
        >
          <Star aria-hidden className="size-4.5" />
        </IconButton>
        <IconButton
          label={`Move ${tier.name} up`}
          isDisabled={!online || first}
          onPress={() => onMove(-1)}
        >
          <ArrowUp aria-hidden className="size-4.5" />
        </IconButton>
        <IconButton
          label={`Move ${tier.name} down`}
          isDisabled={!online || last}
          onPress={() => onMove(1)}
        >
          <ArrowDown aria-hidden className="size-4.5" />
        </IconButton>
        <IconButton label={`Edit ${tier.name}`} isDisabled={!online} onPress={onEdit}>
          <Pencil aria-hidden className="size-4.5" />
        </IconButton>
      </div>
    </li>
  );
}

function TierList({
  tiers,
  allIds,
  program,
  onEdit,
}: {
  tiers: PackageTemplateDto[];
  allIds: string[];
  program: GroupDto | undefined;
  onEdit: (t: PackageTemplateDto) => void;
}) {
  const reorder = useReorder("packages");
  const siblings = tiers.map((t) => t.id);
  if (!tiers.length)
    return (
      <p className="px-5 pb-5 text-[0.875rem] text-ink-2">
        No packages in this program yet. Pick it as a package's program to add a tier.
      </p>
    );
  return (
    <ol
      aria-label={program ? `${program.name} tiers` : "Other packages"}
      className="flex flex-col divide-y divide-line px-5 pb-2"
    >
      {tiers.map((t, i) => (
        <TierRow
          key={t.id}
          tier={t}
          program={program}
          first={i === 0}
          last={i === tiers.length - 1}
          onMove={(by) => reorder.mutate(moveAmong(allIds, siblings, t.id, by))}
          onEdit={() => onEdit(t)}
        />
      ))}
    </ol>
  );
}

/**
 * What the academy page shows: whether it's listed (with preview, printable rates, and copy
 * link), then each program and its tiers with their public switches, the featured tier, and
 * their order.
 */
export function PublicPageTab({
  templates,
  onEdit,
}: {
  templates: PackageTemplateDto[] | undefined;
  onEdit: (t: PackageTemplateDto) => void;
}) {
  const online = useOnline();
  const academy = useAcademy();
  const groups = useGroups();
  const reorderPrograms = useReorder("groups");
  const programPublic = useProgramPublic();
  const a = academy.data;

  if (groups.isPending || academy.isPending || !templates)
    return (
      <Card className="px-5 py-2">
        <RowsSkeleton rows={4} />
      </Card>
    );
  if (!groups.data || !a)
    return (
      <Card className="px-6 py-2">
        <ErrorState
          title="Couldn't load your academy page"
          message={errorMessage(groups.error ?? academy.error)}
          onRetry={() => {
            void groups.refetch();
            void academy.refetch();
          }}
        />
      </Card>
    );

  const programs = groups.data.filter((g) => g.archivedAt === null).sort(byOrder);
  const programIds = programs.map((p) => p.id);
  const allIds = templates.map((t) => t.id);
  const known = new Set(programIds);
  const others = templates.filter((t) => !t.programId || !known.has(t.programId));
  const live = templates.filter((t) => {
    const p = programs.find((g) => g.id === t.programId);
    return t.isPublic && t.active && (!t.programId || p?.isPublic);
  }).length;

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5" label="Academy page">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-[1.125rem] font-medium">
              Your academy page
              {a.listed && a.publicUrl ? (
                <Pill tone="mint">
                  <Globe aria-hidden className="size-3" />
                  Listed
                </Pill>
              ) : (
                <Pill tone="panel">Not listed</Pill>
              )}
            </h2>
            <p className="num mt-1 max-w-[60ch] text-[0.875rem] text-ink-2">
              {a.listed && a.publicUrl
                ? `Families open it at ${a.publicUrl}. It shows ${plural(programs.filter((p) => p.isPublic).length, "public program")} and ${plural(live, "tier")}.`
                : a.publicUrl
                  ? "Only your team can preview it. List it in Settings, Academy profile, when it's ready."
                  : "Choose its web address in Settings, Academy profile, then list it when it's ready."}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            to="/a/$slug"
            params={{ slug: a.slug }}
            search={{ preview: 1 }}
            className={buttonClass("dark", "md")}
          >
            <Eye aria-hidden className="size-4.5" />
            Preview page
          </Link>
          <Link
            to="/a/$slug/rates"
            params={{ slug: a.slug }}
            search={{ preview: 1 }}
            className={buttonClass("light", "md")}
          >
            <Printer aria-hidden className="size-4.5" />
            Printable rates
          </Link>
          {a.listed && a.publicUrl ? (
            <Button
              variant="light"
              icon={<Copy aria-hidden className="size-4.5" />}
              onPress={() => void copyText(a.publicUrl as string, "Link")}
            >
              Copy link
            </Button>
          ) : null}
          <Link to="/settings" hash="academy-profile" className={buttonClass("ghost", "md")}>
            Academy profile
          </Link>
        </div>
      </Card>

      {programs.map((p, i) => {
        const tiers = templates.filter((t) => t.programId === p.id);
        return (
          <Card key={p.id} label={p.name}>
            <div className="flex flex-col gap-2 px-5 pt-5 pb-3 sm:flex-row sm:items-center sm:gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="flex flex-wrap items-center gap-2 text-[1.125rem] font-medium">
                  <UsersRound aria-hidden className="size-4.5 shrink-0" />
                  <Link
                    to="/groups/$groupId"
                    params={{ groupId: p.id }}
                    className="rounded-sm break-words underline decoration-line-strong underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink"
                  >
                    {p.name}
                  </Link>
                </h2>
                <p className="num mt-0.5 text-[0.8125rem] text-ink-2">
                  {[p.scheduleNote, p.level, plural(tiers.length, "tier")]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <div className="mr-1 min-w-24">
                  <Switch
                    isSelected={p.isPublic ?? false}
                    isDisabled={!online}
                    onChange={(isPublic) =>
                      programPublic.mutate({ id: p.id, name: p.name, isPublic })
                    }
                    aria-label={`Public: ${p.name} on the academy page`}
                  >
                    <span className="text-[0.875rem]">Public</span>
                  </Switch>
                </div>
                <IconButton
                  label={`Move ${p.name} up`}
                  isDisabled={!online || i === 0}
                  onPress={() =>
                    reorderPrograms.mutate(moveAmong(programIds, programIds, p.id, -1))
                  }
                >
                  <ArrowUp aria-hidden className="size-4.5" />
                </IconButton>
                <IconButton
                  label={`Move ${p.name} down`}
                  isDisabled={!online || i === programs.length - 1}
                  onPress={() => reorderPrograms.mutate(moveAmong(programIds, programIds, p.id, 1))}
                >
                  <ArrowDown aria-hidden className="size-4.5" />
                </IconButton>
              </div>
            </div>
            <TierList tiers={tiers} allIds={allIds} program={p} onEdit={onEdit} />
          </Card>
        );
      })}

      {others.length ? (
        <Card label="Other packages">
          <div className="px-5 pt-5 pb-3">
            <h2 className="flex items-center gap-2 text-[1.125rem] font-medium">
              <Ticket aria-hidden className="size-4.5" />
              {programs.length ? "Other packages" : "Packages"}
            </h2>
            <p className="mt-0.5 text-[0.8125rem] text-ink-2">
              Packages in no program are listed after the programs.
            </p>
          </div>
          <TierList tiers={others} allIds={allIds} program={undefined} onEdit={onEdit} />
        </Card>
      ) : null}
    </div>
  );
}
