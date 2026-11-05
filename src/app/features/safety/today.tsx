import type { TodayDto } from "@shared/api-types";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, HeartPulse } from "lucide-react";
import { useState } from "react";
import { Sheet } from "../../components/ui/overlay";
import { fullName, plural, useFormat } from "../../lib/format";
import { MedicalCallout } from "./roster";

type TodayLesson = TodayDto["lessons"][number];

export interface MedicalJunior {
  clientId: string;
  name: string;
  note: string;
  sessions: { id: string; title: string; startsAt: number }[];
}

/** The juniors on today's (not cancelled) rosters who have a medical note, each once. */
export function juniorsWithMedical(lessons: TodayLesson[]): MedicalJunior[] {
  const out = new Map<string, MedicalJunior>();
  for (const l of lessons) {
    if (l.status === "cancelled") continue;
    for (const r of l.roster) {
      const s = r.safety;
      if (!s?.junior || !s.medicalNotes) continue;
      if (r.status === "excused" || r.status === "late_cancel") continue;
      const found = out.get(r.clientId) ?? {
        clientId: r.clientId,
        name: fullName(r),
        note: s.medicalNotes,
        sessions: [],
      };
      found.sessions.push({ id: l.id, title: l.title, startsAt: l.startsAt });
      out.set(r.clientId, found);
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Today's "Needs attention" row for coaches: how many juniors in today's sessions have a medical
 * note, opening a sheet with each note (read before the session, not during it).
 */
export function MedicalTodayItem({ juniors }: { juniors: MedicalJunior[] }) {
  const fmt = useFormat();
  const [open, setOpen] = useState(false);
  if (!juniors.length) return null;
  const n = juniors.length;
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full cursor-pointer items-center gap-3 rounded-2xl px-2 py-2.5 text-left outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink"
      >
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-coral-soft text-[#b42318]"
        >
          <HeartPulse className="size-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="num block truncate font-medium">
            {plural(n, "junior")} with medical notes
          </span>
          <span className="block truncate text-[0.8125rem] text-ink-2">
            In today's sessions · read before you start
          </span>
        </span>
        <ArrowUpRight aria-hidden className="size-4 shrink-0 text-ink-3" />
      </button>
      <Sheet
        isOpen={open}
        onOpenChange={setOpen}
        title="Medical notes today"
        description={`${plural(n, "junior")} in today's sessions.`}
      >
        <ul className="flex flex-col divide-y divide-line">
          {juniors.map((j) => (
            <li key={j.clientId} className="flex flex-col gap-2.5 py-4 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{j.name}</p>
                  <p className="num text-[0.8125rem] text-ink-2">
                    {j.sessions.map((s) => `${fmt.time(s.startsAt)} ${s.title}`).join(" · ")}
                  </p>
                </div>
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: j.clientId }}
                  aria-label={`${j.name}'s profile`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-panel outline-none hover:bg-line focus-visible:outline-2 focus-visible:outline-ink"
                >
                  <ArrowUpRight aria-hidden className="size-4" />
                </Link>
              </div>
              <MedicalCallout text={j.note} />
            </li>
          ))}
        </ul>
      </Sheet>
    </li>
  );
}
