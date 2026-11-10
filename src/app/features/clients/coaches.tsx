import type {
  ClientCoachDto,
  ClientCoachesDto,
  ClientCoachesSavedDto,
  ClientDetailDto,
  CoachRefDto,
} from "@shared/api-types";
import { CLIENT_COACH_ROLE_LABELS } from "@shared/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, History, UserRoundPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { CoachAvatar, type CoachChoice, CoachFields } from "../../components/domain/coaches";
import { Button } from "../../components/ui/button";
import { Card, Pill } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { TextAreaField } from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage } from "../../lib/api";
import { useFormat } from "../../lib/format";
import { useCoachMap, useMe, useWritesCoaching } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { OfflineHint, SectionHead } from "./bits";
import { useAddNote } from "./notes";

const EMPTY: ClientCoachesDto = { primary: null, assistants: [], history: [] };

function since(c: ClientCoachDto, fmt: ReturnType<typeof useFormat>) {
  return c.endedOn
    ? `${fmt.date(c.startedOn)} to ${fmt.date(c.endedOn)}`
    : `Since ${fmt.date(c.startedOn)}`;
}

function CoachRow({ c, you }: { c: ClientCoachDto; you: boolean }) {
  const fmt = useFormat();
  return (
    <li className="flex items-center gap-3 py-3">
      <CoachAvatar coach={c.coach} size="md" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{c.coach.name}</span>
          {you ? <Pill tone="outline">You</Pill> : null}
        </p>
        <p className="num text-[0.8125rem] text-ink-2">
          {CLIENT_COACH_ROLE_LABELS[c.role]} · {since(c, fmt)}
        </p>
      </div>
    </li>
  );
}

/**
 * The student's coaches on the profile: primary and assistants now, and who coached them before.
 * Anyone on the team can change them; changing the primary coach offers a handoff note to people
 * who coach.
 */
export function CoachesCard({ detail }: { detail: ClientDetailDto }) {
  const fmt = useFormat();
  const me = useMe().data;
  const online = useOnline();
  const writes = useWritesCoaching();
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [handoff, setHandoff] = useState<{ from: CoachRefDto; to: CoachRefDto | null } | null>(
    null,
  );
  const coaches = detail.coaches ?? EMPTY;
  const current = [...(coaches.primary ? [coaches.primary] : []), ...coaches.assistants];
  const c = detail.client;
  return (
    <Card label="Coaches">
      <SectionHead
        title="Coaches"
        action={
          <Button
            variant="light"
            size="sm"
            icon={<UserRoundPlus aria-hidden className="size-4" />}
            isDisabled={!online}
            onPress={() => setEditing(true)}
          >
            {current.length ? "Change" : "Assign a coach"}
          </Button>
        }
      />
      <div className="px-5 pb-3">
        {current.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {current.map((row) => (
              <CoachRow key={row.id} c={row} you={row.coach.userId === me?.user.id} />
            ))}
          </ul>
        ) : (
          <p className="pb-2 text-ink-2">
            No coach yet. Assign a primary coach so {c.firstName} has someone who follows their
            progress.
          </p>
        )}
        {coaches.history.length ? (
          <div className="border-t border-line pt-2">
            <Button
              variant="ghost"
              size="sm"
              icon={<History aria-hidden className="size-4" />}
              aria-expanded={historyOpen}
              aria-controls={`coach-history-${c.id}`}
              onPress={() => setHistoryOpen((v) => !v)}
            >
              Earlier coaches
              <ChevronDown
                aria-hidden
                className={`size-4 transition-transform duration-200 ${historyOpen ? "rotate-180" : ""}`}
              />
            </Button>
            {historyOpen ? (
              <ol id={`coach-history-${c.id}`} className="flex flex-col pb-1">
                {coaches.history.map((h) => (
                  <li key={h.id} className="flex items-center gap-3 py-2.5">
                    <CoachAvatar coach={h.coach} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.9375rem]">
                        <span className="font-medium">{h.coach.name}</span>
                        <span className="text-ink-2"> · {CLIENT_COACH_ROLE_LABELS[h.role]}</span>
                      </p>
                      <p className="num text-[0.8125rem] text-ink-2">
                        {since(h, fmt)}
                        {h.assignedBy ? ` · set by ${h.assignedBy.name}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </div>
      <AssignCoachesSheet
        isOpen={editing}
        onOpenChange={setEditing}
        clientId={c.id}
        firstName={c.firstName}
        coaches={coaches}
        onPrimaryChanged={(from, to) => {
          if (writes) setHandoff({ from, to });
        }}
      />
      <HandoffSheet
        handoff={handoff}
        clientId={c.id}
        firstName={c.firstName}
        onClose={() => setHandoff(null)}
      />
    </Card>
  );
}

function AssignCoachesSheet({
  isOpen,
  onOpenChange,
  clientId,
  firstName,
  coaches,
  onPrimaryChanged,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  firstName: string;
  coaches: ClientCoachesDto;
  onPrimaryChanged: (from: CoachRefDto, to: CoachRefDto | null) => void;
}) {
  const online = useOnline();
  const qc = useQueryClient();
  const [value, setValue] = useState<CoachChoice>({ lead: null, assistants: [] });
  const save = useMutation({
    meta: { silent: true },
    mutationFn: (v: CoachChoice) =>
      api.put<ClientCoachesSavedDto>(`/clients/${clientId}/coaches`, {
        primaryCoachUserId: v.lead,
        assistantCoachIds: v.assistants,
      }),
    onSuccess: (res) => {
      qc.setQueryData<ClientDetailDto>(keys.client(clientId), (old) =>
        old ? { ...old, coaches: res.coaches } : old,
      );
      void qc.invalidateQueries({ queryKey: ["clients"] });
      void qc.invalidateQueries({ queryKey: keys.client(clientId) });
      void qc.invalidateQueries({ queryKey: keys.team });
      notify({ tone: "success", title: "Coaches saved", body: `On ${firstName}'s profile.` });
      onOpenChange(false);
      if (res.primaryChanged && res.previousPrimary) {
        onPrimaryChanged(res.previousPrimary, res.coaches.primary?.coach ?? null);
      }
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed from the profile when it opens.
  useEffect(() => {
    if (!isOpen) return;
    setValue({
      lead: coaches.primary?.coach.userId ?? null,
      assistants: coaches.assistants.map((a) => a.coach.userId),
    });
    save.reset();
  }, [isOpen]);
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={`${firstName}'s coaches`}
      description="The primary coach follows their progress; assistants help. Earlier coaches stay in the history."
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="dark"
            isDisabled={!online}
            isPending={save.isPending}
            onPress={() => save.mutate(value)}
          >
            Save coaches
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <CoachFields
          value={value}
          onChange={setValue}
          leadLabel="Primary coach"
          noLeadLabel="No primary coach"
        />
        {save.error ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
        <OfflineHint>You're offline. Reconnect to change coaches.</OfflineHint>
      </div>
    </Sheet>
  );
}

/**
 * After the primary coach changes: a note for whoever takes over (coaches only, never shown to
 * the student or parents). Skipping is fine.
 */
function HandoffSheet({
  handoff,
  clientId,
  firstName,
  onClose,
}: {
  handoff: { from: CoachRefDto; to: CoachRefDto | null } | null;
  clientId: string;
  firstName: string;
  onClose: () => void;
}) {
  const me = useMe().data;
  const add = useAddNote(clientId);
  const map = useCoachMap();
  const [body, setBody] = useState("");
  const [shown, setShown] = useState(handoff);
  const current = handoff ?? shown;
  // biome-ignore lint/correctness/useExhaustiveDependencies: start a fresh note each time.
  useEffect(() => {
    if (!handoff) return;
    setShown(handoff);
    setBody("");
  }, [handoff?.from.userId, handoff?.to?.userId]);
  const wasMine = current?.from.userId === me?.user.id;
  const to = current?.to ? (map.get(current.to.userId)?.name ?? current.to.name) : null;
  return (
    <Sheet
      isOpen={handoff !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Write a handoff note?"
      description={
        to
          ? `${firstName} moves from ${wasMine ? "you" : current?.from.name} to ${to}. A few lines help them pick up where ${wasMine ? "you" : "the last coach"} left off.`
          : `${current?.from.name ?? "The last coach"} no longer coaches ${firstName}. A few lines help whoever takes over.`
      }
      footer={
        <>
          <Button variant="light" onPress={onClose}>
            Skip
          </Button>
          <Button
            variant="dark"
            isDisabled={!body.trim()}
            onPress={() => {
              add(body.trim(), firstName, { kind: "handoff" });
              onClose();
            }}
          >
            Save handoff note
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextAreaField
          label="Handoff note"
          rows={6}
          autoFocus
          value={body}
          onChange={setBody}
          placeholder="What they're working on, what's next, and anything the next coach should know"
        />
        <p className="rounded-2xl bg-panel px-4 py-3 text-[0.875rem] text-ink-2">
          Handoff notes are for coaches only. {firstName} and their parents never see them.
        </p>
      </div>
    </Sheet>
  );
}
