import { Copy, MessageSquareText, Share2 } from "lucide-react";
import type { ReactNode } from "react";
import { Input, Label, TextField as RACTextField } from "react-aria-components";
import { notify } from "../../lib/notify";
import { Button } from "../ui/button";
import { fieldClass } from "../ui/field";

export async function copyText(
  text: string,
  what: string,
  body = "Paste it into Messenger, Viber, or a text.",
) {
  try {
    await navigator.clipboard.writeText(text);
    notify({ tone: "success", title: `${what} copied`, body });
  } catch {
    notify({
      tone: "danger",
      title: "Couldn't copy",
      body: "Select the text and copy it instead.",
    });
  }
}

/**
 * A freshly made invite link, shown once: the link to copy, the phone's share sheet where there
 * is one, and a message ready to paste into Messenger, Viber, or a text (the sheet says whether
 * CoachMan emailed it too).
 */
export function InviteLinkPanel({
  link,
  message,
  shareTitle,
  footnote,
}: {
  link: string;
  message: string;
  shareTitle: string;
  footnote: ReactNode;
}) {
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <div className="flex flex-col gap-5">
      <RACTextField value={link} isReadOnly className="flex flex-col gap-1.5">
        <Label className="text-[0.8125rem] font-medium text-ink-2">Invite link</Label>
        <Input className={`${fieldClass} text-[0.875rem]`} onFocus={(e) => e.target.select()} />
      </RACTextField>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="dark"
          icon={<Copy aria-hidden className="size-4.5" />}
          onPress={() => void copyText(link, "Link")}
        >
          Copy link
        </Button>
        {canShare ? (
          <Button
            variant="light"
            icon={<Share2 aria-hidden className="size-4.5" />}
            onPress={() =>
              void navigator.share({ title: shareTitle, text: message }).catch(() => undefined)
            }
          >
            Share
          </Button>
        ) : null}
      </div>
      <section aria-label="Message to send" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[0.9375rem] font-medium">Message to send</h3>
          <Button
            variant="light"
            size="sm"
            icon={<MessageSquareText aria-hidden className="size-4" />}
            onPress={() => void copyText(message, "Message")}
          >
            Copy message
          </Button>
        </div>
        <p className="rounded-[22px] bg-panel px-4 py-3 text-[0.9375rem] break-words whitespace-pre-line">
          {message}
        </p>
      </section>
      <p className="text-[0.8125rem] text-ink-2">{footnote}</p>
    </div>
  );
}
