import type { PortalStudentDto } from "@shared/api-types";
import { HeartPulse, Info } from "lucide-react";
import type { ReactNode } from "react";
import { KeyValue } from "../../components/ui/display";
import type { Format } from "../../lib/format";
import { ageText, HAND_LABELS } from "../clients/client-utils";
import { PortalAvatar, PortalCard, QueryGate } from "./bits";
import { useAcademyFormat, usePortalStudent } from "./queries";
import { PortalPage, useCurrentStudent } from "./shell";

const tel = (v: string) => `tel:${v.replace(/[^\d+]/g, "")}`;
const linkCls =
  "rounded-sm font-medium underline decoration-line-strong underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink";

function Basics({ s, fmt }: { s: PortalStudentDto; fmt: Format }) {
  const st = s.student;
  const age = ageText(st.birthDate, fmt.today());
  const items: { label: string; value: ReactNode }[] = [];
  if (st.birthDate)
    items.push({
      label: "Birth date",
      value: (
        <span className="num">
          {fmt.date(st.birthDate)}
          {age ? ` · ${age}` : ""}
        </span>
      ),
    });
  if (st.level) items.push({ label: "Level", value: <span className="num">{st.level}</span> });
  if (st.duprRating !== null)
    items.push({ label: "DUPR", value: <span className="num">{st.duprRating.toFixed(2)}</span> });
  if (st.dominantHand)
    items.push({ label: "Plays", value: HAND_LABELS[st.dominantHand] ?? st.dominantHand });
  if (st.shirtSize) items.push({ label: "Shirt size", value: st.shirtSize });
  if (st.phone)
    items.push({
      label: "Phone",
      value: (
        <a href={tel(st.phone)} className={linkCls}>
          {st.phone}
        </a>
      ),
    });
  if (st.email)
    items.push({ label: "Email", value: <span className="break-all">{st.email}</span> });
  if (s.programs.length)
    items.push({ label: "Programs", value: s.programs.map((p) => p.name).join(", ") });
  if (st.joinedOn)
    items.push({
      label: "Training since",
      value: <span className="num">{fmt.date(st.joinedOn)}</span>,
    });
  return (
    <PortalCard title="Details">
      <div className="mb-5 flex items-center gap-4">
        <PortalAvatar name={`${st.firstName} ${st.lastName}`} photoKey={st.photoKey} size="lg" />
        <p className="text-[1.375rem] leading-tight font-light tracking-[-0.01em]">
          {st.firstName} {st.lastName}
        </p>
      </div>
      {items.length ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {items.map((it) => (
            <KeyValue key={it.label} label={it.label}>
              {it.value}
            </KeyValue>
          ))}
        </dl>
      ) : (
        <p className="text-[0.9375rem] text-ink-2">The academy hasn't added more details yet.</p>
      )}
    </PortalCard>
  );
}

function Safety({ s }: { s: PortalStudentDto }) {
  const x = s.safety;
  const contact = (name: string | null, phone: string | null) =>
    name || phone ? (
      <span className="flex flex-col">
        {name ? <span>{name}</span> : null}
        {phone ? (
          <a href={tel(phone)} className={`${linkCls} self-start`}>
            {phone}
          </a>
        ) : null}
      </span>
    ) : (
      <span className="text-ink-2">Not added</span>
    );
  return (
    <PortalCard title="Health and emergency">
      <div className="flex flex-col gap-4">
        {x.medicalNotes ? (
          <div className="flex items-start gap-3 rounded-[20px] bg-coral-soft px-4 py-3.5 text-[#5c0e0e]">
            <HeartPulse aria-hidden className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-medium">Medical note</p>
              <p className="mt-0.5 whitespace-pre-line">{x.medicalNotes}</p>
            </div>
          </div>
        ) : (
          <p className="text-[0.9375rem] text-ink-2">No medical note on file.</p>
        )}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <KeyValue label="Emergency contact">
            {contact(x.emergencyName, x.emergencyPhone)}
          </KeyValue>
          {s.student.isJunior || x.guardianName || x.guardianPhone ? (
            <KeyValue label="Parent or guardian">
              {contact(x.guardianName, x.guardianPhone)}
            </KeyValue>
          ) : null}
        </dl>
      </div>
    </PortalCard>
  );
}

/** Profile: the details the academy keeps, read-only for now (changes go through the academy). */
export function PortalProfile({ clientId }: { clientId: string }) {
  const student = usePortalStudent(clientId);
  const { current } = useCurrentStudent();
  const fmt = useAcademyFormat(student.data?.academy);
  return (
    <PortalPage
      title="Profile"
      subtitle={current ? `${current.firstName} ${current.lastName}`.trim() : undefined}
      students
    >
      <QueryGate query={student}>
        {(s) => (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start lg:gap-6">
            <Basics s={s} fmt={fmt} />
            <div className="flex flex-col gap-5">
              <Safety s={s} />
              <p className="flex items-start gap-3 px-1 text-[0.875rem] text-ink-2">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>Something out of date? Tell {s.academy.name} so they can update it.</span>
              </p>
            </div>
          </div>
        )}
      </QueryGate>
    </PortalPage>
  );
}
