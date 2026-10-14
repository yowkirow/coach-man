import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { AuthLayout, GoogleG } from "../components/auth-layout";
import { Button } from "../components/ui/button";
import { AvatarStack, KpiTile, Pill } from "../components/ui/display";
import { InlineError } from "../components/ui/feedback";
import { authClient, passkeysSupported, signInWithGoogle } from "../lib/auth-client";
import { meQuery } from "../lib/hooks";
import { keys } from "../lib/query";

const safeNext = (v: unknown) =>
  typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : undefined;

export const Route = createFileRoute("/sign-in")({
  validateSearch: (s: Record<string, unknown>): { next?: string; error?: string } => ({
    next: safeNext(s.next),
    error: typeof s.error === "string" ? s.error : undefined,
  }),
  beforeLoad: async ({ context, search }) => {
    try {
      await context.queryClient.ensureQueryData(meQuery);
    } catch {
      return;
    }
    throw redirect({ href: search.next ?? "/" });
  },
  component: SignIn,
});

function errorText(code: string) {
  if (/access_denied|cancel/i.test(code))
    return "Google sign-in was cancelled. Try again whenever you're ready.";
  return "Google sign-in didn't finish. Try again, or use a passkey if you've added one.";
}

function SignIn() {
  const { next, error } = Route.useSearch();
  const router = useRouter();
  const qc = useQueryClient();
  const [pending, setPending] = useState<null | "passkey" | "google">(null);
  const [message, setMessage] = useState<string | null>(error ? errorText(error) : null);
  const canPasskey = passkeysSupported();

  const passkey = async () => {
    setPending("passkey");
    setMessage(null);
    const res = await authClient.signIn.passkey();
    if (res?.error) {
      setPending(null);
      setMessage(
        /cancel|not allowed/i.test(res.error.message ?? "")
          ? "Passkey sign-in was cancelled."
          : "That passkey didn't work here. Continue with Google, then add a passkey for this device.",
      );
      return;
    }
    await qc.invalidateQueries({ queryKey: keys.me });
    router.history.push(next ?? "/");
  };

  const google = async () => {
    setPending("google");
    setMessage(null);
    try {
      await signInWithGoogle(next ?? "/");
    } catch {
      setPending(null);
      setMessage("Couldn't reach Google. Check your connection and try again.");
    }
  };

  return (
    <AuthLayout
      panel={
        <>
          <p className="mt-10 max-w-[15ch] text-[2.25rem] leading-[1.04] font-light tracking-[-0.025em] sm:text-[2.75rem] lg:mt-auto lg:text-[3.5rem]">
            Your courts, clients, and credits in one calm place.
          </p>
          <p className="mt-4 max-w-[46ch] text-[0.9375rem] text-night-ink-2">
            Check players in on court, even offline. Packages count themselves down, balances stay
            honest, and every player's progress lives in one profile.
          </p>
          <div aria-hidden className="mt-10 hidden max-w-[540px] grid-cols-2 gap-2.5 sm:grid">
            <KpiTile label="Sessions" value="4" tint="lime" />
            <KpiTile label="Checked in" value="11/14" tint="sky" />
            <div className="col-span-2 rounded-[24px] bg-lime p-4 text-ink">
              <div className="flex items-start gap-3 [--avatar-ring:var(--color-lime)]">
                <AvatarStack
                  people={[
                    { firstName: "Ana", lastName: "Reyes" },
                    { firstName: "Ben", lastName: "Ocampo" },
                    { firstName: "Carla", lastName: "Tan" },
                  ]}
                  max={2}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[1rem] font-medium">Beginner clinic</p>
                  <p className="num text-[0.75rem] text-ink/70">9:00–10:30 · Court 3</p>
                </div>
              </div>
              <div className="mt-3 flex h-11 items-center gap-2 rounded-full border border-ink/15 px-3">
                <span className="flex-1 text-[0.8125rem]">On court now</span>
                <Pill tone="white">
                  <span className="num">6/8</span> in
                </Pill>
              </div>
            </div>
          </div>
        </>
      }
    >
      <h1 className="text-[2rem] leading-tight font-light tracking-[-0.02em]">Sign in</h1>
      <p className="mt-2 text-ink-2">
        For coaches. Your workspace and your clients' details stay private to you.
      </p>
      {message ? (
        <div className="mt-5">
          <InlineError>{message}</InlineError>
        </div>
      ) : null}
      <div className="mt-6 flex flex-col gap-3">
        {canPasskey ? (
          <Button
            variant="dark"
            size="lg"
            icon={<KeyRound aria-hidden className="size-5" />}
            isPending={pending === "passkey"}
            isDisabled={pending === "google"}
            onPress={() => void passkey()}
          >
            Sign in with a passkey
          </Button>
        ) : null}
        <Button
          variant="light"
          size="lg"
          icon={<GoogleG />}
          isPending={pending === "google"}
          isDisabled={pending === "passkey"}
          onPress={() => void google()}
        >
          Continue with Google
        </Button>
      </div>
      <p className="mt-6 text-[0.875rem] text-ink-2">
        New to CoachMan? Continue with Google to create your workspace. You'll add a passkey next,
        so signing in on court takes one tap.
      </p>
    </AuthLayout>
  );
}
