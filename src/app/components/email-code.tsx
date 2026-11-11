import { SIGN_IN_CODE_MINUTES } from "@shared/domain";
import { isDeliverableEmail } from "@shared/email";
import { ArrowLeft, Mail } from "lucide-react";
import { type ClipboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { AuthRequestError, sendSignInCode, signInWithCode } from "../lib/auth-client";
import { Button } from "./ui/button";
import { InlineError } from "./ui/feedback";
import { TextField } from "./ui/field";

const CODE_LENGTH = 6;
/** How long after each code "Send a new code" waits. */
const RESEND_SECONDS = 30;

const digitsOf = (text: string) => text.replace(/\D/g, "");

const messageOf = (err: unknown) =>
  err instanceof Error ? err.message : "Something went wrong. Try again.";

/** Seconds as a countdown reads them: "0:24". */
const countdown = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * "Email me a code": an address (and a name, for someone joining), then the 6-digit code the
 * Worker emails there. Codes work inside the installed app, unlike a link. Without an invite the
 * Worker answers the same for any address (only an account's gets a code), so the second step says
 * "if"; on the join page (`known`) the invite's own rules decide, and the step says it went. The
 * invite link's token rides along in a request header (lib/auth-client.ts).
 */
export function EmailCodeForm({
  inviteToken,
  askName = false,
  known = false,
  emailHint,
  onSignedIn,
  onBack,
}: {
  inviteToken?: string;
  /** A new account's name (the join page): new accounts are only made from an invite. */
  askName?: boolean;
  /** The join page: the invite says who may get a code, so the address is confirmed. */
  known?: boolean;
  /** Help under the email field. */
  emailHint?: ReactNode;
  onSignedIn: () => void | Promise<void>;
  onBack: () => void;
}) {
  const [step, setStep] = useState<"address" | "code">("address");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<null | "send" | "resend" | "verify">(null);
  const [sentAt, setSentAt] = useState(0);
  const [resent, setResent] = useState(false);
  const [wait, setWait] = useState(0);
  const [backAgain, setBackAgain] = useState(false);
  // Tried too often or expired: only a new code helps, so "Sign in" waits for one.
  const [spent, setSpent] = useState(false);
  // One request at a time, whatever the buttons show yet (auto-submit runs from typing).
  const busy = useRef(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!sentAt) return;
    let timer = 0;
    const tick = () => {
      const left = Math.max(0, Math.ceil((sentAt + RESEND_SECONDS * 1000 - Date.now()) / 1000));
      setWait(left);
      if (left === 0) window.clearInterval(timer);
    };
    timer = window.setInterval(tick, 1000);
    tick();
    return () => window.clearInterval(timer);
  }, [sentAt]);

  const requestCode = async () => {
    if (busy.current) return;
    const address = email.trim().toLowerCase();
    const nameProblem =
      askName && !name.trim() ? "Enter your name so the academy knows who you are." : null;
    const emailProblem = isDeliverableEmail(address)
      ? null
      : "Enter one email address, like name@example.com.";
    setNameError(nameProblem);
    setEmailError(emailProblem);
    setError(null);
    if (nameProblem || emailProblem) return;
    busy.current = true;
    setPending("send");
    try {
      await sendSignInCode(address, inviteToken);
    } catch (err) {
      setError(messageOf(err));
      return;
    } finally {
      busy.current = false;
      setPending(null);
    }
    setSentTo(address);
    setCode("");
    setResent(false);
    setSpent(false);
    setSentAt(Date.now());
    setStep("code");
  };

  const resend = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending("resend");
    setError(null);
    try {
      await sendSignInCode(sentTo, inviteToken);
    } catch (err) {
      setError(messageOf(err));
      return;
    } finally {
      busy.current = false;
      setPending(null);
    }
    setCode("");
    setResent(true);
    setSpent(false);
    setSentAt(Date.now());
    codeRef.current?.focus();
  };

  /** Signs in; on success the page moves on (onSignedIn), so the button stays pending. */
  const verify = async (value: string) => {
    if (busy.current || spent) return;
    if (value.length !== CODE_LENGTH) {
      setError(`Enter the ${CODE_LENGTH}-digit code from the email.`);
      codeRef.current?.focus();
      return;
    }
    busy.current = true;
    setPending("verify");
    setError(null);
    try {
      await signInWithCode(sentTo, value, {
        ...(askName ? { name: name.trim() } : {}),
        inviteToken,
      });
    } catch (err) {
      busy.current = false;
      setPending(null);
      setError(messageOf(err));
      setSpent(
        err instanceof AuthRequestError &&
          (err.code === "TOO_MANY_ATTEMPTS" || err.code === "OTP_EXPIRED"),
      );
      codeRef.current?.select();
      return;
    }
    await onSignedIn();
  };

  const changeCode = (raw: string) => {
    const next = digitsOf(raw).slice(0, CODE_LENGTH);
    setCode(next);
    if (spent) return;
    if (error) setError(null);
    // The last digit typed (or a whole code pasted or filled in) sends it.
    if (next.length === CODE_LENGTH && code.length < CODE_LENGTH) void verify(next);
  };

  /** A pasted code arrives digits only, whatever the email app copied around it. */
  const pasteCode = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = digitsOf(e.clipboardData.getData("text"));
    e.preventDefault();
    if (pasted.length >= CODE_LENGTH) {
      changeCode(pasted);
      return;
    }
    const input = e.currentTarget;
    const start = input.selectionStart ?? code.length;
    const end = input.selectionEnd ?? code.length;
    changeCode(code.slice(0, start) + pasted + code.slice(end));
  };

  const address = <span className="font-medium break-all text-ink">{sentTo}</span>;
  const fresh = resent ? "a new" : "a";

  return (
    <div>
      {/* Mounted in both steps, so what the second step says is announced as it opens. */}
      <div aria-live="polite">
        {step === "code" ? (
          <p className="mb-4 text-ink-2">
            {known ? (
              <>
                We sent {fresh} {CODE_LENGTH}-digit code to {address}. It works for{" "}
                {SIGN_IN_CODE_MINUTES} minutes.
              </>
            ) : (
              <>
                If {address} can sign in to CoachMan, {fresh} {CODE_LENGTH}-digit code is on its
                way. It works for {SIGN_IN_CODE_MINUTES} minutes. Invited by an academy? Open your
                invite link instead.
              </>
            )}
          </p>
        ) : null}
      </div>
      {/* Keyed, so each step mounts afresh and its first field takes focus. */}
      {step === "address" ? (
        <form
          key="address"
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void requestCode();
          }}
        >
          {askName ? (
            <TextField
              label="Your name"
              value={name}
              onChange={(next) => {
                setName(next);
                if (nameError) setNameError(null);
              }}
              autoComplete="name"
              autoFocus={!backAgain}
              maxLength={80}
              placeholder="First and last name"
              error={nameError ?? undefined}
            />
          ) : null}
          <TextField
            label="Your email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(next) => {
              setEmail(next);
              if (emailError) setEmailError(null);
            }}
            autoFocus={!askName || backAgain}
            placeholder="name@example.com"
            description={emailHint}
            error={emailError ?? undefined}
          />
          {error ? <InlineError>{error}</InlineError> : null}
          <Button
            type="submit"
            variant="dark"
            size="lg"
            icon={<Mail aria-hidden className="size-5" />}
            isPending={pending === "send"}
          >
            Email me a code
          </Button>
          <Button
            variant="ghost"
            size="lg"
            icon={<ArrowLeft aria-hidden className="size-5" />}
            isDisabled={pending !== null}
            onPress={onBack}
          >
            Other ways to sign in
          </Button>
        </form>
      ) : (
        <form
          key="code"
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void verify(code);
          }}
        >
          <TextField
            label="Code"
            value={code}
            onChange={changeCode}
            onPaste={pasteCode}
            inputRef={codeRef}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={CODE_LENGTH}
            autoFocus
            inputClassName="num text-[1.5rem]! tracking-[0.3em]"
          />
          {error ? <InlineError>{error}</InlineError> : null}
          <Button
            type="submit"
            variant="dark"
            size="lg"
            isPending={pending === "verify"}
            isDisabled={pending === "resend" || spent}
          >
            Sign in
          </Button>
          <Button
            variant="ghost"
            size="lg"
            isPending={pending === "resend"}
            isDisabled={wait > 0 || pending === "verify"}
            onPress={() => void resend()}
          >
            {wait > 0 ? (
              <span>
                Send a new code in <span className="num">{countdown(wait)}</span>
              </span>
            ) : (
              "Send a new code"
            )}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            icon={<ArrowLeft aria-hidden className="size-5" />}
            isDisabled={pending !== null}
            onPress={() => {
              setStep("address");
              setBackAgain(true);
              setCode("");
              setSpent(false);
              setError(null);
            }}
          >
            Use another email
          </Button>
        </form>
      )}
    </div>
  );
}
