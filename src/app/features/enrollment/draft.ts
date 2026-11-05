import { uuidv7 } from "@shared/ids";

// The enrollment wizard's answers, kept on this device while someone works through it: going
// back, reloading, or signing in with Google halfway never loses what they typed. Only the person
// who started it gets it back (it carries their user id), and sending the request clears it.

export type StepId = "who" | "level" | "contact" | "when" | "consents" | "review";

export interface PickupDraft {
  key: string;
  name: string;
  relationship: string;
  phone: string;
}

export interface WizardDraft {
  v: 1;
  userId: string | null;
  /** The request's id, made once: a resent request is recognized, not made twice. */
  requestId: string;
  step: StepId;
  who: {
    kind: "self" | "child" | "new_child" | null;
    clientId: string | null;
    firstName: string;
    lastName: string;
    birthDate: string;
  };
  answers: {
    phone: string;
    email: string;
    selfRating: number | null;
    selfRatingUnsure: boolean;
    shirtSize: string;
    medicalNotes: string;
    emergencyName: string;
    emergencyPhone: string;
    notes: string;
    pickups: PickupDraft[];
  };
  startMonth: string;
  lessonId: string;
  startDate: string;
  /** Consent documents ticked "I've read and agree" (id:version). */
  agreed: string[];
  signerName: string;
}

export function emptyDraft(userId: string | null): WizardDraft {
  return {
    v: 1,
    userId,
    requestId: uuidv7(),
    step: "who",
    who: { kind: null, clientId: null, firstName: "", lastName: "", birthDate: "" },
    answers: {
      phone: "",
      email: "",
      selfRating: null,
      selfRatingUnsure: false,
      shirtSize: "",
      medicalNotes: "",
      emergencyName: "",
      emergencyPhone: "",
      notes: "",
      pickups: [],
    },
    startMonth: "",
    lessonId: "",
    startDate: "",
    agreed: [],
    signerName: "",
  };
}

const KEY = (slug: string, packageId: string) => `coachman.enroll.v1:${slug}:${packageId}`;

/** The draft this person left for this tier, if any (anyone else's is dropped). */
export function loadDraft(slug: string, packageId: string, userId: string): WizardDraft | null {
  try {
    const raw = localStorage.getItem(KEY(slug, packageId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as WizardDraft;
    if (draft.v !== 1 || draft.userId !== userId) {
      localStorage.removeItem(KEY(slug, packageId));
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function saveDraft(slug: string, packageId: string, draft: WizardDraft) {
  try {
    localStorage.setItem(KEY(slug, packageId), JSON.stringify(draft));
  } catch {
    // Storage full or blocked: the wizard still works, it just won't survive a reload.
  }
}

export function clearDraft(slug: string, packageId: string) {
  try {
    localStorage.removeItem(KEY(slug, packageId));
  } catch {
    // Nothing to clear.
  }
}
