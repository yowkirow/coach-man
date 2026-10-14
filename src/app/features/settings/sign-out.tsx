import { LogOut } from "lucide-react";
import { useState } from "react";
import { Button, type ButtonVariant } from "../../components/ui/button";
import { ConfirmSheet } from "../../components/ui/overlay";
import { authClient } from "../../lib/auth-client";
import { plural } from "../../lib/format";
import { clearLocalData, usePendingChanges } from "../../lib/offline";

async function signOutNow() {
  try {
    await authClient.signOut();
  } finally {
    await clearLocalData();
    window.location.assign("/sign-in");
  }
}

/** Sign out, warning first when check-ins or notes are still waiting to sync. */
export function SignOutButton({
  variant = "light",
  className = "",
}: {
  variant?: ButtonVariant;
  className?: string;
}) {
  const pending = usePendingChanges();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = () => {
    setBusy(true);
    void signOutNow();
  };
  return (
    <>
      <Button
        variant={variant}
        className={className}
        icon={<LogOut aria-hidden className="size-4.5" />}
        isPending={busy}
        onPress={() => (pending > 0 ? setConfirm(true) : go())}
      >
        Sign out
      </Button>
      <ConfirmSheet
        isOpen={confirm}
        onOpenChange={setConfirm}
        title="Sign out with unsynced changes?"
        body={`${plural(pending, "change")} from this device haven't reached the server yet. Signing out deletes them. Reconnect and wait for the sync first if you can.`}
        confirmLabel="Sign out anyway"
        isPending={busy}
        onConfirm={go}
      />
    </>
  );
}
