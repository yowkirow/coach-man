import type { PublicAcademyDto } from "@shared/api-types";
import { ArrowLeft, KeyRound } from "lucide-react";
import { useState } from "react";
import { GoogleG } from "../../components/auth-layout";
import { Button } from "../../components/ui/button";
import { InlineError } from "../../components/ui/feedback";
import { TextField } from "../../components/ui/field";
import { errorMessage } from "../../lib/api";
import {
  AuthRequestError,
  abandonPasskeyAccount,
  authClient,
  defaultPasskeyName,
  passkeysSupported,
  signInWithGoogle,
  startEnrollPasskeyAccount,
} from "../../lib/auth-client";
import { StepHeading } from "./wizard-ui";

/** Plain words for a passkey that wasn't made. */
function passkeyFailure(message: string | undefined): string {
  return /cancel|not allowed|abort|timed out/i.test(message ?? "")
    ? "The passkey wasn't saved, so we didn't create your account. Try again when you're ready, or continue with Google."
    : "Your device couldn't save a passkey, so we didn't create your account. Try again, or continue with Google.";
}

/**
 * The wizard's first step for someone signed out: Google (back to this page afterwards), a
 * passkey they already have, or a new passkey-only account with just a name.
 */
export function EnrollSignIn({
  academy,
  slug,
  returnTo,
  googleError,
  onSignedIn,
}: {
  academy: PublicAcademyDto;
  slug: string;
  /** This page's address (Google comes back to it). */
  returnTo: string;
  googleError?: string;
  onSignedIn: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<null | "google" | "passkey" | "create">(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    googleError
      ? /access_denied|cancel/i.test(googleError)
        ? "Google sign-in was cancelled. Try again whenever you're ready."
        : "Google sign-in didn't finish. Try again, or use a passkey."
      : null,
  );
  const passkeys = passkeysSupported();

  const google = async () => {
    setPending("google");
    setError(null);
    try {
      await signInWithGoogle(returnTo, returnTo);
    } catch {
      setPending(null);
      setError("Couldn't reach Google. Check your connection and try again.");
    }
  };
  const passkey = async () => {
    setPending("passkey");
    setError(null);
    const res = await authClient.signIn.passkey();
    if (res?.error) {
      setPending(null);
      setError(
        /cancel|not allowed/i.test(res.error.message ?? "")
          ? "Passkey sign-in was cancelled."
          : "That passkey didn't work here. Continue with Google, or create a passkey account.",
      );
      return;
    }
    await onSignedIn();
    setPending(null);
  };
  /**
   * The account (a name, a placeholder address) is made and signed in, then the device makes the
   * passkey. A passkey that isn't made leaves an account nobody could sign into, so it's deleted.
   */
  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Enter your name so the academy knows who you are.");
      return;
    }
    setNameError(null);
    setError(null);
    setPending("create");
    try {
      await startEnrollPasskeyAccount(trimmed, slug);
    } catch (err) {
      setPending(null);
      setError(err instanceof AuthRequestError ? err.message : errorMessage(err));
      return;
    }
    const added = await authClient.passkey.addPasskey({ name: defaultPasskeyName() });
    if (added?.error) {
      await abandonPasskeyAccount();
      setPending(null);
      setError(passkeyFailure(added.error.message));
      return;
    }
    await onSignedIn();
    setPending(null);
  };

  if (creating) {
    return (
      <>
        <StepHeading title="Create your account">
          No Google needed: your phone's fingerprint, face, or screen lock signs you in. We only ask
          for your name, so {academy.name} knows who sent the request.
        </StepHeading>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <TextField
            label="Your name"
            value={name}
            onChange={(next) => {
              setName(next);
              if (nameError) setNameError(null);
            }}
            autoComplete="name"
            autoFocus
            placeholder="First and last name"
            error={nameError ?? undefined}
          />
          {error ? <InlineError>{error}</InlineError> : null}
          <Button
            type="submit"
            variant="dark"
            size="lg"
            icon={<KeyRound aria-hidden className="size-5" />}
            isPending={pending === "create"}
          >
            Create account and passkey
          </Button>
          <Button
            variant="ghost"
            size="lg"
            icon={<ArrowLeft aria-hidden className="size-5" />}
            isDisabled={pending === "create"}
            onPress={() => {
              setCreating(false);
              setError(null);
            }}
          >
            Other ways to sign in
          </Button>
        </form>
        <p className="mt-4 text-[0.8125rem] text-ink-2">
          The passkey stays on this device (and syncs where your phone syncs passwords). You can
          link Google later in the family portal's settings.
        </p>
      </>
    );
  }

  return (
    <>
      <StepHeading title="Sign in to enroll">
        Sign in so you can follow your request and see what to pay once {academy.name} approves it.
        There's no password.
      </StepHeading>
      <div className="flex flex-col gap-3">
        <Button
          variant="dark"
          size="lg"
          icon={<GoogleG />}
          isPending={pending === "google"}
          isDisabled={pending !== null && pending !== "google"}
          onPress={() => void google()}
        >
          Continue with Google
        </Button>
        {passkeys ? (
          <>
            <Button
              variant="light"
              size="lg"
              icon={<KeyRound aria-hidden className="size-5" />}
              isDisabled={pending !== null}
              onPress={() => {
                setError(null);
                setCreating(true);
              }}
            >
              Create a passkey account
            </Button>
            <Button
              variant="ghost"
              size="lg"
              isPending={pending === "passkey"}
              isDisabled={pending !== null && pending !== "passkey"}
              onPress={() => void passkey()}
            >
              I already have a passkey: sign in
            </Button>
          </>
        ) : null}
        {error ? <InlineError>{error}</InlineError> : null}
      </div>
      {passkeys ? (
        <p className="mt-5 text-[0.875rem] text-ink-2">
          No Google account? Create a passkey account: just your name and your phone's screen lock.
        </p>
      ) : null}
    </>
  );
}
