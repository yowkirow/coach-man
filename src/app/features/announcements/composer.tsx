import type { PublishMode } from "@shared/announcements";
import { ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX } from "@shared/announcements";
import type { AnnouncementDto } from "@shared/api-types";
import type { AnnouncementAudience } from "@shared/domain";
import type { AnnouncementInput } from "@shared/schemas";
import { addDays, localDate, localTime, zonedToEpoch } from "@shared/time";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { InlineError } from "../../components/ui/feedback";
import {
  Checkbox,
  Segmented,
  SelectField,
  Switch,
  TextAreaField,
  TextField,
} from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { useFormat } from "../../lib/format";
import { useGroups } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { useEvents } from "../events/queries";
import { useInvalidateAnnouncements } from "./queries";

interface Draft {
  title: string;
  body: string;
  audience: AnnouncementAudience;
  programId: string;
  eventId: string;
  pinned: boolean;
  publish: PublishMode;
  date: string;
  time: string;
  ends: boolean;
  endDate: string;
  endTime: string;
}

function draftOf(a: AnnouncementDto | null, tz: string, today: string): Draft {
  const at = a?.publishedAt ?? null;
  const end = a?.expiresAt ?? null;
  return {
    title: a?.title ?? "",
    body: a?.body ?? "",
    audience: a?.audience ?? "all",
    programId: a?.audience === "program" ? (a.audienceId ?? "") : "",
    eventId: a?.audience === "event" ? (a.audienceId ?? "") : "",
    pinned: a?.pinned ?? false,
    publish: !a
      ? "now"
      : a.state === "draft"
        ? "draft"
        : a.state === "scheduled"
          ? "schedule"
          : "now",
    date: at && a?.state === "scheduled" ? localDate(at, tz) : addDays(today, 1),
    time: at && a?.state === "scheduled" ? localTime(at, tz) : "08:00",
    ends: end !== null,
    endDate: end ? localDate(end, tz) : addDays(today, 7),
    endTime: end ? localTime(end, tz) : "21:00",
  };
}

const SUBMIT_LABEL: Record<PublishMode, string> = {
  now: "Publish now",
  schedule: "Schedule",
  draft: "Save draft",
};

/**
 * Writes or edits an announcement: the words (plain text), who it's for (everyone, a program, or
 * an event), pinned, and when it goes live (now, a time ahead, or kept as a draft), with an
 * optional end. Times are the academy's.
 */
export function AnnouncementSheet({
  isOpen,
  onOpenChange,
  announcement,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = a new announcement. */
  announcement: AnnouncementDto | null;
}) {
  const fmt = useFormat();
  const online = useOnline();
  const groups = useGroups().data ?? [];
  const events = useEvents("upcoming").data ?? [];
  const invalidate = useInvalidateAnnouncements();
  const [draft, setDraft] = useState<Draft>(() => draftOf(announcement, fmt.tz, fmt.today()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => {
      const { [key]: _gone, ...rest } = e;
      return rest;
    });
  };

  const save = useMutation({
    meta: { silent: true },
    mutationFn: (body: AnnouncementInput) =>
      announcement
        ? api.patch<AnnouncementDto>(`/announcements/${announcement.id}`, body)
        : api.post<AnnouncementDto>("/announcements", body),
    onSuccess: (saved) => {
      invalidate();
      notify({
        tone: "success",
        title:
          saved.state === "live"
            ? announcement?.state === "live"
              ? "Announcement saved"
              : "Announcement published"
            : saved.state === "scheduled"
              ? "Announcement scheduled"
              : saved.state === "draft"
                ? "Draft saved"
                : "Announcement saved",
        body:
          saved.state === "scheduled" && saved.publishedAt
            ? `It goes live ${fmt.date(fmt.dayOf(saved.publishedAt))}, ${fmt.time(saved.publishedAt)}.`
            : undefined,
      });
      onOpenChange(false);
    },
    onError: (err) => setErrors(fieldErrors(err)),
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: start fresh each time it opens.
  useEffect(() => {
    if (!isOpen) return;
    setDraft(draftOf(announcement, fmt.tz, fmt.today()));
    setErrors({});
    save.reset();
  }, [isOpen, announcement?.id]);

  const submit = () => {
    const out: Record<string, string> = {};
    if (!draft.title.trim()) out.title = "Give it a title.";
    if (!draft.body.trim()) out.body = "Write the announcement.";
    if (draft.audience === "program" && !draft.programId) out.audienceId = "Pick the program.";
    if (draft.audience === "event" && !draft.eventId) out.audienceId = "Pick the event.";
    if (draft.publish === "schedule" && (!draft.date || !draft.time)) {
      out.publishAt = "Pick the day and time it goes live.";
    }
    if (draft.ends && (!draft.endDate || !draft.endTime)) out.expiresAt = "Pick when it ends.";
    setErrors(out);
    if (Object.keys(out).length) return;
    save.mutate({
      title: draft.title.trim(),
      body: draft.body,
      audience: draft.audience,
      audienceId:
        draft.audience === "program"
          ? draft.programId
          : draft.audience === "event"
            ? draft.eventId
            : null,
      pinned: draft.pinned,
      publish: draft.publish,
      publishAt: draft.publish === "schedule" ? zonedToEpoch(draft.date, draft.time, fmt.tz) : null,
      expiresAt: draft.ends ? zonedToEpoch(draft.endDate, draft.endTime, fmt.tz) : null,
    });
  };

  // The current target stays pickable even when it's no longer listed (an archived program, an
  // event that ended).
  const programOptions = groups
    .filter((g) => !g.archivedAt || g.id === draft.programId)
    .map((g) => ({ id: g.id, label: g.name }));
  if (draft.programId && !programOptions.some((o) => o.id === draft.programId)) {
    programOptions.push({
      id: draft.programId,
      label: announcement?.audienceName ?? "This program",
    });
  }
  const eventOptions = events.map((e) => ({
    id: e.id,
    label: e.name,
    description: `${fmt.date(e.startsOn)}${e.endsOn !== e.startsOn ? ` to ${fmt.date(e.endsOn)}` : ""}`,
  }));
  if (draft.eventId && !eventOptions.some((o) => o.id === draft.eventId)) {
    eventOptions.push({
      id: draft.eventId,
      label: announcement?.audienceName ?? "This event",
      description: "",
    });
  }
  const editingLive = announcement?.state === "live" && draft.publish === "now";

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="lg"
      title={announcement ? "Edit announcement" : "New announcement"}
      description="Families see it on their home page, and staff on Today."
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="dark" isPending={save.isPending} isDisabled={!online} onPress={submit}>
            {editingLive ? "Save changes" : SUBMIT_LABEL[draft.publish]}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField
          label="Title"
          value={draft.title}
          onChange={(v) => set("title", v.slice(0, ANNOUNCEMENT_TITLE_MAX))}
          placeholder="Courts closed on Saturday"
          error={errors.title}
          autoFocus={!announcement}
        />
        <TextAreaField
          label="Message"
          value={draft.body}
          onChange={(v) => set("body", v.slice(0, ANNOUNCEMENT_BODY_MAX))}
          rows={6}
          description="Plain text. Leave a blank line between paragraphs; web addresses become links."
          error={errors.body}
        />

        <div className="flex flex-col gap-3">
          <Segmented
            label="Who it's for"
            value={draft.audience}
            onChange={(v) => {
              set("audience", v as AnnouncementAudience);
              setErrors((e) => {
                const { audienceId: _gone, ...rest } = e;
                return rest;
              });
            }}
            options={[
              { id: "all", label: "Everyone" },
              { id: "program", label: "Program" },
              { id: "event", label: "Event" },
            ]}
          />
          {draft.audience === "program" ? (
            <SelectField
              label="Program"
              options={programOptions}
              value={draft.programId || null}
              onChange={(v) => set("programId", v)}
              placeholder={programOptions.length ? "Choose a program…" : "No programs yet"}
              description="Families of its current members see it."
              error={errors.audienceId}
            />
          ) : draft.audience === "event" ? (
            <SelectField
              label="Event"
              options={eventOptions}
              value={draft.eventId || null}
              onChange={(v) => set("eventId", v)}
              placeholder={eventOptions.length ? "Choose an event…" : "No upcoming events"}
              description="Families of players registered for it see it."
              error={errors.audienceId}
            />
          ) : (
            <p className="text-[0.8125rem] text-ink-2">
              Every family with a student at your academy sees it.
            </p>
          )}
        </div>

        <Switch
          isSelected={draft.pinned}
          onChange={(v) => set("pinned", v)}
          description="Pinned announcements stay above the others."
        >
          Pin to the top
        </Switch>

        <div className="flex flex-col gap-3">
          <Segmented
            label="When"
            value={draft.publish}
            onChange={(v) => set("publish", v as PublishMode)}
            options={[
              { id: "now", label: announcement?.state === "live" ? "Live" : "Now" },
              { id: "schedule", label: "Schedule" },
              { id: "draft", label: "Draft" },
            ]}
          />
          {draft.publish === "schedule" ? (
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Goes live on"
                type="date"
                value={draft.date}
                onChange={(v) => set("date", v)}
                min={fmt.today()}
                error={errors.publishAt}
              />
              <TextField
                label="At"
                type="time"
                value={draft.time}
                onChange={(v) => set("time", v)}
              />
            </div>
          ) : (
            <p className="text-[0.8125rem] text-ink-2">
              {draft.publish === "draft"
                ? "Only staff who manage announcements see drafts."
                : announcement?.state === "live"
                  ? "It stays live as published."
                  : "Families see it as soon as you publish."}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <Checkbox isSelected={draft.ends} onChange={(v) => set("ends", v)}>
            Take it down on a set day
          </Checkbox>
          {draft.ends ? (
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Ends on"
                type="date"
                value={draft.endDate}
                onChange={(v) => set("endDate", v)}
                min={fmt.today()}
                error={errors.expiresAt}
              />
              <TextField
                label="At"
                type="time"
                value={draft.endTime}
                onChange={(v) => set("endTime", v)}
              />
            </div>
          ) : null}
        </div>
        <p className="text-[0.8125rem] text-ink-2">
          Times are in the academy's time zone, {fmt.tz}.
        </p>
        {save.error && !Object.keys(fieldErrors(save.error)).length ? (
          <InlineError>{errorMessage(save.error)}</InlineError>
        ) : null}
        {!online ? (
          <p className="rounded-2xl bg-amber-soft px-4 py-3 text-[0.875rem]">
            You're offline. Announcements need a connection to publish.
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}
