import type { PublicCoachDto } from "@shared/api-types";
import { framingOr, framingStyle, PORTRAIT_FRAMING } from "@shared/framing";
import { type CSSProperties, useState } from "react";
import { tintFor } from "../../components/ui/display";
import { publicFileUrl } from "../../lib/api";
import { initials } from "../../lib/format";
import { teamPhotoKey } from "./team";

type Person = Pick<PublicCoachDto, "id" | "name" | "portraitKey" | "photoKey"> &
  Partial<Pick<PublicCoachDto, "portraitFraming">>;

function initialsOf(name: string) {
  const [first = "", ...rest] = name.trim().split(/\s+/);
  return initials({ firstName: first, lastName: rest.join(" ") });
}

/**
 * A team photo that falls back to initials when it can't load (offline, a removed file), with its
 * framing: the one the academy set for the portrait, else the default that keeps faces in.
 */
function usePhoto(person: Person) {
  const src = publicFileUrl(teamPhotoKey(person));
  const [failed, setFailed] = useState<string | null>(null);
  const framing = framingOr(person.portraitKey ? person.portraitFraming : null, PORTRAIT_FRAMING);
  return {
    src: src && failed !== src ? src : null,
    onError: () => setFailed(src),
    style: framingStyle(framing),
  };
}

const SIZES = {
  lg: { width: 640, height: 800, text: "text-[3.5rem]" },
  // A phone reel card that turns into a compact grid tile from `sm`.
  reel: { width: 512, height: 640, text: "text-[3rem] sm:text-[1.5rem]" },
  sm: { width: 256, height: 320, text: "text-[1.5rem]" },
} as const;

/**
 * Someone on the academy's team at 4:5: their half-body portrait, else their square photo, else
 * their initials on a soft wash. The name always sits beside it, so the image itself is silent.
 * `transition` names it for the team page's view transition (one person, one name per page);
 * `priority` is for the page's first portrait, which loads ahead of the rest.
 */
export function TeamPortrait({
  person,
  size,
  transition = false,
  priority = false,
  className = "",
}: {
  person: Person;
  size: keyof typeof SIZES;
  transition?: boolean;
  priority?: boolean;
  className?: string;
}) {
  const { src, onError, style: framed } = usePhoto(person);
  const dims = SIZES[size];
  const style: CSSProperties = transition
    ? ({ viewTransitionName: `person-${person.id}` } as CSSProperties)
    : {};
  if (src) {
    // The frame clips the photo, so a zoomed-in framing stays inside it.
    return (
      <span
        style={style}
        className={`block aspect-[4/5] w-full overflow-hidden bg-panel ${className}`}
      >
        <img
          src={src}
          alt=""
          width={dims.width}
          height={dims.height}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
          onError={onError}
          style={framed}
          className="block size-full object-cover"
        />
      </span>
    );
  }
  return (
    <div
      aria-hidden
      style={{ ...style, backgroundColor: tintFor(person.name) }}
      className={`flex aspect-[4/5] w-full items-center justify-center font-semibold text-ink ${dims.text} ${className}`}
    >
      {initialsOf(person.name)}
    </div>
  );
}

/** A 36px face for avatar stacks on the dark panel: the photo as the academy framed it, else initials. */
export function TeamFace({ person, className = "" }: { person: Person; className?: string }) {
  const { src, onError, style } = usePhoto(person);
  if (src) {
    return (
      <span className={`block size-9 shrink-0 overflow-hidden rounded-full bg-panel ${className}`}>
        <img
          src={src}
          alt=""
          width={36}
          height={36}
          loading="lazy"
          decoding="async"
          onError={onError}
          style={style}
          className="block size-full object-cover"
        />
      </span>
    );
  }
  return (
    <span
      style={{ backgroundColor: tintFor(person.name) }}
      className={`flex size-9 shrink-0 items-center justify-center rounded-full text-[0.75rem] font-semibold text-ink ${className}`}
    >
      {initialsOf(person.name)}
    </span>
  );
}
