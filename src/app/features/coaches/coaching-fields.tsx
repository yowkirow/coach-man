import { Trophy } from "lucide-react";
import type { ReactNode } from "react";
import { TextAreaField, TextField } from "../../components/ui/field";
import { LinesEditor } from "../../components/ui/lines-editor";
import { TagInput } from "../clients/client-form";
import { wholeNumber } from "../settings/validation";

export const MAX_HIGHLIGHTS = 12;

/** What a coach shows families, as typed: a staff coach profile and a display-only person alike. */
export interface CoachingDraft {
  title: string;
  bio: string;
  certifications: string[];
  highlights: string[];
  specialties: string[];
  languages: string[];
  duprRating: string;
  yearsCoaching: string;
}

export function coachingDraftOf(p: {
  title: string | null;
  bio: string | null;
  certifications: string[];
  highlights: string[];
  specialties: string[];
  languages: string[];
  duprRating: number | null;
  yearsCoaching: number | null;
}): CoachingDraft {
  return {
    title: p.title ?? "",
    bio: p.bio ?? "",
    certifications: p.certifications,
    highlights: p.highlights,
    specialties: p.specialties,
    languages: p.languages,
    duprRating: p.duprRating === null ? "" : String(p.duprRating),
    yearsCoaching: p.yearsCoaching === null ? "" : String(p.yearsCoaching),
  };
}

/** The draft as the API takes it (the schema then checks it); empty highlight lines are dropped. */
export function coachingInput(d: CoachingDraft) {
  const rating = d.duprRating.trim() ? Number(d.duprRating.trim().replace(",", ".")) : null;
  return {
    title: d.title,
    bio: d.bio,
    certifications: d.certifications,
    highlights: d.highlights.map((h) => h.trim()).filter(Boolean),
    specialties: d.specialties,
    languages: d.languages,
    duprRating: rating === null ? null : Number.isFinite(rating) ? rating : Number.NaN,
    yearsCoaching: wholeNumber(d.yearsCoaching),
  };
}

export const COACHING_FRIENDLY: Record<string, string> = {
  title: "Keep the title under 80 characters.",
  duprRating: "Use a DUPR rating from 1.0 to 8.0, or leave it empty.",
  yearsCoaching: "Use a whole number of years, or leave it empty.",
  highlights: `Keep each highlight under 120 characters, ${MAX_HIGHLIGHTS} at most.`,
};

/** Tournament results, titles, and milestones, one per line, in the order the page shows them. */
export function HighlightsEditor({
  items,
  onChange,
  error,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  error?: string;
}) {
  return (
    <LinesEditor
      label="Highlights"
      description="Tournament results, titles, and milestones, best first."
      items={items}
      onChange={onChange}
      max={MAX_HIGHLIGHTS}
      icon={<Trophy aria-hidden className="size-4 shrink-0" />}
      listLabel="Highlights"
      itemLabel={(i) => `Highlight ${i + 1}`}
      addLabel="Add a highlight"
      placeholder="e.g. Gold, Men's Doubles 4.0, Manila Open 2025"
      error={error}
    />
  );
}

/**
 * Title, about, rating, years coaching, certifications, highlights, specialties, and languages, in
 * a two-column grid that starts with `name` (the form's own name field). `voice` words the hints
 * for the person themself ("you") or someone the academy adds ("they").
 */
export function CoachingFields({
  name,
  draft,
  set,
  err,
  voice,
}: {
  name: ReactNode;
  draft: CoachingDraft;
  /** Changes some fields (and clears their errors). */
  set: (patch: Partial<CoachingDraft>) => void;
  err: (key: string) => string | undefined;
  voice: "you" | "they";
}) {
  const you = voice === "you";
  return (
    <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
      {name}
      <TextField
        label="Title"
        value={draft.title}
        onChange={(v) => set({ title: v })}
        placeholder="e.g. Head coach"
        error={err("title")}
      />
      <TextAreaField
        label="About"
        value={draft.bio}
        onChange={(v) => set({ bio: v })}
        rows={4}
        placeholder={
          you
            ? "How you coach, who you work with, what you play"
            : "How they coach, who they work with, what they play"
        }
        error={err("bio")}
        className="sm:col-span-2"
      />
      <TextField
        label="DUPR rating"
        inputMode="decimal"
        value={draft.duprRating}
        onChange={(v) => set({ duprRating: v })}
        placeholder="e.g. 4.25"
        error={err("duprRating")}
      />
      <TextField
        label="Years coaching"
        type="number"
        inputMode="numeric"
        min="0"
        max="80"
        value={draft.yearsCoaching}
        onChange={(v) => set({ yearsCoaching: v })}
        error={err("yearsCoaching")}
      />
      <div className="sm:col-span-2">
        <TagInput
          label="Certifications"
          value={draft.certifications}
          onChange={(v) => set({ certifications: v })}
          placeholder="Type one, then Enter"
          description="Coaching licenses and courses."
          maxLength={80}
          error={err("certifications")}
        />
      </div>
      <div className="sm:col-span-2">
        <HighlightsEditor
          items={draft.highlights}
          onChange={(v) => set({ highlights: v })}
          error={err("highlights")}
        />
      </div>
      <TagInput
        label="Specialties"
        value={draft.specialties}
        onChange={(v) => set({ specialties: v })}
        placeholder="Type one, then Enter"
        description="For example juniors, beginners, or tournament play."
        maxLength={60}
        error={err("specialties")}
      />
      <TagInput
        label="Languages"
        value={draft.languages}
        onChange={(v) => set({ languages: v })}
        placeholder="Type one, then Enter"
        description={you ? "The languages you coach in." : "The languages they coach in."}
        max={10}
        maxLength={40}
        error={err("languages")}
      />
    </div>
  );
}
