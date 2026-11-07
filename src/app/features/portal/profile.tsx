import type { PickupDto, PortalStudentDto } from "@shared/api-types";
import { KIDS_SIZE_AGES, UNIFORM_SIZES } from "@shared/enrollment";
import { canEditAnySafety, telHref } from "@shared/safety";
import { useQueryClient } from "@tanstack/react-query";
import { HeartPulse, Info, Pencil, UserPlus } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { KeyValue } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { SelectField, TextAreaField, TextField } from "../../components/ui/field";
import { Sheet } from "../../components/ui/overlay";
import { errorMessage, fieldErrors, portalApi, portalFileUrl } from "../../lib/api";
import type { Format } from "../../lib/format";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { ageText, HAND_LABELS } from "../clients/client-utils";
import { PickupList, PickupSheet } from "../safety/pickups";
import { PortalAvatar, PortalCard, QueryGate } from "./bits";
import { useAcademyFormat, usePortalAccount, usePortalStudent } from "./queries";
import { PortalPage, useCurrentStudent } from "./shell";

const linkCls =
  "rounded-sm font-medium underline decoration-line-strong underline-offset-4 outline-none hover:decoration-ink focus-visible:outline-2 focus-visible:outline-ink";

const SIZE_OPTIONS = [
  { id: "none", label: "Not set" },
  ...UNIFORM_SIZES.kids.map((s) => ({ id: s, label: s, description: KIDS_SIZE_AGES[s] })),
  ...UNIFORM_SIZES.adults.map((s) => ({ id: s, label: s })),
];

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
        <a href={telHref(st.phone)} className={linkCls}>
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

/** Who keeps these details current, when the person reading can't change them. */
function readOnlyNote(s: PortalStudentDto): string {
  const st = s.student;
  if (st.relation === "self" && s.pickupsApply) {
    return "Your parent or guardian keeps your health details and pickup people up to date.";
  }
  if (st.relation === "guardian") {
    return `${st.firstName} keeps their own details up to date now.`;
  }
  return `Something out of date? Tell ${s.academy.name} so they can update it.`;
}

/** "Updated by you on Nov 5, 2026" / "Updated by the academy on …" / "Last updated …". */
function updatedText(s: PortalStudentDto, fmt: Format): string | null {
  const u = s.safetyUpdate;
  if (!u) return null;
  const when = fmt.date(fmt.dayOf(u.at));
  if (u.byYou) return `Updated by you on ${when}`;
  if (u.byAcademy) return `Updated by ${s.academy.name} on ${when}`;
  return `Last updated on ${when}`;
}

function Safety({ s, fmt, onEdit }: { s: PortalStudentDto; fmt: Format; onEdit?: () => void }) {
  const x = s.safety;
  const contact = (name: string | null, phone: string | null) =>
    name || phone ? (
      <span className="flex flex-col">
        {name ? <span>{name}</span> : null}
        {phone ? (
          <a href={telHref(phone)} className={`${linkCls} self-start`}>
            {phone}
          </a>
        ) : null}
      </span>
    ) : (
      <span className="text-ink-2">Not added</span>
    );
  const updated = updatedText(s, fmt);
  return (
    <PortalCard
      title="Health and emergency"
      action={
        onEdit ? (
          <Button
            variant="light"
            size="sm"
            icon={<Pencil aria-hidden className="size-4" />}
            onPress={onEdit}
          >
            Edit<span className="sr-only"> health and emergency details</span>
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        {x.medicalNotes ? (
          <div className="flex items-start gap-3 rounded-[20px] bg-coral-soft px-4 py-3.5 text-ink">
            <HeartPulse aria-hidden className="mt-0.5 size-5 shrink-0 text-[#b42318]" />
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
          {s.student.isJunior || s.pickupsApply || x.guardianName || x.guardianPhone ? (
            <KeyValue label="Parent or guardian">
              <span className="flex flex-col">
                {contact(x.guardianName, x.guardianPhone)}
                {x.guardianEmailOnFile && s.student.relation === "guardian" ? (
                  <span className="text-[0.8125rem] text-ink-2">
                    Email on file with the academy
                  </span>
                ) : null}
              </span>
            </KeyValue>
          ) : null}
        </dl>
        {updated ? <p className="num text-[0.8125rem] text-ink-2">{updated}</p> : null}
      </div>
    </PortalCard>
  );
}

interface SafetyForm {
  medicalNotes: string;
  emergencyName: string;
  emergencyPhone: string;
  guardianPhone: string;
  guardianEmail: string;
  shirtSize: string;
}

const formOf = (s: PortalStudentDto): SafetyForm => ({
  medicalNotes: s.safety.medicalNotes ?? "",
  emergencyName: s.safety.emergencyName ?? "",
  emergencyPhone: s.safety.emergencyPhone ?? "",
  guardianPhone: s.safety.guardianPhone ?? "",
  guardianEmail: "",
  shirtSize: s.student.shirtSize ?? "",
});

/** Edits what this person may change: health, emergency contact, their own contact, shirt size. */
function SafetySheet({
  isOpen,
  onOpenChange,
  s,
  onSaved,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  s: PortalStudentDto;
  onSaved: (dto: PortalStudentDto) => void;
}) {
  const online = useOnline();
  const rights = s.editable;
  const [form, setForm] = useState<SafetyForm>(() => formOf(s));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: start fresh each time it opens.
  useEffect(() => {
    if (!isOpen) return;
    setForm(formOf(s));
    setErrors({});
    setError(null);
  }, [isOpen]);
  const set = (key: keyof SafetyForm) => (v: string) => {
    setForm((f) => ({ ...f, [key]: v }));
    setErrors((e) => ({ ...e, [key]: "" }));
  };
  if (!rights) return null;
  const whose = s.student.relation === "self" ? "your" : `${s.student.firstName}'s`;

  const submit = async () => {
    const body: Record<string, string> = {};
    if (rights.medical) body.medicalNotes = form.medicalNotes;
    if (rights.emergency) {
      body.emergencyName = form.emergencyName;
      body.emergencyPhone = form.emergencyPhone;
    }
    if (rights.guardianContact) {
      body.guardianPhone = form.guardianPhone;
      // The address on file is never shown; only a new one typed here replaces it.
      if (form.guardianEmail.trim()) body.guardianEmail = form.guardianEmail;
    }
    if (rights.shirtSize) body.shirtSize = form.shirtSize === "none" ? "" : form.shirtSize;
    setPending(true);
    setError(null);
    try {
      const dto = await portalApi.patch<PortalStudentDto>(
        `/students/${encodeURIComponent(s.student.clientId)}/safety`,
        body,
      );
      onSaved(dto);
      notify({ tone: "success", title: "Details saved", body: `${s.academy.name} sees them now.` });
      onOpenChange(false);
    } catch (err) {
      const fields = fieldErrors(err);
      setErrors(fields);
      if (!Object.keys(fields).length) setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="lg"
      title="Health and emergency"
      description={`Coaches see ${whose} medical note and contacts at check-in.`}
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="dark"
            isPending={pending}
            isDisabled={!online}
            onPress={() => void submit()}
          >
            Save
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {rights.medical ? (
          <TextAreaField
            label="Medical notes"
            value={form.medicalNotes}
            onChange={set("medicalNotes")}
            rows={4}
            placeholder="Allergies, conditions, medications, and what to do"
            description="Leave it empty if there's nothing the coaches need to know."
            error={errors.medicalNotes || undefined}
          />
        ) : null}
        {rights.emergency ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-[1rem] font-medium">Emergency contact</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField
                label="Name"
                value={form.emergencyName}
                onChange={set("emergencyName")}
                autoComplete="off"
                error={errors.emergencyName || undefined}
              />
              <TextField
                label="Phone"
                type="tel"
                inputMode="tel"
                value={form.emergencyPhone}
                onChange={set("emergencyPhone")}
                error={errors.emergencyPhone || undefined}
              />
            </div>
          </fieldset>
        ) : null}
        {rights.guardianContact ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-[1rem] font-medium">Parent or guardian contact</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField
                label="Phone"
                type="tel"
                inputMode="tel"
                value={form.guardianPhone}
                onChange={set("guardianPhone")}
                error={errors.guardianPhone || undefined}
              />
              <TextField
                label="Email"
                type="email"
                inputMode="email"
                value={form.guardianEmail}
                onChange={set("guardianEmail")}
                placeholder={s.safety.guardianEmailOnFile ? "Type a new email to replace it" : ""}
                description={
                  s.safety.guardianEmailOnFile
                    ? "The academy has an email on file. It isn't shown here."
                    : undefined
                }
                error={errors.guardianEmail || undefined}
              />
            </div>
          </fieldset>
        ) : null}
        {rights.shirtSize ? (
          <SelectField
            label="Training shirt size"
            options={SIZE_OPTIONS}
            value={form.shirtSize || "none"}
            onChange={set("shirtSize")}
            error={errors.shirtSize || undefined}
          />
        ) : null}
        {error ? <InlineError>{error}</InlineError> : null}
        {!online ? (
          <p className="rounded-2xl bg-amber-soft px-4 py-3 text-[0.875rem]">
            You're offline. Reconnect to save changes.
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}

function Pickups({
  s,
  onSaved,
}: {
  s: PortalStudentDto;
  onSaved: (dto: PortalStudentDto) => void;
}) {
  const [editing, setEditing] = useState<PickupDto | null>(null);
  const [open, setOpen] = useState(false);
  const pickups = s.pickups ?? [];
  const canEdit = Boolean(s.editable?.pickups);
  const id = encodeURIComponent(s.student.clientId);
  const first = s.student.firstName;
  const edit = (p: PickupDto | null) => {
    setEditing(p);
    setOpen(true);
  };
  return (
    <PortalCard
      title="Pickup"
      action={
        canEdit ? (
          <Button
            variant="light"
            size="sm"
            icon={<UserPlus aria-hidden className="size-4" />}
            onPress={() => edit(null)}
          >
            Add person
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[0.9375rem] text-ink-2">
          Who besides {s.student.relation === "self" ? "your parents" : "you"} may pick {first} up
          after training. Coaches see this list, with photos, at check-in.
        </p>
        {pickups.length ? (
          <PickupList
            pickups={pickups}
            photoUrl={portalFileUrl}
            onEdit={canEdit ? edit : undefined}
          />
        ) : (
          <p className="text-[0.9375rem]">No one else is on file.</p>
        )}
      </div>
      {canEdit ? (
        <PickupSheet
          isOpen={open}
          onOpenChange={setOpen}
          pickup={editing}
          studentName={first}
          photoUrl={portalFileUrl}
          save={async (body) => {
            const dto = editing
              ? await portalApi.patch<PortalStudentDto>(
                  `/students/${id}/pickups/${editing.id}`,
                  body,
                )
              : await portalApi.post<PortalStudentDto>(`/students/${id}/pickups`, body);
            onSaved(dto);
            notify({
              tone: "success",
              title: editing ? "Saved" : `${first}'s pickup list updated`,
            });
          }}
          remove={async (p) => {
            const dto = await portalApi.del<PortalStudentDto>(`/students/${id}/pickups/${p.id}`);
            onSaved(dto);
            notify({ tone: "neutral", title: `${p.name} removed` });
          }}
        />
      ) : null}
    </PortalCard>
  );
}

/**
 * Profile: the details the academy keeps, and what the family keeps current themselves. Parents
 * update a child's health and emergency details and pickup people; adult students their own
 * health details and emergency contact; a teen's own login reads them.
 */
export function PortalProfile({ clientId }: { clientId: string }) {
  const student = usePortalStudent(clientId);
  const userId = usePortalAccount().data?.user.id ?? "";
  const qc = useQueryClient();
  const { current } = useCurrentStudent();
  const fmt = useAcademyFormat(student.data?.academy);
  const [editing, setEditing] = useState(false);
  const saved = (dto: PortalStudentDto) => {
    qc.setQueryData(keys.portal.student(userId, clientId), dto);
    void qc.invalidateQueries({ queryKey: keys.portal.home(userId) });
  };
  return (
    <PortalPage
      title="Profile"
      subtitle={current ? `${current.firstName} ${current.lastName}`.trim() : undefined}
      students
    >
      <QueryGate query={student}>
        {(s) => {
          const editable = s.editable ? canEditAnySafety(s.editable) : false;
          const healthEditable = Boolean(
            s.editable &&
              (s.editable.medical ||
                s.editable.emergency ||
                s.editable.guardianContact ||
                s.editable.shirtSize),
          );
          return (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start lg:gap-6">
              <Basics s={s} fmt={fmt} />
              <div className="flex flex-col gap-5">
                <Safety
                  s={s}
                  fmt={fmt}
                  onEdit={healthEditable ? () => setEditing(true) : undefined}
                />
                {s.pickupsApply ? <Pickups s={s} onSaved={saved} /> : null}
                <p className="flex items-start gap-3 px-1 text-[0.875rem] text-ink-2">
                  <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {editable
                      ? `Changes reach ${s.academy.name} at once. For anything else here, ask them.`
                      : readOnlyNote(s)}
                  </span>
                </p>
              </div>
              <SafetySheet isOpen={editing} onOpenChange={setEditing} s={s} onSaved={saved} />
            </div>
          );
        }}
      </QueryGate>
    </PortalPage>
  );
}
