import { ImagePlus, Trash2, UserRound } from "lucide-react";
import { useId, useState } from "react";
import { FileTrigger } from "react-aria-components";
import { Button } from "../../components/ui/button";
import { InlineError } from "../../components/ui/feedback";
import { prepareImage } from "../../lib/images";

const PORTRAIT_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** A chosen photo, cropped 4:5 and shrunk for the team page (1280 × 1600 at most). */
export function preparePortrait(file: File): Promise<Blob> {
  return prepareImage(file, { mode: "portrait", maxEdge: 1600, type: "image/jpeg" });
}

/** A team page photo at 4:5, or the empty slot waiting for one. */
export function PortraitPreview({
  src,
  className = "w-20",
}: {
  src: string | null;
  className?: string;
}) {
  // A photo that can't load (offline, say) shows the empty slot instead of a broken image.
  const [failed, setFailed] = useState<string | null>(null);
  if (src && failed !== src) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setFailed(src)}
        className={`aspect-[4/5] shrink-0 rounded-2xl bg-panel object-cover ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`flex aspect-[4/5] shrink-0 items-center justify-center rounded-2xl border border-dashed border-line-strong bg-panel text-ink-3 ${className}`}
    >
      <UserRound className="size-6" />
    </span>
  );
}

/**
 * The team page photo: its 4:5 preview, Add, Change, and Remove, and what works best. It only
 * shows and asks; the caller uploads at once (a coach profile) or when saving (a display-only
 * person).
 */
export function PortraitField({
  src,
  onChoose,
  onRemove,
  pending = null,
  isDisabled = false,
  error,
}: {
  /** The photo now (a file URL, or a chosen photo not saved yet). */
  src: string | null;
  onChoose: (file: File) => void;
  onRemove: () => void;
  pending?: "choose" | "remove" | null;
  isDisabled?: boolean;
  error?: string | null;
}) {
  const labelId = useId();
  return (
    <fieldset aria-labelledby={labelId} className="flex min-w-0 flex-wrap items-start gap-4">
      <PortraitPreview src={src} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p id={labelId} className="text-[0.8125rem] font-medium text-ink-2">
          Team page photo
        </p>
        <div className="flex flex-wrap gap-2">
          <FileTrigger
            acceptedFileTypes={PORTRAIT_TYPES}
            onSelect={(files) => {
              const file = files?.[0];
              if (file) onChoose(file);
            }}
          >
            <Button
              variant="light"
              size="sm"
              aria-label={src ? "Change team page photo" : undefined}
              isDisabled={isDisabled || pending !== null}
              isPending={pending === "choose"}
              icon={<ImagePlus aria-hidden className="size-4" />}
            >
              {src ? "Change" : "Add team page photo"}
            </Button>
          </FileTrigger>
          {src ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Remove team page photo"
              isDisabled={isDisabled || pending !== null}
              isPending={pending === "remove"}
              icon={<Trash2 aria-hidden className="size-4" />}
              onPress={onRemove}
            >
              Remove
            </Button>
          ) : null}
        </div>
        <p className="text-[0.8125rem] text-ink-2">
          A photo from the waist up works best. The team page shows it in this 4:5 shape.
        </p>
      </div>
      {error ? (
        <div className="basis-full">
          <InlineError>{error}</InlineError>
        </div>
      ) : null}
    </fieldset>
  );
}
