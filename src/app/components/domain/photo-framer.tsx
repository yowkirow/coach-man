import {
  dragFraming,
  FRAMING_ZOOM_MAX,
  framingSlack,
  framingStyle,
  type PhotoFraming,
  type Size,
  sameFraming,
  zoomFraming,
} from "@shared/framing";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button, IconButton } from "../ui/button";
import { InlineError } from "../ui/feedback";
import { Sheet } from "../ui/overlay";

/** Another frame the same photo shows in, previewed small beside the main one. */
export interface FramePreview {
  label: string;
  /** Width over height. */
  aspect: number;
  /** A circle (a face in an avatar stack). */
  round?: boolean;
}

const ZOOM_STEP = 0.1;

/** A frame of the given shape with the photo placed by `framing` (an `overflow: hidden` box). */
function Framed({
  src,
  framing,
  aspect,
  round = false,
  className = "",
}: {
  src: string;
  framing: PhotoFraming;
  aspect: number;
  round?: boolean;
  className?: string;
}) {
  return (
    <span
      style={{ aspectRatio: aspect }}
      className={`block overflow-hidden bg-panel ${round ? "rounded-full" : "rounded-[12px]"} ${className}`}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        className="block size-full object-cover"
        style={framingStyle(framing)}
      />
    </span>
  );
}

/**
 * A labeled range, label above (with what it reads, at the right), the slider below between
 * optional `before` and `after` controls.
 */
function RangeField({
  label,
  value,
  min,
  max,
  step,
  valueText,
  readout,
  isDisabled = false,
  onChange,
  before,
  after,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  valueText: string;
  /** Shown beside the label (the zoom, "1.4×"). */
  readout?: string;
  isDisabled?: boolean;
  onChange: (value: number) => void;
  before?: ReactNode;
  after?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={id}
          className={`text-[0.8125rem] font-medium ${isDisabled ? "text-ink-3" : "text-ink-2"}`}
        >
          {label}
        </label>
        {readout ? (
          <output htmlFor={id} className="num text-[0.8125rem] font-medium text-ink">
            {readout}
          </output>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {before}
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={isDisabled}
          aria-valuetext={valueText}
          onChange={(e) => onChange(Number(e.currentTarget.value))}
          className="h-9 w-full min-w-0 flex-1 cursor-pointer accent-ink disabled:cursor-not-allowed disabled:opacity-40"
        />
        {after}
      </div>
    </div>
  );
}

/**
 * Adjust a photo: drag it to line it up in its frame and zoom in on what matters (pinch, Ctrl/⌘
 * with the wheel, or the sliders, which also work from the keyboard and read their values out).
 * Nothing is cropped: the framing travels with the photo to every frame that shows it, and
 * `previews` show those other shapes as you go. Saving the default stores no framing.
 */
export function PhotoFramer({
  isOpen,
  onClose,
  src,
  aspect,
  framing,
  fallback,
  title = "Adjust photo",
  description,
  previews = [],
  saveLabel = "Save",
  onSave,
  isSaving = false,
  error = null,
}: {
  isOpen: boolean;
  onClose: () => void;
  src: string | null;
  /** The main frame's shape, width over height (4 / 5 for a team page portrait). */
  aspect: number;
  /** The framing saved now (or the default when there's none). */
  framing: PhotoFraming;
  /** What Reset goes back to, and what saving it unchanged stores as "none". */
  fallback: PhotoFraming;
  title?: string;
  description?: string;
  previews?: FramePreview[];
  /** "Done" when the framing is kept with a form that saves later. */
  saveLabel?: string;
  onSave: (framing: PhotoFraming | null) => void;
  isSaving?: boolean;
  error?: string | null;
}) {
  const [f, setF] = useState(framing);
  const [image, setImage] = useState<Size | null>(null);
  const [frameSize, setFrameSize] = useState<Size>({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const imageRef = useRef<Size | null>(null);
  imageRef.current = image;

  // Each time it opens: start from what's saved.
  const seed = `${isOpen}|${src}|${framing.x}|${framing.y}|${framing.zoom}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed on open, a new photo, or a new saved framing.
  useEffect(() => {
    if (isOpen) setF(framing);
  }, [seed]);

  // The frame's size on screen (it scales with the sheet), for how far a drag moves the photo.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setFrameSize({ width: r.width, height: r.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  });

  // Dragging and pinching on the photo, and Ctrl/⌘ with the wheel (a trackpad pinch sends that).
  // The sliders below do all of it from the keyboard, so the frame itself is pointer-only.
  useEffect(() => {
    const el = frame.current;
    if (!el || !isOpen) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: number | null = null;
    const size = (): Size => {
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      pinch = null;
      setDragging(true);
    };
    const move = (e: PointerEvent) => {
      const last = pointers.get(e.pointerId);
      if (!last) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...pointers.values()];
      if (a && b) {
        // Two fingers: the change in their distance zooms.
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) {
          const ratio = distance / pinch;
          setF((prev) => zoomFraming(prev, prev.zoom * ratio));
        }
        pinch = distance;
        return;
      }
      const natural = imageRef.current;
      if (!natural) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      setF((prev) => dragFraming(prev, dx, dy, size(), natural));
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinch = null;
      if (!pointers.size) setDragging(false);
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setF((prev) => zoomFraming(prev, prev.zoom * Math.exp(-e.deltaY * 0.002)));
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
    };
  }, [isOpen]);

  // Up and down (or across) only moves the photo when it's bigger than the frame that way.
  const slack = image ? framingSlack(frameSize, image, f.zoom) : { width: 0, height: 0 };
  const canPan = { x: slack.width >= 1, y: slack.height >= 1 };
  const changed = !sameFraming(f, framing);
  // Unchanged (a new photo that already sits well, say), it just closes: nothing to send.
  const save = () => (changed ? onSave(sameFraming(f, fallback) ? null : f) : onClose());
  const zoomBy = (by: number) => setF((prev) => zoomFraming(prev, prev.zoom + by));
  // The frame gets the height the sheet has left after its header, controls, previews, and footer,
  // so they stay in view; a phone keeps a bigger frame (--floor) and scrolls a little instead.
  const reserve = previews.length
    ? "[--reserve:33rem] sm:[--reserve:30rem]"
    : "[--reserve:27.5rem] sm:[--reserve:25rem]";

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={description}
      footer={
        <>
          <Button
            variant="ghost"
            icon={<RotateCcw aria-hidden className="size-4" />}
            isDisabled={sameFraming(f, fallback)}
            onPress={() => setF(fallback)}
            className="mr-auto"
          >
            Reset
          </Button>
          <Button variant="light" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="dark" isPending={isSaving} onPress={save}>
            {saveLabel}
          </Button>
        </>
      }
    >
      {src ? (
        <div className="flex flex-col gap-4">
          <div
            ref={frame}
            aria-hidden
            style={{
              aspectRatio: aspect,
              width: `min(100%, calc(max(var(--floor), 92dvh - var(--reserve)) * ${aspect}))`,
            }}
            className={`relative mx-auto touch-none overflow-hidden rounded-[22px] bg-panel select-none [--floor:17rem] sm:[--floor:14rem] ${reserve} ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
          >
            <img
              src={src}
              alt=""
              draggable={false}
              onLoad={(e) =>
                setImage({
                  width: e.currentTarget.naturalWidth,
                  height: e.currentTarget.naturalHeight,
                })
              }
              className="pointer-events-none block size-full object-cover"
              style={framingStyle(f)}
            />
            {/* Thirds, while dragging: a guide for where faces and lines sit. */}
            <span
              className={`pointer-events-none absolute inset-0 transition-opacity duration-150 ${dragging ? "opacity-100" : "opacity-0"}`}
            >
              <span className="absolute inset-y-0 left-1/3 w-px bg-white/70" />
              <span className="absolute inset-y-0 left-2/3 w-px bg-white/70" />
              <span className="absolute inset-x-0 top-1/3 h-px bg-white/70" />
              <span className="absolute inset-x-0 top-2/3 h-px bg-white/70" />
            </span>
          </div>
          <p className="-mt-1.5 text-center text-[0.8125rem] text-ink-2">
            Drag the photo to line it up, or pinch to zoom.
          </p>

          <div className="flex flex-col gap-3">
            <RangeField
              label="Zoom"
              value={f.zoom}
              min={1}
              max={FRAMING_ZOOM_MAX}
              step={0.05}
              valueText={`${f.zoom.toFixed(1)} times`}
              readout={`${f.zoom.toFixed(1)}×`}
              onChange={(zoom) => setF((prev) => zoomFraming(prev, zoom))}
              before={
                <IconButton
                  label="Zoom out"
                  size="sm"
                  variant="soft"
                  isDisabled={f.zoom <= 1}
                  onPress={() => zoomBy(-ZOOM_STEP)}
                >
                  <Minus aria-hidden className="size-4" />
                </IconButton>
              }
              after={
                <IconButton
                  label="Zoom in"
                  size="sm"
                  variant="soft"
                  isDisabled={f.zoom >= FRAMING_ZOOM_MAX}
                  onPress={() => zoomBy(ZOOM_STEP)}
                >
                  <Plus aria-hidden className="size-4" />
                </IconButton>
              }
            />
            <div className="grid grid-cols-2 gap-x-5">
              <RangeField
                label="Left to right"
                value={f.x}
                min={0}
                max={100}
                step={1}
                valueText={`${Math.round(f.x)}% across`}
                isDisabled={!canPan.x}
                onChange={(x) => setF((prev) => zoomFraming({ ...prev, x }, prev.zoom))}
              />
              <RangeField
                label="Top to bottom"
                value={f.y}
                min={0}
                max={100}
                step={1}
                valueText={`${Math.round(f.y)}% down`}
                isDisabled={!canPan.y}
                onChange={(y) => setF((prev) => zoomFraming({ ...prev, y }, prev.zoom))}
              />
            </div>
          </div>

          {previews.length ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-3">
              {previews.map((p) => (
                <figure key={p.label} className="m-0 flex items-center gap-3">
                  <Framed
                    src={src}
                    framing={f}
                    aspect={p.aspect}
                    round={p.round}
                    className={p.round ? "h-11" : "h-14"}
                  />
                  <figcaption className="max-w-[18ch] text-[0.75rem] leading-snug text-ink-2">
                    {p.label}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}
          {error ? <InlineError>{error}</InlineError> : null}
        </div>
      ) : null}
    </Sheet>
  );
}
