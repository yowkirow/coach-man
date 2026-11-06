import type {
  AccountDto,
  EnrollmentSubmittedDto,
  PublicAcademyDto,
  PublicConsentDocumentDto,
} from "@shared/api-types";
import { enrollmentMode } from "@shared/enrollment";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Mail, MessageCircle, Phone, Send } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button, buttonClass } from "../../components/ui/button";
import { ErrorState, InlineError, Skeleton } from "../../components/ui/feedback";
import { ApiRequestError, accountApi, errorMessage, portalApi } from "../../lib/api";
import { type Format, fullName } from "../../lib/format";
import { keys } from "../../lib/query";
import { contactActions } from "../public/text";
import {
  clearDraft,
  emptyDraft,
  loadDraft,
  type StepId,
  saveDraft,
  type WizardDraft,
} from "./draft";
import { useEnrollmentContext, usePublicConsents, usePublicSessions } from "./queries";
import { EnrollSignIn } from "./sign-in-step";
import {
  ConsentsStep,
  consentErrors,
  DoneStep,
  duplicateOf,
  ReviewStep,
  WhenStep,
  whenErrors,
} from "./steps-finish";
import {
  ContactStep,
  chosenIsMinor,
  chosenStudent,
  contactErrors,
  LevelStep,
  levelErrors,
  studentName,
  WhoStep,
  whoErrors,
} from "./steps-student";
import { MODE_QUESTION } from "./text";
import { Note, StepActions, StepHeading, WizardFrame, type WizardStep } from "./wizard-ui";

/** The signed-in account, or null when signed out (the wizard signs people in itself). */
function useWizardAccount() {
  return useQuery({
    queryKey: ["enroll-account"],
    queryFn: async () => {
      try {
        return await accountApi.get<AccountDto>();
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 0,
  });
}

function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-16 rounded-[22px]" />
      <Skeleton className="h-16 rounded-[22px]" />
    </div>
  );
}

/** Ways to reach the academy when enrolling isn't possible online. */
function ContactLinks({ academy }: { academy: PublicAcademyDto }) {
  const actions = contactActions(academy);
  if (!actions.length) return null;
  const icon = { messenger: MessageCircle, text: MessageCircle, call: Phone, email: Mail };
  return (
    <ul className="flex flex-wrap gap-2">
      {actions.map((a, i) => {
        const Icon = icon[a.id];
        return (
          <li key={a.id}>
            <a href={a.href} className={buttonClass(i === 0 ? "dark" : "light", "md")}>
              <Icon aria-hidden className="size-4.5" />
              {a.label}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function ClosedPanel({
  academy,
  signedIn,
  onSignIn,
}: {
  academy: PublicAcademyDto;
  signedIn: boolean;
  onSignIn: () => void;
}) {
  return (
    <>
      <StepHeading title="Enrollment is closed for now">
        {academy.name} isn't taking new students right now. Get in touch to ask when it opens again.
      </StepHeading>
      <ContactLinks academy={academy} />
      <div className="mt-8 border-t border-line pt-5 text-[0.9375rem] text-ink-2">
        {signedIn ? (
          <p>
            Already training here? Renewing and adding a package still work from{" "}
            <Link to="/my" className="font-medium text-ink underline underline-offset-4">
              your family portal
            </Link>
            .
          </p>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <p>Already training at {academy.name}? You can still renew or add a package.</p>
            <Button variant="light" onPress={onSignIn}>
              Sign in
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

const STEP_TITLES: Record<StepId, (who: string | null) => string> = {
  who: () => "Who's training?",
  level: (who) => (who ? `About ${who}'s game` : "About your game"),
  contact: () => "Contact and safety",
  when: () => "",
  consents: () => "Consent forms",
  review: () => "Check and send",
};

/** Which step a refusal from the server belongs to, and what it says there. */
function placeError(
  err: unknown,
): { step: StepId; errors: Record<string, string>; message: string | null } | null {
  if (!(err instanceof ApiRequestError)) return null;
  const f = err.fields;
  const keysOf = Object.keys(f);
  if (keysOf.some((k) => k.startsWith("who."))) {
    return {
      step: "who",
      errors: {
        ...(f["who.birthDate"] ? { birthDate: f["who.birthDate"] } : {}),
        ...(f["who.firstName"] ? { firstName: f["who.firstName"] } : {}),
      },
      message: null,
    };
  }
  if (f["answers.selfRating"] || f["answers.shirtSize"]) {
    return {
      step: "level",
      errors: {
        ...(f["answers.selfRating"] ? { selfRating: f["answers.selfRating"] } : {}),
        ...(f["answers.shirtSize"] ? { shirtSize: f["answers.shirtSize"] } : {}),
      },
      message: null,
    };
  }
  const answer = keysOf.find((k) => k.startsWith("answers."));
  if (answer) {
    const field = answer.replace(/^answers\./, "");
    return { step: "contact", errors: { [field]: f[answer] ?? err.message }, message: null };
  }
  if (f.startMonth || f.lessonId || f.startDate) {
    return {
      step: "when",
      errors: { when: f.startMonth ?? f.lessonId ?? f.startDate ?? err.message },
      message: null,
    };
  }
  switch (err.code) {
    case "consents_required":
    case "consent_changed":
      return { step: "consents", errors: {}, message: err.message };
    case "duplicate_request":
    case "already_enrolled":
    case "session_full":
    case "session_unavailable":
      return { step: "when", errors: {}, message: err.message };
    case "enrollment_closed":
    case "minor_self":
    case "ask_guardian":
    case "adult_enrolls":
    case "not_a_minor":
    case "needs_guardian":
    case "too_young":
    case "needs_birth_date":
      return { step: "who", errors: {}, message: err.message };
    default:
      return null;
  }
}

/**
 * The enrollment wizard (/a/<slug>/enroll?package=<id>): sign in, then who's training, their
 * level and shirt size (when the tier asks), contact and safety details, when (a month, a trial
 * session, or a start date), the consent forms to sign, and a last check before sending. Answers
 * are kept on the device as they're typed, and Back never loses them.
 */
export function EnrollWizard({
  academy,
  slug,
  tierId,
  fmt,
  googleError,
}: {
  academy: PublicAcademyDto;
  slug: string;
  tierId: string;
  fmt: Format;
  googleError?: string;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const tier = academy.packages.find((p) => p.id === tierId) ?? null;
  const program = tier?.programId
    ? (academy.programs.find((p) => p.id === tier.programId) ?? null)
    : null;
  const mode = tier ? enrollmentMode(tier) : "date";
  const account = useWizardAccount();
  const signedIn = Boolean(account.data);
  const context = useEnrollmentContext(slug, signedIn && Boolean(tier));
  // Public: read even before sign-in, so the step list is right from the start.
  const consents = usePublicConsents(slug, Boolean(tier));
  const sessions = usePublicSessions(slug, program?.id ?? null, signedIn && mode === "session");
  const [draft, setDraft] = useState<WizardDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  // Errors from a step's own check clear as the answers are fixed; a refusal from the server stays
  // until the next try.
  const ownCheck = useRef(false);
  const [done, setDone] = useState<EnrollmentSubmittedDto | null>(null);
  const [wantsSignIn, setWantsSignIn] = useState(false);
  const me = account.data;
  const userId = me?.user.id;
  const returnTo = `/a/${encodeURIComponent(slug)}/enroll?package=${encodeURIComponent(tierId)}`;

  // The person's own draft for this tier, else a fresh one.
  useEffect(() => {
    if (!userId || !tier) return;
    setDraft((prev) => {
      if (prev && prev.userId === userId) return prev;
      const stored = loadDraft(slug, tier.id, userId);
      if (stored) return stored;
      const fresh = emptyDraft(userId);
      return { ...fresh, signerName: me?.user.name ?? "" };
    });
  }, [userId, tier, slug, me?.user.name]);
  useEffect(() => {
    if (draft && tier && !done) saveDraft(slug, tier.id, draft);
  }, [draft, tier, slug, done]);

  const update = useCallback((fn: (d: WizardDraft) => WizardDraft) => {
    setDraft((d) => (d ? fn(d) : d));
  }, []);

  const ctx = context.data;
  const today = ctx?.today ?? academy.today;
  const minor = draft ? chosenIsMinor(draft, ctx) : false;
  const student = draft ? chosenStudent(draft, ctx) : null;
  const signedIds = student?.signedDocumentIds ?? [];
  const docs: PublicConsentDocumentDto[] = (consents.data ?? []).filter(
    (d) => (d.appliesTo === "all" || minor) && !signedIds.includes(d.id),
  );
  const whose = draft ? studentName(draft, ctx) : null;
  const steps: (WizardStep & { id: StepId })[] = [
    { id: "who", label: "Who's training" },
    ...(tier?.asksSelfRating || tier?.includesUniform
      ? [{ id: "level" as const, label: tier.asksSelfRating ? "Level" : "Uniform" }]
      : []),
    { id: "contact", label: "Contact and safety" },
    {
      id: "when",
      label: mode === "session" ? "Session" : mode === "month" ? "Month" : "Start date",
    },
    ...(docs.length ? [{ id: "consents" as const, label: "Consents" }] : []),
    { id: "review", label: "Check and send" },
  ];
  const current: StepId =
    draft && steps.some((s) => s.id === draft.step) ? draft.step : (steps[0]?.id ?? "who");
  const at = steps.findIndex((s) => s.id === current);

  // A new step reads from its heading.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the step changes.
  useEffect(() => {
    const h = document.querySelector<HTMLElement>("#main h1");
    if (h && at > 0) {
      h.tabIndex = -1;
      h.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0 });
  }, [current, done]);

  const dup = draft && tier ? duplicateOf(draft, ctx, tier, mode) : null;
  const pickedSession = sessions.data?.find((s) => s.id === draft?.lessonId);
  const periodWords =
    mode === "month" && draft?.startMonth
      ? ` for ${fmt.month(draft.startMonth)}`
      : mode === "session" && pickedSession
        ? ` on ${fmt.day(pickedSession.date)}`
        : "";
  const dupText = dup
    ? whose
      ? dup.kind === "open"
        ? `${whose} already has a request for ${tier?.name}${periodWords}. It's waiting for the academy.`
        : `${whose} is already enrolled in ${tier?.name}${periodWords}.`
      : dup.kind === "open"
        ? `You already have a request for ${tier?.name}${periodWords}. It's waiting for the academy.`
        : `You're already enrolled in ${tier?.name}${periodWords}.`
    : null;

  const errorsFor = (id: StepId, d: WizardDraft): Record<string, string> => {
    if (!tier) return {};
    switch (id) {
      case "who":
        return whoErrors(d, ctx, today);
      case "level":
        return levelErrors(d, tier);
      case "contact":
        return contactErrors(d);
      case "when": {
        const e = whenErrors(d, mode, today, sessions.data);
        return dupText && !e.when ? { when: "Pick another option, or check your portal." } : e;
      }
      case "consents":
        return consentErrors(d, docs);
      default:
        return {};
    }
  };
  const go = (to: StepId) => {
    ownCheck.current = false;
    setErrors({});
    setMessage(null);
    update((d) => ({ ...d, step: to }));
  };
  const next = () => {
    if (!draft) return;
    const errs = errorsFor(current, draft);
    ownCheck.current = true;
    setErrors(errs);
    if (Object.keys(errs).length) {
      setMessage("Some answers need attention.");
      return;
    }
    const following = steps[at + 1];
    if (following) go(following.id);
  };
  const back = () => {
    const previous = steps[at - 1];
    if (previous) go(previous.id);
  };

  // Each answer fixed takes its error away (and the summary once none is left); nothing new is
  // flagged until Continue is pressed again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-checks when the answers change.
  useEffect(() => {
    if (!draft || !ownCheck.current) return;
    const showing = Object.keys(errors);
    if (!showing.length) return;
    const now = errorsFor(current, draft);
    const still = showing.filter((k) => now[k]);
    if (still.length === showing.length) return;
    setErrors(Object.fromEntries(still.map((k) => [k, now[k] as string])));
    if (!still.length) setMessage(null);
  }, [draft]);

  const send = useMutation({
    meta: { silent: true },
    mutationFn: () => {
      const d = draft as WizardDraft;
      const a = d.answers;
      const who =
        d.who.kind === "child"
          ? { kind: "child" as const, clientId: d.who.clientId }
          : d.who.kind === "self" && ctx?.self
            ? { kind: "self" as const }
            : {
                kind: (d.who.kind ?? "new_child") as "self" | "new_child",
                firstName: d.who.firstName.trim(),
                lastName: d.who.lastName.trim(),
                birthDate: d.who.birthDate,
              };
      return portalApi.post<EnrollmentSubmittedDto>("/enrollments", {
        id: d.requestId,
        slug,
        packageId: tierId,
        who,
        ...(mode === "month"
          ? { startMonth: d.startMonth }
          : mode === "session"
            ? { lessonId: d.lessonId }
            : { startDate: d.startDate }),
        answers: {
          phone: a.phone.trim(),
          email: me?.emailIsPlaceholder ? a.email.trim() : "",
          selfRating: tier?.asksSelfRating ? a.selfRating : null,
          selfRatingUnsure: tier?.asksSelfRating ? a.selfRatingUnsure : false,
          shirtSize: tier?.includesUniform ? a.shirtSize : "",
          medicalNotes: a.medicalNotes,
          emergencyName: a.emergencyName.trim(),
          emergencyPhone: a.emergencyPhone.trim(),
          notes: a.notes,
          pickups: minor
            ? a.pickups
                .filter((p) => p.name.trim())
                .map((p) => ({ name: p.name, relationship: p.relationship, phone: p.phone }))
            : [],
        },
        signatures: docs.map((doc) => ({
          documentId: doc.id,
          version: doc.version,
          signerName: d.signerName.trim(),
        })),
      });
    },
    onSuccess: (res) => {
      if (tier) clearDraft(slug, tier.id);
      setDone(res);
      void qc.invalidateQueries({ queryKey: keys.account });
      void qc.invalidateQueries({ queryKey: keys.portal.all });
      qc.removeQueries({ queryKey: keys.enrollmentContext(slug) });
    },
    onError: (err) => {
      const placed = placeError(err);
      if (placed?.step === "consents") void consents.refetch();
      if (placed?.step === "when") void sessions.refetch();
      if (placed?.step === "who" || placed?.step === "when") void context.refetch();
      if (placed && steps.some((s) => s.id === placed.step)) {
        ownCheck.current = false;
        setErrors(placed.errors);
        setMessage(placed.message ?? "Some answers need attention.");
        update((d) => ({ ...d, step: placed.step }));
        return;
      }
      setMessage(errorMessage(err));
    },
  });

  const frame = (children: ReactNode, frameSteps: WizardStep[] = steps, at2: string = current) => (
    <WizardFrame
      academy={academy}
      slug={slug}
      tier={tier}
      program={program}
      fmt={fmt}
      steps={frameSteps}
      current={at2}
    >
      {children}
    </WizardFrame>
  );

  if (!tier) {
    return frame(
      <>
        <StepHeading title="This package isn't offered any more">
          {academy.name} may have changed its packages. Pick one from Enroll now.
        </StepHeading>
        <Link to="/a/$slug/enroll" params={{ slug }} className={buttonClass("dark", "lg")}>
          See {academy.name}'s packages
        </Link>
      </>,
      [],
      "",
    );
  }
  if (account.isPending) return frame(<Loading />);
  if (!me) {
    if (!academy.enrollmentOpen && !wantsSignIn) {
      return frame(
        <ClosedPanel academy={academy} signedIn={false} onSignIn={() => setWantsSignIn(true)} />,
        [],
        "",
      );
    }
    return frame(
      <EnrollSignIn
        academy={academy}
        slug={slug}
        returnTo={returnTo}
        googleError={googleError}
        onSignedIn={async () => {
          await account.refetch();
        }}
      />,
      [{ id: "sign-in", label: "Sign in" }, ...steps],
      "sign-in",
    );
  }
  if (context.isPending || !draft) return frame(<Loading />);
  if (!ctx) {
    return frame(
      <ErrorState
        title="Couldn't load your details"
        message={errorMessage(context.error)}
        onRetry={() => void context.refetch()}
      />,
    );
  }
  if (done) {
    const s = done.request;
    const studentLabel =
      draft.who.kind === "self" ? "You" : `${s.student.firstName} ${s.student.lastName}`.trim();
    const periodLabel =
      s.mode === "month" && s.startMonth
        ? `in ${fmt.month(s.startMonth)}, once it's approved`
        : s.session
          ? `on ${fmt.longDay(fmt.dayOf(s.session.startsAt))}, once it's approved`
          : s.startDate
            ? `on ${fmt.longDay(s.startDate)}, once it's approved`
            : "";
    return frame(
      <DoneStep
        academyName={academy.name}
        studentLabel={studentLabel}
        tierName={tier.name}
        periodLabel={periodLabel}
        onOpenPortal={() => {
          void qc.invalidateQueries({ queryKey: keys.account });
          void navigate({ to: "/my" });
        }}
      />,
      steps,
      "done",
    );
  }
  if (ctx.blocked) {
    return frame(
      <>
        <StepHeading title="Ask your parent or guardian">{ctx.blocked.message}</StepHeading>
        <Link to="/my" className={buttonClass("light", "lg")}>
          Back to My family
        </Link>
      </>,
      [],
      "",
    );
  }
  const anyone = ctx.self || ctx.children.length;
  if (!ctx.enrollmentOpen && !anyone) {
    return frame(<ClosedPanel academy={academy} signedIn onSignIn={() => undefined} />, [], "");
  }

  const title = current === "when" ? MODE_QUESTION[mode] : STEP_TITLES[current](whose);
  const studentLabel =
    draft.who.kind === "self"
      ? ctx.self
        ? `You (${fullName(ctx.self)})`
        : `You (${`${draft.who.firstName} ${draft.who.lastName}`.trim()})`
      : draft.who.kind === "child" && student
        ? fullName(student)
        : `${draft.who.firstName} ${draft.who.lastName}`.trim();
  const props = { draft, update, errors };
  const sending = send.isPending;

  return frame(
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (current === "review") send.mutate();
        else next();
      }}
    >
      <StepHeading title={title}>
        {current === "who"
          ? `Enrolling in ${tier.name}${program ? `, ${program.name}` : ""} at ${academy.name}.`
          : current === "consents"
            ? `${academy.name} asks for ${docs.length === 1 ? "this form" : "these forms"} before training. Read ${docs.length === 1 ? "it" : "each one"}, then sign by typing your name.`
            : current === "review"
              ? "Nothing is sent until you press Send request."
              : current === "contact"
                ? "So the coaches know how to reach you, and what to do if something happens."
                : null}
      </StepHeading>
      {current === "who" ? (
        <WhoStep {...props} context={ctx} program={program} today={today} />
      ) : current === "level" ? (
        <LevelStep {...props} tier={tier} whose={whose} />
      ) : current === "contact" ? (
        <ContactStep
          {...props}
          minor={minor}
          whose={whose}
          placeholderEmail={ctx.account.emailIsPlaceholder}
        />
      ) : current === "when" ? (
        <WhenStep
          {...props}
          mode={mode}
          tier={tier}
          today={today}
          fmt={fmt}
          sessions={sessions.data}
          sessionsLoading={sessions.isPending}
          duplicateText={dupText}
        />
      ) : current === "consents" ? (
        <ConsentsStep {...props} docs={docs} minor={minor} whose={whose} />
      ) : (
        <ReviewStep
          draft={draft}
          academy={academy}
          tier={tier}
          program={program}
          mode={mode}
          fmt={fmt}
          studentLabel={studentLabel}
          sessions={sessions.data}
          docs={docs}
        />
      )}
      {message ? (
        <div className="mt-5">
          {current === "review" || !Object.keys(errors).length ? (
            <InlineError>{message}</InlineError>
          ) : (
            <Note tone="coral">{message}</Note>
          )}
        </div>
      ) : null}
      <StepActions
        back={
          at > 0 ? (
            <Button
              variant="ghost"
              size="lg"
              icon={<ArrowLeft aria-hidden className="size-5" />}
              isDisabled={sending}
              onPress={back}
            >
              Back
            </Button>
          ) : (
            <Link
              to="/a/$slug"
              params={{ slug }}
              className={buttonClass("ghost", "lg", "max-w-full min-w-0")}
            >
              <ArrowLeft aria-hidden className="size-5 shrink-0" />
              <span className="min-w-0 truncate">{academy.name}</span>
            </Link>
          )
        }
        next={
          current === "review" ? (
            <Button
              type="submit"
              variant="dark"
              size="lg"
              icon={<Send aria-hidden className="size-5" />}
              isPending={sending}
            >
              Send request
            </Button>
          ) : (
            <Button type="submit" variant="dark" size="lg">
              Continue
              <ArrowRight aria-hidden className="size-5" />
            </Button>
          )
        }
      />
    </form>,
  );
}
