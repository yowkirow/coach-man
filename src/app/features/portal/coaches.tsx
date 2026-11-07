import type { PortalCoachDto } from "@shared/api-types";
import { CLIENT_COACH_ROLE_LABELS } from "@shared/domain";
import { UserRoundSearch } from "lucide-react";
import { Card, Pill } from "../../components/ui/display";
import { EmptyState } from "../../components/ui/feedback";
import type { Format } from "../../lib/format";
import { plural } from "../../lib/format";
import { PortalAvatar, QueryGate } from "./bits";
import { useAcademyFormat, usePortalStudent } from "./queries";
import { PortalPage, useCurrentStudent } from "./shell";

function CoachCard({ coach, fmt }: { coach: PortalCoachDto; fmt: Format }) {
  const facts = [
    coach.yearsCoaching ? `${plural(coach.yearsCoaching, "year")} coaching` : null,
    coach.languages.length ? `Speaks ${coach.languages.join(", ")}` : null,
  ].filter(Boolean);
  return (
    <Card as="article" className="flex flex-col gap-4 p-5" label={coach.name}>
      <div className="flex items-center gap-4">
        <PortalAvatar name={coach.name} photoKey={coach.photoKey} size="lg" />
        <div className="min-w-0">
          <h2 className="text-[1.375rem] leading-tight font-light tracking-[-0.01em]">
            {coach.name}
          </h2>
          {coach.title ? <p className="text-[0.9375rem] text-ink-2">{coach.title}</p> : null}
          <p className="mt-1.5 flex flex-wrap items-center gap-2">
            <Pill tone={coach.role === "primary" ? "violet" : "panel"}>
              {CLIENT_COACH_ROLE_LABELS[coach.role]}
            </Pill>
            <span className="num text-[0.8125rem] text-ink-2">Since {fmt.date(coach.since)}</span>
          </p>
        </div>
      </div>
      {coach.bio ? (
        <p className="max-w-[65ch] text-[0.9375rem] whitespace-pre-line">{coach.bio}</p>
      ) : null}
      {coach.certifications.length || coach.specialties.length ? (
        <ul className="flex flex-wrap gap-2" aria-label="Certifications and specialties">
          {coach.certifications.map((c) => (
            <li key={`c-${c}`}>
              <Pill tone="sky">{c}</Pill>
            </li>
          ))}
          {coach.specialties.map((s) => (
            <li key={`s-${s}`}>
              <Pill tone="outline">{s}</Pill>
            </li>
          ))}
        </ul>
      ) : null}
      {facts.length ? <p className="text-[0.875rem] text-ink-2">{facts.join(" · ")}</p> : null}
    </Card>
  );
}

/** The student's coaches now: who leads their training, and who helps. */
export function PortalCoaches({ clientId }: { clientId: string }) {
  const student = usePortalStudent(clientId);
  const { current } = useCurrentStudent();
  const fmt = useAcademyFormat(student.data?.academy);
  const who = current?.relation === "self" ? "your" : `${current?.firstName ?? "their"}'s`;
  return (
    <PortalPage
      title="Coaches"
      subtitle={current ? `${current.firstName} ${current.lastName}`.trim() : undefined}
      students
    >
      <QueryGate query={student}>
        {(s) =>
          s.coaches.length ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
              {s.coaches.map((c) => (
                <CoachCard key={c.id} coach={c} fmt={fmt} />
              ))}
            </div>
          ) : (
            <Card className="px-6 py-2">
              <EmptyState
                icon={<UserRoundSearch aria-hidden className="size-5" />}
                title="No coach assigned yet"
                body={`The academy assigns a coach who follows ${who} progress. They show here, with their profile.`}
              />
            </Card>
          )
        }
      </QueryGate>
    </PortalPage>
  );
}
