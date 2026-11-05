import { Banknote, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Sheet } from "../../components/ui/overlay";

const SIZES = {
  sm: "h-18 w-14",
  /** Smaller on phones, where the text beside it needs the room. */
  md: "h-18 w-14 sm:h-24 sm:w-18",
  lg: "h-44 w-33",
} as const;

/**
 * A payment proof's screenshot as a thumbnail that opens it large (fit to the screen, then actual
 * size to read a small reference number, or the full file in a new tab). Cash at the court has no
 * screenshot: a cash tile stands in.
 */
export function ProofThumb({
  src,
  label,
  description,
  size = "md",
}: {
  /** The image URL (staff: /api/v1/files, family: /api/portal/files); null for cash. */
  src: string | null;
  /** What it is, for the button and the viewer: "Mia Santos's payment screenshot". */
  label: string;
  description?: string;
  size?: keyof typeof SIZES;
}) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  const box = `${SIZES[size]} relative shrink-0 overflow-hidden rounded-[16px]`;
  if (!src) {
    return (
      <span
        className={`${box} flex flex-col items-center justify-center gap-1 bg-mint text-ink`}
        title="Cash at the court: no screenshot"
      >
        <Banknote aria-hidden className="size-5" />
        <span className="text-[0.75rem] font-medium">Cash</span>
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`View ${label}`}
        className={`${box} group cursor-pointer bg-panel ring-1 ring-line outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink`}
      >
        {broken ? (
          <span className="flex size-full items-center justify-center px-1 text-center text-[0.75rem] text-ink-2">
            No preview
          </span>
        ) : (
          <img
            src={src}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
            className="size-full object-cover object-top transition-transform duration-200 ease-out group-hover:scale-[1.04]"
          />
        )}
        <span
          aria-hidden
          className="absolute right-1 bottom-1 flex size-6 items-center justify-center rounded-full bg-ink/75 text-white"
        >
          <Maximize2 className="size-3.5" />
        </span>
      </button>
      <ProofViewer
        isOpen={open}
        onOpenChange={setOpen}
        src={src}
        label={label}
        description={description}
      />
    </>
  );
}

/** The screenshot large: fit to the screen, or at actual size to read the fine print. */
export function ProofViewer({
  isOpen,
  onOpenChange,
  src,
  label,
  description,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  label: string;
  description?: string;
}) {
  const [actual, setActual] = useState(false);
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setActual(false);
      }}
      size="lg"
      title={label}
      description={description}
      footer={
        <>
          <a
            href={src}
            target="_blank"
            rel="noopener"
            className="inline-flex h-11 items-center gap-2 rounded-full px-4 text-[0.9375rem] font-medium text-ink underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            Open full size
          </a>
          <Button
            variant="light"
            icon={
              actual ? (
                <ZoomOut aria-hidden className="size-4.5" />
              ) : (
                <ZoomIn aria-hidden className="size-4.5" />
              )
            }
            onPress={() => setActual((a) => !a)}
          >
            {actual ? "Fit to screen" : "Actual size"}
          </Button>
        </>
      }
    >
      <div
        className={`rounded-[22px] bg-panel p-2 ${actual ? "max-h-[64dvh] overflow-auto" : "flex justify-center"}`}
      >
        <img
          src={src}
          alt={label}
          className={
            actual
              ? "block h-auto max-w-none rounded-[14px]"
              : "block max-h-[64dvh] w-auto max-w-full rounded-[14px] object-contain"
          }
        />
      </div>
    </Sheet>
  );
}
