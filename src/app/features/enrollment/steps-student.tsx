import type {
  EnrollmentContextDto,
  EnrollStudentChoiceDto,
  PublicPackageDto,
  PublicProgramDto,
} from "@shared/api-types";
import {
  checkNewChild,
  checkNewSelf,
  KIDS_SIZE_AGES,
  MAX_PICKUPS,
  programAgeNote,
  SELF_RATINGS,
  selfRatingHint,
  UNIFORM_SIZES,
} from "@shared/enrollment";
import { ageOn } from "@shared/time";
import { Plus, Trash2 } from "lucide-react";
import { Label, RadioGroup } from "react-aria-components";
import { Button, IconButton } from "../../components/ui/button";
import { SelectField, TextAreaField, TextField } from "../../components/ui/field";
import { fullName } from "../../lib/format";
import type { PickupDraft, WizardDraft } from "./draft";
import { ChoiceCard, Note } from "./wizard-ui";

export interface StepProps {
  draft: WizardDraft;
  update: (fn: (d: WizardDraft) => WizardDraft) => void;
  errors: Record<string, string>;
}

const groupLabel = "text-[0.8125rem] font-medium text-ink-2";

/** The student chosen in the first step, if they're already on the academy's books. */
export function chosenStudent(
  draft: WizardDraft,
  context: EnrollmentContextDto | undefined,
): EnrollStudentChoiceDto | null {
  if (!context) return null;
  if (draft.who.kind === "self") return context.self;
  if (draft.who.kind === "child") {
    return context.children.find((c) => c.clientId === draft.who.clientId) ?? null;
  }
  return null;
}

/** Whether the student being enrolled is under 18 (new children always are). */
export function chosenIsMinor(draft: WizardDraft, context: EnrollmentContextDto | undefined) {
  if (draft.who.kind === "new_child") return true;
  if (draft.who.kind === "self" && !context?.self) return false;
  return chosenStudent(draft, context)?.minor ?? false;
}

/** The first name the wizard talks about ("you" for the caller themself). */
export function studentName(draft: WizardDraft, context: EnrollmentContextDto | undefined) {
  if (draft.who.kind === "self") return null;
  if (draft.who.kind === "new_child") return draft.who.firstName.trim() || "your child";
  return chosenStudent(draft, context)?.firstName ?? "your child";
}

/** Problems with the first step, by field (empty when it's fine to go on). */
export function whoErrors(
  draft: WizardDraft,
  context: EnrollmentContextDto | undefined,
  today: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  const who = draft.who;
  if (!who.kind) {
    out.kind = "Choose who's training.";
    return out;
  }
  const existing = chosenStudent(draft, context);
  if (existing) {
    if (!existing.allowed.ok) out.kind = existing.allowed.message;
    return out;
  }
  if (who.kind === "child") {
    out.kind = "Choose who's training.";
    return out;
  }
  if (!who.firstName.trim()) out.firstName = "Add a first name.";
  const check =
    who.kind === "self"
      ? checkNewSelf({ birthDate: who.birthDate || null, today })
      : checkNewChild({ birthDate: who.birthDate || null, today });
  if (!check.ok) out.birthDate = check.message;
  return out;
}

/** Step 1: me, one of my children, or a new child. */
export function WhoStep({
  draft,
  update,
  errors,
  context,
  program,
  today,
}: StepProps & {
  context: EnrollmentContextDto;
  program: PublicProgramDto | null;
  today: string;
}) {
  const closed = !context.enrollmentOpen;
  const value = draft.who.kind === "child" ? `child:${draft.who.clientId}` : (draft.who.kind ?? "");
  const pick = (v: string) =>
    update((d) => {
      const [kind, clientId] = v.split(":");
      const chosen =
        kind === "self"
          ? context.self
          : kind === "child"
            ? (context.children.find((c) => c.clientId === clientId) ?? null)
            : null;
      const details = chosen?.details;
      return {
        ...d,
        who: {
          ...d.who,
          kind: kind as WizardDraft["who"]["kind"],
          clientId: clientId ?? null,
          // A new "me" starts from the account's name.
          ...(kind === "self" && !context.self && !d.who.firstName
            ? {
                firstName: context.account.name.trim().split(/\s+/)[0] ?? "",
                lastName: context.account.name.trim().split(/\s+/).slice(1).join(" "),
              }
            : {}),
        },
        // What the academy has on file fills the blanks of the details step.
        answers: details
          ? {
              ...d.answers,
              phone: d.answers.phone || details.phone || "",
              medicalNotes: d.answers.medicalNotes || details.medicalNotes || "",
              emergencyName: d.answers.emergencyName || details.emergencyName || "",
              emergencyPhone: d.answers.emergencyPhone || details.emergencyPhone || "",
              shirtSize: d.answers.shirtSize || details.shirtSize || "",
            }
          : d.answers,
      };
    });
  const isNew = draft.who.kind === "new_child" || (draft.who.kind === "self" && !context.self);
  const ageNote =
    program && isNew && draft.who.birthDate
      ? programAgeNote(program, draft.who.birthDate, today)
      : program && chosenStudent(draft, context)?.birthDate
        ? programAgeNote(program, chosenStudent(draft, context)?.birthDate ?? null, today)
        : null;
  const ageOf = (c: EnrollStudentChoiceDto) =>
    c.birthDate ? `Age ${ageOn(c.birthDate, today)}` : c.minor ? "Junior" : "Adult";

  return (
    <div className="flex flex-col gap-6">
      <RadioGroup
        value={value}
        onChange={pick}
        isInvalid={Boolean(errors.kind)}
        className="flex flex-col gap-2"
      >
        <Label className={groupLabel}>Who's training</Label>
        {context.self ? (
          <ChoiceCard
            value="self"
            title="Me"
            body={context.self.allowed.ok ? fullName(context.self) : context.self.allowed.message}
            isDisabled={!context.self.allowed.ok}
          />
        ) : (
          <ChoiceCard
            value="self"
            title="Me"
            body={
              closed ? "Not taking new students right now" : "I'm 18 or older, and I'll be training"
            }
            isDisabled={closed}
          />
        )}
        {context.children.map((c) => (
          <ChoiceCard
            key={c.clientId}
            value={`child:${c.clientId}`}
            title={fullName(c)}
            body={c.allowed.ok ? `${ageOf(c)} · your child` : c.allowed.message}
            isDisabled={!c.allowed.ok}
          />
        ))}
        <ChoiceCard
          value="new_child"
          title={context.children.length ? "Add another child" : "My child"}
          body={closed ? "Not taking new students right now" : "Under 18, new to the academy"}
          isDisabled={closed}
        />
        {errors.kind ? (
          <p className="text-[0.8125rem] font-medium text-[#b42318]">{errors.kind}</p>
        ) : null}
      </RadioGroup>

      {isNew ? (
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-[1.125rem] font-medium">
            {draft.who.kind === "self" ? "About you" : "About your child"}
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={draft.who.kind === "self" ? "First name" : "Child's first name"}
              value={draft.who.firstName}
              onChange={(v) => update((d) => ({ ...d, who: { ...d.who, firstName: v } }))}
              autoComplete={draft.who.kind === "self" ? "given-name" : "off"}
              error={errors.firstName}
            />
            <TextField
              label={draft.who.kind === "self" ? "Last name" : "Child's last name"}
              value={draft.who.lastName}
              onChange={(v) => update((d) => ({ ...d, who: { ...d.who, lastName: v } }))}
              autoComplete={draft.who.kind === "self" ? "family-name" : "off"}
            />
          </div>
          <TextField
            label={draft.who.kind === "self" ? "Your birth date" : "Child's birth date"}
            type="date"
            value={draft.who.birthDate}
            max={today}
            onChange={(v) => update((d) => ({ ...d, who: { ...d.who, birthDate: v } }))}
            description={
              draft.who.kind === "self"
                ? "Students 18 and over enroll themselves."
                : "Students under 18 are enrolled by a parent or guardian."
            }
            error={errors.birthDate}
          />
        </fieldset>
      ) : null}

      {ageNote ? <Note title="Check the ages">{ageNote}</Note> : null}
      {closed ? (
        <Note tone="sky" title="Enrollment for new students is closed for now">
          Students already training here can still enroll and renew.
        </Note>
      ) : null}
    </div>
  );
}

/** Problems with the level step. */
export function levelErrors(draft: WizardDraft, tier: PublicPackageDto): Record<string, string> {
  const out: Record<string, string> = {};
  if (tier.asksSelfRating && draft.answers.selfRating === null && !draft.answers.selfRatingUnsure) {
    out.selfRating = "Pick a level, or “Not sure”.";
  }
  if (tier.includesUniform && !draft.answers.shirtSize) out.shirtSize = "Pick a shirt size.";
  return out;
}

const SIZE_OPTIONS = [
  ...UNIFORM_SIZES.kids.map((s) => ({ id: s, label: s, description: KIDS_SIZE_AGES[s] })),
  ...UNIFORM_SIZES.adults.map((s) => ({ id: s, label: s })),
];

/** Step 2 (when the tier asks): the student's own level, and the training shirt's size. */
export function LevelStep({
  draft,
  update,
  errors,
  tier,
  whose,
}: StepProps & { tier: PublicPackageDto; whose: string | null }) {
  const rating =
    draft.answers.selfRatingUnsure && draft.answers.selfRating === null
      ? "unsure"
      : draft.answers.selfRating === null
        ? ""
        : draft.answers.selfRating.toFixed(1);
  return (
    <div className="flex flex-col gap-8">
      {tier.asksSelfRating ? (
        <RadioGroup
          value={rating}
          onChange={(v) =>
            update((d) => ({
              ...d,
              answers: {
                ...d.answers,
                selfRating: v === "unsure" ? null : Number(v),
                selfRatingUnsure: v === "unsure",
              },
            }))
          }
          isInvalid={Boolean(errors.selfRating)}
          className="flex flex-col gap-2"
        >
          <Label className="text-[1.125rem] font-medium">
            {whose ? `${whose}'s level` : "Your level"}
          </Label>
          <p className="-mt-1 mb-1 text-[0.875rem] text-ink-2">
            On the 1.0 to 5.5 rating scale. It helps the coaches place {whose ? whose : "you"}, and
            they check it on court.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SELF_RATINGS.map((r) => (
              <ChoiceCard
                key={r}
                value={r.toFixed(1)}
                title={<span className="num">{r.toFixed(1)}</span>}
                body={selfRatingHint(r)}
              />
            ))}
            <ChoiceCard value="unsure" title="Not sure" body="The coaches will rate on court" />
          </div>
          {errors.selfRating ? (
            <p className="text-[0.8125rem] font-medium text-[#b42318]">{errors.selfRating}</p>
          ) : null}
        </RadioGroup>
      ) : null}
      {tier.includesUniform ? (
        <SelectField
          label="Training shirt size"
          options={SIZE_OPTIONS}
          value={draft.answers.shirtSize || null}
          onChange={(v) => update((d) => ({ ...d, answers: { ...d.answers, shirtSize: v } }))}
          placeholder="Choose a size"
          description="The academy's training uniform comes with this package."
          error={errors.shirtSize}
        />
      ) : null}
    </div>
  );
}

/** Problems with the contact and safety step. */
export function contactErrors(draft: WizardDraft): Record<string, string> {
  const out: Record<string, string> = {};
  const a = draft.answers;
  if (a.phone.trim().length < 5) out.phone = "Add a phone number the academy can reach you on.";
  if (!a.emergencyName.trim()) out.emergencyName = "Add someone to call in an emergency.";
  if (a.emergencyPhone.trim().length < 5) out.emergencyPhone = "Add their phone number.";
  a.pickups.forEach((p, i) => {
    if (!p.name.trim() && (p.phone.trim() || p.relationship.trim())) {
      out[`pickups.${i}`] = "Add the person's name, or remove the row.";
    }
  });
  return out;
}

/** Step 3: how to reach the family, health notes, emergency contact, and (juniors) pickups. */
export function ContactStep({
  draft,
  update,
  errors,
  minor,
  whose,
  placeholderEmail,
}: StepProps & { minor: boolean; whose: string | null; placeholderEmail: boolean }) {
  const set = (patch: Partial<WizardDraft["answers"]>) =>
    update((d) => ({ ...d, answers: { ...d.answers, ...patch } }));
  const setPickup = (key: string, patch: Partial<PickupDraft>) =>
    update((d) => ({
      ...d,
      answers: {
        ...d.answers,
        pickups: d.answers.pickups.map((p) => (p.key === key ? { ...p, ...patch } : p)),
      },
    }));
  const who = whose ?? "you";
  return (
    <div className="flex flex-col gap-8">
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-[1.125rem] font-medium">How to reach you</legend>
        <TextField
          label="Your mobile number"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={draft.answers.phone}
          onChange={(v) => set({ phone: v })}
          description={
            whose ? `The academy calls or texts you about ${whose} on this number.` : undefined
          }
          error={errors.phone}
        />
        {placeholderEmail ? (
          <TextField
            label="Email (optional)"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={draft.answers.email}
            onChange={(v) => set({ email: v })}
            description="Your passkey account has no email. Add one if the academy may write to you."
            error={errors.email}
          />
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-[1.125rem] font-medium">Health and emergencies</legend>
        <TextAreaField
          label="Health notes (optional)"
          value={draft.answers.medicalNotes}
          onChange={(v) => set({ medicalNotes: v })}
          description={`Allergies, conditions, or medicines the coaches should know about for ${who}. Leave it blank if there's nothing.`}
          error={errors.medicalNotes}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Emergency contact"
            value={draft.answers.emergencyName}
            onChange={(v) => set({ emergencyName: v })}
            autoComplete="off"
            placeholder="Name"
            error={errors.emergencyName}
          />
          <TextField
            label="Emergency contact's phone"
            type="tel"
            inputMode="tel"
            value={draft.answers.emergencyPhone}
            onChange={(v) => set({ emergencyPhone: v })}
            autoComplete="off"
            error={errors.emergencyPhone}
          />
        </div>
      </fieldset>

      {minor ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-[1.125rem] font-medium">Who may pick {who} up</legend>
          <p className="text-[0.875rem] text-ink-2">
            People besides you who may collect {who} after training. You can always pick up.
          </p>
          {draft.answers.pickups.map((p, i) => (
            <div key={p.key} className="flex flex-col gap-3 rounded-[22px] bg-panel p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[0.875rem] font-medium">Person {i + 1}</p>
                <IconButton
                  label={`Remove ${p.name.trim() || `person ${i + 1}`}`}
                  size="sm"
                  onPress={() =>
                    update((d) => ({
                      ...d,
                      answers: {
                        ...d.answers,
                        pickups: d.answers.pickups.filter((x) => x.key !== p.key),
                      },
                    }))
                  }
                >
                  <Trash2 aria-hidden className="size-4" />
                </IconButton>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <TextField
                  label="Name"
                  value={p.name}
                  onChange={(v) => setPickup(p.key, { name: v })}
                  autoComplete="off"
                  error={errors[`pickups.${i}`]}
                />
                <TextField
                  label="Relationship"
                  value={p.relationship}
                  onChange={(v) => setPickup(p.key, { relationship: v })}
                  placeholder="Grandmother, driver…"
                  autoComplete="off"
                />
                <TextField
                  label="Phone"
                  type="tel"
                  inputMode="tel"
                  value={p.phone}
                  onChange={(v) => setPickup(p.key, { phone: v })}
                  autoComplete="off"
                />
              </div>
            </div>
          ))}
          {draft.answers.pickups.length < MAX_PICKUPS ? (
            <Button
              variant="light"
              size="sm"
              className="self-start"
              icon={<Plus aria-hidden className="size-4" />}
              onPress={() =>
                update((d) => ({
                  ...d,
                  answers: {
                    ...d.answers,
                    pickups: [
                      ...d.answers.pickups,
                      { key: crypto.randomUUID(), name: "", relationship: "", phone: "" },
                    ],
                  },
                }))
              }
            >
              Add a person
            </Button>
          ) : null}
        </fieldset>
      ) : null}

      <TextAreaField
        label="Anything else the coaches should know (optional)"
        value={draft.answers.notes}
        onChange={(v) => set({ notes: v })}
        rows={2}
      />
    </div>
  );
}
