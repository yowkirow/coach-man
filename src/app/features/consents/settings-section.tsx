import type { ConsentDocumentDto } from "@shared/api-types";
import {
  CONSENT_TEMPLATE_KINDS,
  CONSENT_TEMPLATE_SUMMARIES,
  type ConsentTemplateKind,
  consentTemplate,
} from "@shared/consent-templates";
import {
  CONSENT_APPLIES_TO_LABELS,
  CONSENT_KIND_LABELS,
  normalizeConsentBody,
} from "@shared/consents";
import { CONSENT_KINDS, type ConsentAppliesTo, type ConsentKind } from "@shared/domain";
import { consentDocumentSchema } from "@shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, IconButton } from "../../components/ui/button";
import { Pill } from "../../components/ui/display";
import { EmptyState, ErrorState, InlineError, RowsSkeleton } from "../../components/ui/feedback";
import {
  Segmented,
  SelectField,
  Switch,
  TextAreaField,
  TextField,
} from "../../components/ui/field";
import { ConfirmSheet, Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { plural } from "../../lib/format";
import { useMe } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { OfflineNote } from "../settings/offline";
import { SettingsSection } from "../settings/sections";
import { changedFields, issuesToFields } from "../settings/validation";
import { CONSENT_KIND_ICONS, StarterTextNote, useConsentDocuments } from "./consents";

const FRIENDLY: Record<string, string> = {
  title: "Give the document a title.",
  body: "Write the text families will sign (up to 20,000 characters).",
};

function useInvalidateConsents() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.consentDocuments });
    void qc.invalidateQueries({ queryKey: ["client-consents"] });
    void qc.invalidateQueries({ queryKey: ["clients"] });
  };
}

interface Draft {
  kind: ConsentKind;
  title: string;
  body: string;
  required: boolean;
  appliesTo: ConsentAppliesTo;
  active: boolean;
}

function ConsentDocumentSheet({
  isOpen,
  onOpenChange,
  doc,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  doc: ConsentDocumentDto | null;
}) {
  const online = useOnline();
  const invalidate = useInvalidateConsents();
  const [d, setDraft] = useState<Draft>({
    kind: "other",
    title: "",
    body: "",
    required: true,
    appliesTo: "all",
    active: true,
  });
  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<ConsentDocumentDto | null>(doc);
  const editing = isOpen ? doc : shown;

  const save = useMutation({
    meta: { silent: true },
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? api.patch<ConsentDocumentDto>(`/consent-documents/${editing.id}`, body)
        : api.post<ConsentDocumentDto>("/consent-documents", body),
    onSuccess: (saved) => {
      invalidate();
      notify({
        tone: "success",
        title: editing ? `${saved.title} saved` : `${saved.title} added`,
        body:
          editing && saved.version !== editing.version
            ? `This is version ${saved.version}. Earlier signers will be asked to sign again.`
            : saved.active
              ? "Families can sign it."
              : "It's a draft: families don't see it yet.",
      });
      onOpenChange(false);
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when the sheet opens.
  useEffect(() => {
    if (!isOpen) return;
    setShown(doc);
    setDraft(
      doc
        ? {
            kind: doc.kind,
            title: doc.title,
            body: doc.body,
            required: doc.required,
            appliesTo: doc.appliesTo,
            active: doc.active,
          }
        : { kind: "other", title: "", body: "", required: true, appliesTo: "all", active: true },
    );
    setErrors({});
    save.reset();
  }, [isOpen]);

  const bodyChanged = editing
    ? normalizeConsentBody(d.body) !== normalizeConsentBody(editing.body)
    : false;
  const bumps = Boolean(editing && editing.signedCurrent > 0 && bodyChanged);

  const submit = () => {
    const parsed = consentDocumentSchema.safeParse(d);
    if (!parsed.success) {
      setErrors(issuesToFields(parsed.error.issues, FRIENDLY));
      return;
    }
    setErrors({});
    if (!editing) {
      save.mutate(parsed.data);
      return;
    }
    const patch = changedFields(
      { ...parsed.data, body: normalizeConsentBody(parsed.data.body) },
      { ...editing, body: normalizeConsentBody(editing.body) },
    );
    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }
    save.mutate(patch);
  };
  const err = (k: string) => errors[k] ?? fieldErrors(save.error)[k];

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="lg"
      title={editing ? "Edit consent form" : "New consent form"}
      description={
        editing
          ? `Version ${editing.version} · ${plural(editing.signedCurrent, "signature")} on this version`
          : "Families read it and sign by typing their full name."
      }
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="dark" isDisabled={!online} isPending={save.isPending} onPress={submit}>
            {bumps ? `Save as version ${(editing?.version ?? 1) + 1}` : "Save"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (online) submit();
        }}
      >
        {editing && !editing.active ? <StarterTextNote /> : null}
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <SelectField
            label="Kind"
            options={CONSENT_KINDS.map((k) => ({ id: k, label: CONSENT_KIND_LABELS[k] }))}
            value={d.kind}
            onChange={(k) => set({ kind: k as ConsentKind })}
          />
          <TextField
            label="Title"
            value={d.title}
            onChange={(title) => set({ title })}
            placeholder="e.g. Activity waiver and release"
            error={err("title")}
          />
        </div>
        <TextAreaField
          label="Text"
          value={d.body}
          onChange={(body) => set({ body })}
          rows={12}
          description="Plain text. Leave a blank line between paragraphs."
          error={err("body")}
        />
        {bumps && editing ? (
          <p
            role="status"
            className="rounded-[18px] bg-amber-soft px-4 py-3 text-[0.875rem] text-ink"
          >
            Saving starts version {editing.version + 1}.{" "}
            {plural(editing.signedCurrent, "person has", "people have")} signed version{" "}
            {editing.version}; their signatures stay with it, and they'll show as needing to sign
            again.
          </p>
        ) : null}
        <Segmented
          label="Who signs it"
          value={d.appliesTo}
          onChange={(v) => set({ appliesTo: v as ConsentAppliesTo })}
          options={[
            { id: "all", label: CONSENT_APPLIES_TO_LABELS.all },
            { id: "minors", label: CONSENT_APPLIES_TO_LABELS.minors },
          ]}
        />
        <p className="-mt-3 text-[0.8125rem] text-ink-2">
          For a student under 18 only a parent or guardian's signature counts. Adults sign for
          themselves.
        </p>
        <div className="flex flex-col divide-y divide-line rounded-[22px] bg-panel px-4 py-1">
          <Switch
            isSelected={d.required}
            onChange={(required) => set({ required })}
            description={
              d.required
                ? "Students without it show as missing consents."
                : "Optional: families may sign it, nobody is chased for it."
            }
          >
            Required
          </Switch>
          <Switch
            isSelected={d.active}
            onChange={(active) => set({ active })}
            description={
              d.active ? "Families see it and can sign it." : "A draft: only your team sees it."
            }
          >
            Active
          </Switch>
        </div>
        {save.error ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
        <OfflineNote />
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

function TemplatesSheet({
  isOpen,
  onOpenChange,
  existing,
  onAdded,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  existing: ConsentDocumentDto[];
  onAdded: (doc: ConsentDocumentDto) => void;
}) {
  const online = useOnline();
  const me = useMe().data;
  const invalidate = useInvalidateConsents();
  const add = useMutation({
    meta: { silent: true },
    mutationFn: (kind: ConsentTemplateKind) =>
      api.post<ConsentDocumentDto>("/consent-documents/templates", { kind }),
    onSuccess: (doc) => {
      invalidate();
      notify({
        tone: "success",
        title: `${doc.title} added as a draft`,
        body: "Read it and adjust it, then turn it on.",
      });
      onAdded(doc);
    },
  });
  const academy = me?.workspace.name ?? "";
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="lg"
      title="Start from a template"
      description={`Each is filled in with ${academy || "your academy's name"} and added as a draft families don't see until you turn it on.`}
    >
      <div className="flex flex-col gap-4">
        <StarterTextNote />
        <ul className="flex flex-col gap-2">
          {CONSENT_TEMPLATE_KINDS.map((kind) => {
            const t = consentTemplate(kind, academy);
            const Icon = CONSENT_KIND_ICONS[t.kind];
            const have = existing.some((d) => d.kind === t.kind);
            return (
              <li key={kind} className="flex items-start gap-3 rounded-[22px] bg-panel p-4">
                <span
                  aria-hidden
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card"
                >
                  <Icon className="size-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.title}</p>
                  <p className="mt-0.5 text-[0.8125rem] text-ink-2">
                    {CONSENT_TEMPLATE_SUMMARIES[kind]}
                  </p>
                  <p className="mt-1 text-[0.8125rem] text-ink-2">
                    {t.required ? "Required" : "Optional"} ·{" "}
                    {CONSENT_APPLIES_TO_LABELS[t.appliesTo]}
                    {have ? " · You have one already" : ""}
                  </p>
                </div>
                <Button
                  variant="light"
                  size="sm"
                  isDisabled={!online}
                  isPending={add.isPending && add.variables === kind}
                  onPress={() => add.mutate(kind)}
                >
                  Add<span className="sr-only"> {t.title}</span>
                </Button>
              </li>
            );
          })}
        </ul>
        {add.error ? <InlineError>{errorMessage(add.error)}</InlineError> : null}
      </div>
    </Sheet>
  );
}

/** Settings → Consent forms (owners and admins): the academy's waivers and consents. */
export function ConsentsSection() {
  const online = useOnline();
  const docs = useConsentDocuments();
  const invalidate = useInvalidateConsents();
  const [editing, setEditing] = useState<ConsentDocumentDto | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [removing, setRemoving] = useState<ConsentDocumentDto | null>(null);
  const [removingTitle, setRemovingTitle] = useState("");

  const remove = useMutation({
    meta: { silent: true },
    mutationFn: (d: ConsentDocumentDto) => api.del(`/consent-documents/${d.id}`),
    onSuccess: (_r, d) => {
      invalidate();
      notify({ tone: "success", title: `${d.title} deleted` });
      setRemoving(null);
    },
  });

  const open = (d: ConsentDocumentDto | null) => {
    setEditing(d);
    setSheetOpen(true);
  };
  const list = docs.data ?? [];

  return (
    <SettingsSection
      id="consents"
      title="Consent forms"
      description="Waivers and consents families sign by typing their name. Changing the text of a signed form starts a new version, and earlier signers are asked to sign again."
      action={
        list.length ? (
          <>
            <Button
              variant="light"
              icon={<FilePlus2 aria-hidden className="size-4.5" />}
              isDisabled={!online}
              onPress={() => setTemplatesOpen(true)}
            >
              Start from a template
            </Button>
            <Button
              variant="light"
              icon={<Plus aria-hidden className="size-4.5" />}
              isDisabled={!online}
              onPress={() => open(null)}
            >
              New form
            </Button>
          </>
        ) : null
      }
    >
      {docs.isPending ? (
        <RowsSkeleton rows={2} />
      ) : !docs.data ? (
        <ErrorState
          title="Couldn't load consent forms"
          message={errorMessage(docs.error)}
          onRetry={() => void docs.refetch()}
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<FileText aria-hidden className="size-5" />}
          title="No consent forms yet"
          body="Start from a waiver, a Data Privacy Act consent, a parental consent, or a photo and video consent, then make it your own."
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="dark" isDisabled={!online} onPress={() => setTemplatesOpen(true)}>
                Start from a template
              </Button>
              <Button variant="light" isDisabled={!online} onPress={() => open(null)}>
                Write your own
              </Button>
            </div>
          }
        />
      ) : (
        <ul className="-my-3 flex flex-col divide-y divide-line">
          {list.map((d) => {
            const Icon = CONSENT_KIND_ICONS[d.kind];
            return (
              <li key={d.id} className="flex items-center gap-3 py-3">
                <span
                  aria-hidden
                  className={`flex size-11 shrink-0 items-center justify-center rounded-full text-ink ${d.active ? "bg-mint" : "bg-panel"}`}
                >
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium break-words">{d.title}</span>
                    {d.active ? <Pill tone="mint">Active</Pill> : <Pill tone="panel">Draft</Pill>}
                  </p>
                  <p className="num text-[0.8125rem] text-ink-2">
                    {[
                      CONSENT_KIND_LABELS[d.kind],
                      d.required ? "Required" : "Optional",
                      CONSENT_APPLIES_TO_LABELS[d.appliesTo],
                      `Version ${d.version}`,
                      `${plural(d.signedCurrent, "signature")}`,
                    ].join(" · ")}
                  </p>
                </div>
                <IconButton label={`Edit ${d.title}`} isDisabled={!online} onPress={() => open(d)}>
                  <Pencil aria-hidden className="size-4.5" />
                </IconButton>
                {d.signedTotal === 0 ? (
                  <IconButton
                    label={`Delete ${d.title}`}
                    isDisabled={!online}
                    onPress={() => {
                      remove.reset();
                      setRemovingTitle(d.title);
                      setRemoving(d);
                    }}
                  >
                    <Trash2 aria-hidden className="size-4.5" />
                  </IconButton>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <ConsentDocumentSheet isOpen={sheetOpen} onOpenChange={setSheetOpen} doc={editing} />
      <TemplatesSheet
        isOpen={templatesOpen}
        onOpenChange={setTemplatesOpen}
        existing={list}
        onAdded={(doc) => {
          setTemplatesOpen(false);
          open(doc);
        }}
      />
      <ConfirmSheet
        isOpen={removing !== null}
        onOpenChange={(o) => {
          if (!o) setRemoving(null);
        }}
        title={`Delete ${removingTitle}?`}
        body={
          <div className="flex flex-col gap-3">
            <p>Nobody has signed it, so it's removed for good.</p>
            {remove.error ? <InlineError>{errorMessage(remove.error)}</InlineError> : null}
          </div>
        }
        confirmLabel="Delete"
        isPending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </SettingsSection>
  );
}
