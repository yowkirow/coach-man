import type { AcademyDto, MeDto } from "@shared/api-types";
import {
  ACADEMY_SOCIAL_LABELS,
  ACADEMY_SOCIALS,
  type AcademySocial,
  isAcademySlug,
  slugify,
} from "@shared/domain";
import { type AcademyUpdateInput, academyUpdateSchema } from "@shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Copy, Eye, Image as ImageIcon, ImagePlus, QrCode, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { FileTrigger } from "react-aria-components";
import { copyText } from "../../components/domain/invite-link";
import { Button, buttonClass } from "../../components/ui/button";
import { ErrorState, InlineError, RowsSkeleton } from "../../components/ui/feedback";
import { Switch, TextAreaField, TextField } from "../../components/ui/field";
import { api, errorMessage, fieldErrors, fileUrl } from "../../lib/api";
import { initials } from "../../lib/format";
import { useAcademy } from "../../lib/hooks";
import { prepareImage, prepareWebsitePhoto, putImage } from "../../lib/images";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { OfflineNote } from "./offline";
import { SaveBar, SettingsSection } from "./sections";
import { changedFields, issuesToFields } from "./validation";

interface Draft {
  name: string;
  slug: string;
  tagline: string;
  about: string;
  contactPhone: string;
  contactEmail: string;
  address: string;
  mapUrl: string;
  socials: Record<AcademySocial, string>;
  paymentInstructions: string;
  policies: string;
  enrollmentOpen: boolean;
  listed: boolean;
}

function draftOf(a: AcademyDto): Draft {
  const socials = {} as Record<AcademySocial, string>;
  for (const key of ACADEMY_SOCIALS) socials[key] = a.socials[key] ?? "";
  return {
    name: a.name,
    // A legacy ws-… slug isn't a public address yet: start empty and suggest one.
    slug: isAcademySlug(a.slug) ? a.slug : "",
    tagline: a.tagline ?? "",
    about: a.about ?? "",
    contactPhone: a.contactPhone ?? "",
    contactEmail: a.contactEmail ?? "",
    address: a.address ?? "",
    mapUrl: a.mapUrl ?? "",
    socials,
    paymentInstructions: a.paymentInstructions ?? "",
    policies: a.policies ?? "",
    enrollmentOpen: a.enrollmentOpen,
    listed: a.listed,
  };
}

/** The draft as an update; an empty address means "keep the current one". */
function toInput(d: Draft) {
  const { slug, ...rest } = d;
  return slug.trim() ? { ...rest, slug: slug.trim() } : rest;
}

const FRIENDLY: Record<string, string> = {
  name: "Give your academy a name.",
  slug: "Use 3 to 40 lowercase letters and numbers, with single hyphens between words.",
  contactEmail: "That email doesn't look complete.",
  mapUrl: "Use a full link that starts with https://",
};

/** After a save: the profile, the name everywhere it shows (header, switcher), and the public page. */
function useStoreAcademy() {
  const qc = useQueryClient();
  return (academy: AcademyDto) => {
    qc.setQueryData(keys.academy, academy);
    qc.setQueryData<MeDto>(keys.me, (old) =>
      old ? { ...old, workspace: { ...old.workspace, name: academy.name } } : old,
    );
    void qc.invalidateQueries({ queryKey: keys.account });
    // The public page and its preview show the profile (and the cover photo).
    void qc.invalidateQueries({ queryKey: keys.publicPreview });
    void qc.invalidateQueries({ queryKey: keys.publicAcademy(academy.slug) });
  };
}

/** The academy's images: what each is called, where its key is kept, and how it's prepared. */
const IMAGES = {
  logo: {
    title: "Logo",
    noun: "logo",
    field: "logoKey",
    icon: ImagePlus,
    prepare: (file: File) =>
      prepareImage(file, { mode: "contain", maxEdge: 512, type: "image/png" }),
  },
  // The whole photo, landscape or not: the website decides how to frame it.
  cover: {
    title: "Cover photo",
    noun: "cover photo",
    field: "coverKey",
    icon: ImagePlus,
    prepare: prepareWebsitePhoto,
  },
  "payment-qr": {
    title: "QR code",
    noun: "QR code",
    field: "paymentQrKey",
    icon: QrCode,
    prepare: (file: File) =>
      prepareImage(file, { mode: "contain", maxEdge: 1200, type: "image/jpeg" }),
  },
} as const;

type ImageKind = keyof typeof IMAGES;

/** Logo, cover photo, or payment QR: upload (resized in the browser), replace, or remove. */
function ImageControl({ kind, academy }: { kind: ImageKind; academy: AcademyDto }) {
  const online = useOnline();
  const store = useStoreAcademy();
  const { title, noun, field, icon: Icon, prepare } = IMAGES[kind];
  const current = academy[field];
  const upload = useMutation({
    meta: { silent: true },
    mutationFn: async (file: File) =>
      putImage<{ key: string }>(`/academy/${kind}`, await prepare(file)),
    onSuccess: ({ key }) => {
      store({ ...academy, [field]: key });
      notify({ tone: "success", title: `${title} updated` });
    },
  });
  const remove = useMutation({
    meta: { silent: true },
    mutationFn: () => api.del(`/academy/${kind}`),
    onSuccess: () => {
      store({ ...academy, [field]: null });
      notify({ tone: "neutral", title: `${title} removed` });
    },
  });
  const busy = upload.isPending || remove.isPending;
  const error = upload.error ?? remove.error;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <FileTrigger
          acceptedFileTypes={["image/jpeg", "image/png", "image/webp"]}
          onSelect={(files) => {
            const file = files?.[0];
            if (file) upload.mutate(file);
          }}
        >
          <Button
            variant="light"
            size="sm"
            isDisabled={!online || busy}
            isPending={upload.isPending}
            icon={<Icon aria-hidden className="size-4" />}
          >
            {current ? `Change ${noun}` : `Upload ${noun}`}
          </Button>
        </FileTrigger>
        {current ? (
          <Button
            variant="ghost"
            size="sm"
            isDisabled={!online || busy}
            isPending={remove.isPending}
            icon={<Trash2 aria-hidden className="size-4" />}
            onPress={() => remove.mutate()}
          >
            Remove {noun}
          </Button>
        ) : null}
      </div>
      {error ? <InlineError>{errorMessage(error)}</InlineError> : null}
    </div>
  );
}

/** The cover photo as a 16:9 frame (how wide screens show it), or the empty frame waiting for one. */
function CoverPreview({ coverKey }: { coverKey: string | null }) {
  const src = fileUrl(coverKey);
  // A photo that can't load (offline, say) shows the empty frame instead of a broken image.
  const [failed, setFailed] = useState<string | null>(null);
  if (src && failed !== src) {
    return (
      <img
        src={src}
        alt="Your website's cover"
        onError={() => setFailed(src)}
        className="aspect-video w-full rounded-2xl bg-card object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex aspect-video w-full items-center justify-center rounded-2xl border border-dashed border-line-strong bg-card text-ink-3"
    >
      <ImageIcon className="size-8" />
    </span>
  );
}

/** How the academy looks where families meet it: logo, name, and tagline, as in the portal header. */
function Preview({ academy, draft }: { academy: AcademyDto; draft: Draft }) {
  const logo = fileUrl(academy.logoKey);
  const name = draft.name.trim() || academy.name;
  const [first = "", second = ""] = name.split(/\s+/);
  const slug = draft.slug.trim() || (isAcademySlug(academy.slug) ? academy.slug : "");
  return (
    <figure className="m-0 flex flex-col gap-4 rounded-[22px] bg-panel p-5">
      <div className="flex items-center gap-4">
        {logo ? (
          <img
            src={logo}
            alt={`${name} logo`}
            className="size-16 shrink-0 rounded-[22px] bg-card object-contain"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-16 shrink-0 items-center justify-center rounded-[22px] bg-card text-[1.125rem] font-semibold"
          >
            {initials({ firstName: first, lastName: second })}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-[1.375rem] leading-tight font-light tracking-[-0.01em] break-words">
            {name}
          </p>
          <p className="mt-1 text-[0.875rem] text-ink-2">
            {draft.tagline.trim() || "Add a tagline: one line about your academy"}
          </p>
        </div>
      </div>
      <figcaption className="text-[0.8125rem] break-all text-ink-2">
        {slug ? `${academy.publicBaseUrl}${slug}` : "No public address yet"}
      </figcaption>
    </figure>
  );
}

/**
 * Settings: the academy's name, public address, logo, its website's cover photo, tagline, contact
 * details, payment instructions with a QR code, policies, and whether the public page and
 * enrollment are open. Owners and admins only (`settings`).
 */
export function AcademyProfileSection() {
  const online = useOnline();
  const q = useAcademy();
  const store = useStoreAcademy();
  const academy = q.data;
  const seed = academy ? JSON.stringify(draftOf(academy)) : "";
  const [draft, setDraft] = useState<Draft | null>(academy ? draftOf(academy) : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed when the saved profile changes.
  useEffect(() => {
    setDraft(academy ? draftOf(academy) : null);
  }, [seed]);
  const save = useMutation({
    meta: { silent: true },
    mutationFn: (patch: AcademyUpdateInput) => api.patch<AcademyDto>("/academy", patch),
    onSuccess: (a) => {
      store(a);
      notify({ tone: "success", title: "Academy profile saved" });
    },
    // The server's field errors (a taken address) join the form's own, so editing clears them.
    onError: (e) => setErrors(fieldErrors(e)),
  });

  const body = (() => {
    if (q.isPending) return <RowsSkeleton rows={3} />;
    if (!academy || !draft) {
      return (
        <ErrorState
          title="Couldn't load the academy profile"
          message={errorMessage(q.error)}
          onRetry={() => void q.refetch()}
        />
      );
    }
    const dirty = JSON.stringify(draft) !== seed;
    // Editing a field clears its error: a stale error would also keep the field invalid.
    const clearError = (k: string) =>
      setErrors((e) => {
        if (!(k in e)) return e;
        const { [k]: _cleared, ...rest } = e;
        return rest;
      });
    const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
      setDraft((d) => (d ? { ...d, [k]: v } : d));
      clearError(k);
    };
    const setSocial = (k: AcademySocial, v: string) => {
      setDraft((d) => (d ? { ...d, socials: { ...d.socials, [k]: v } } : d));
      clearError(`socials.${k}`);
    };
    const err = (k: string) => errors[k];
    const suggestion = slugify(draft.name) || "your-academy";
    const submit = () => {
      const parsed = academyUpdateSchema.safeParse(toInput(draft));
      if (!parsed.success) {
        const issues = parsed.error.issues;
        const found = issuesToFields(
          issues.filter((i) => i.path[0] !== "socials"),
          FRIENDLY,
        );
        for (const i of issues) {
          if (i.path[0] === "socials" && i.path[1] !== undefined) {
            found[`socials.${String(i.path[1])}`] = i.message;
          }
        }
        setErrors(found);
        return;
      }
      setErrors({});
      const before = academyUpdateSchema.safeParse(toInput(draftOf(academy)));
      const patch = changedFields(parsed.data, before.success ? before.data : {});
      if (Object.keys(patch).length) save.mutate(patch);
    };
    return (
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (online && dirty) submit();
        }}
      >
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
            <Preview academy={academy} draft={draft} />
            <div className="flex flex-col gap-2">
              <p className="text-[0.9375rem] font-medium">Logo</p>
              <p className="text-[0.8125rem] text-ink-2">
                A square image works best: a PNG with a transparent background, or a JPEG. It shows
                on invites, your public page, and the family portal.
              </p>
              <ImageControl kind="logo" academy={academy} />
            </div>
          </div>

          <div className="grid gap-4 rounded-[22px] bg-panel p-4 sm:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] sm:items-start">
            <CoverPreview coverKey={academy.coverKey} />
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-[0.9375rem] font-medium">Cover photo</p>
              <p className="text-[0.8125rem] text-ink-2">
                The big photo on your website. Landscape photos work best.
              </p>
              <ImageControl kind="cover" academy={academy} />
            </div>
          </div>

          <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
            <TextField
              label="Academy name"
              value={draft.name}
              onChange={(v) => set("name", v)}
              error={err("name")}
            />
            <TextField
              label="Public address"
              value={draft.slug}
              onChange={(v) => set("slug", v.toLowerCase())}
              placeholder={suggestion}
              autoComplete="off"
              description={`Letters, numbers, and hyphens. Your page: ${academy.publicBaseUrl}${draft.slug.trim() || suggestion}`}
              error={err("slug")}
            />
            <TextField
              label="Tagline"
              value={draft.tagline}
              onChange={(v) => set("tagline", v)}
              placeholder="One line about your academy"
              error={err("tagline")}
              className="sm:col-span-2"
            />
            <TextAreaField
              label="About"
              value={draft.about}
              onChange={(v) => set("about", v)}
              rows={4}
              placeholder="Who you coach, where, and how"
              error={err("about")}
              className="sm:col-span-2"
            />
          </div>

          <fieldset className="m-0 grid min-w-0 gap-x-4 gap-y-5 border-0 p-0 sm:grid-cols-2">
            <legend className="mb-4 p-0 text-[1.125rem] font-medium">Contact and location</legend>
            <TextField
              label="Phone"
              type="tel"
              inputMode="tel"
              value={draft.contactPhone}
              onChange={(v) => set("contactPhone", v)}
              error={err("contactPhone")}
            />
            <TextField
              label="Email"
              type="email"
              inputMode="email"
              value={draft.contactEmail}
              onChange={(v) => set("contactEmail", v)}
              error={err("contactEmail")}
            />
            <TextField
              label="Address"
              value={draft.address}
              onChange={(v) => set("address", v)}
              error={err("address")}
            />
            <TextField
              label="Map link"
              type="url"
              inputMode="text"
              value={draft.mapUrl}
              onChange={(v) => set("mapUrl", v)}
              placeholder="https://maps.google.com/…"
              error={err("mapUrl")}
            />
          </fieldset>

          <fieldset className="m-0 grid min-w-0 gap-x-4 gap-y-5 border-0 p-0 sm:grid-cols-2">
            <legend className="mb-1 p-0 text-[1.125rem] font-medium">Social links</legend>
            <p className="-mt-2 text-[0.8125rem] text-ink-2 sm:col-span-2">
              Full links that start with https://. Leave any you don't use empty.
            </p>
            {ACADEMY_SOCIALS.map((key) => (
              <TextField
                key={key}
                label={ACADEMY_SOCIAL_LABELS[key]}
                type="url"
                inputMode="text"
                value={draft.socials[key]}
                onChange={(v) => setSocial(key, v)}
                placeholder="https://"
                error={err(`socials.${key}`)}
              />
            ))}
          </fieldset>

          <fieldset className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
            <legend className="mb-4 p-0 text-[1.125rem] font-medium">Payments and policies</legend>
            <TextAreaField
              label="How to pay"
              value={draft.paymentInstructions}
              onChange={(v) => set("paymentInstructions", v)}
              rows={4}
              placeholder="GCash or bank transfer details, who to pay, and what to write as the reference"
              description="Families see this when they pay. CoachMan doesn't take payments; families send proof and you confirm it."
              error={err("paymentInstructions")}
            />
            <div className="flex flex-wrap items-start gap-4 rounded-[22px] bg-panel p-4">
              {academy.paymentQrKey ? (
                <img
                  src={fileUrl(academy.paymentQrKey) ?? undefined}
                  alt="Payment QR code"
                  className="size-32 shrink-0 rounded-2xl bg-card object-contain"
                />
              ) : (
                <span
                  aria-hidden
                  className="flex size-32 shrink-0 items-center justify-center rounded-2xl border border-dashed border-line-strong bg-card text-ink-3"
                >
                  <QrCode className="size-8" />
                </span>
              )}
              <div className="flex min-w-[12rem] flex-1 flex-col gap-2">
                <p className="text-[0.9375rem] font-medium">Payment QR code</p>
                <p className="text-[0.8125rem] text-ink-2">
                  Your GCash or bank QR, shown beside the payment details.
                </p>
                <ImageControl kind="payment-qr" academy={academy} />
              </div>
            </div>
            <TextAreaField
              label="Policies"
              value={draft.policies}
              onChange={(v) => set("policies", v)}
              rows={4}
              placeholder="Cancellations, make-up sessions, refunds, what to bring"
              error={err("policies")}
            />
          </fieldset>

          <div className="flex flex-col divide-y divide-line rounded-[22px] bg-panel px-4 py-1">
            <div className="py-2">
              <Switch
                isSelected={draft.listed}
                onChange={(v) => set("listed", v)}
                description="Anyone with the address can see your academy's page: profile, programs, and coaches who chose to appear."
              >
                Show the academy page
              </Switch>
            </div>
            <div className="py-2">
              <Switch
                isSelected={draft.enrollmentOpen}
                onChange={(v) => set("enrollmentOpen", v)}
                description="Families can ask to enroll from your page. You approve each request."
              >
                Take enrollment requests
              </Switch>
            </div>
          </div>
        </div>
        {save.error && !Object.keys(fieldErrors(save.error)).length ? (
          <div className="mt-4">
            <InlineError>{errorMessage(save.error)}</InlineError>
          </div>
        ) : null}
        {dirty ? (
          <div className="mt-4">
            <OfflineNote />
          </div>
        ) : null}
        <SaveBar
          dirty={dirty}
          onDiscard={() => {
            setDraft(draftOf(academy));
            setErrors({});
            save.reset();
          }}
          isPending={save.isPending}
          disabled={!online}
        />
      </form>
    );
  })();

  // Staff can preview the page as families will see it, listed or not; the link is for sharing
  // once it's listed.
  const shareUrl = academy?.listed ? academy.publicUrl : null;
  return (
    <SettingsSection
      id="academy-profile"
      title="Academy profile"
      description="How your academy appears on invites, its public page, and the family portal."
      action={
        academy ? (
          <>
            <Link
              to="/a/$slug"
              params={{ slug: academy.slug }}
              search={{ preview: 1 }}
              className={buttonClass("light", "md")}
            >
              <Eye aria-hidden className="size-4.5" />
              Preview public page
            </Link>
            {shareUrl ? (
              <Button
                variant="light"
                icon={<Copy aria-hidden className="size-4.5" />}
                onPress={() => void copyText(shareUrl, "Link")}
              >
                Copy link
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {body}
    </SettingsSection>
  );
}
