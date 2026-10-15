import type { LessonKind } from "@shared/domain";

export const LESSON_KIND_ORDER: LessonKind[] = [
  "private",
  "semi_private",
  "group",
  "clinic",
  "event",
];

/** Short labels for pickers and the schedule legend. */
export const KIND_SHORT: Record<LessonKind, string> = {
  private: "Private",
  semi_private: "Semi-private",
  group: "Group",
  clinic: "Clinic",
  event: "Event",
};

/** Duration-true schedule blocks are coloured by kind (ink text on every fill). */
export const KIND_BLOCK: Record<LessonKind, string> = {
  private: "bg-card ring-1 ring-inset ring-line-strong",
  semi_private: "bg-mint",
  group: "bg-violet",
  clinic: "bg-sky",
  event: "bg-amber",
};

export const KIND_SWATCH: Record<LessonKind, string> = {
  private: "bg-card ring-1 ring-inset ring-ink/30",
  semi_private: "bg-mint",
  group: "bg-violet",
  clinic: "bg-sky",
  event: "bg-amber",
};

/** Kinds that book named players directly (groups book members, events book registrations). */
export const PLAYER_KINDS: LessonKind[] = ["private", "semi_private", "clinic"];
