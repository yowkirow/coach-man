import type { ConsentAppliesTo, ConsentKind } from "./domain";

/**
 * Starter consent documents in plain language, filled in with the academy's name. They are
 * starting points for the owner to review and adapt, not legal advice, and are added as drafts
 * (inactive) until someone turns them on.
 */
export const CONSENT_TEMPLATE_KINDS = ["waiver", "privacy", "parental", "media"] as const;
export type ConsentTemplateKind = (typeof CONSENT_TEMPLATE_KINDS)[number];

export interface ConsentTemplate {
  kind: ConsentKind;
  title: string;
  body: string;
  required: boolean;
  appliesTo: ConsentAppliesTo;
}

/** What each template is for, shown before adding it. */
export const CONSENT_TEMPLATE_SUMMARIES: Record<ConsentTemplateKind, string> = {
  waiver: "The risks of training, fitness to play, following coaches' instructions, first aid.",
  privacy:
    "What personal information the academy keeps and why, under the Data Privacy Act (RA 10173).",
  parental: "A parent or guardian's permission for a player under 18 to train.",
  media: "Permission to take and share photos and videos from training. Optional by default.",
};

export function consentTemplate(kind: ConsentTemplateKind, academyName: string): ConsentTemplate {
  const academy = academyName.trim() || "The academy";
  switch (kind) {
    case "waiver":
      return {
        kind,
        title: "Activity waiver and release",
        required: true,
        appliesTo: "all",
        body: [
          `Training and play at ${academy} are physical activities. They involve running, quick changes of direction, and balls and paddles in motion, and they carry a risk of injury.`,
          "I confirm that the player is fit to take part, and that the coaches have been told in writing about any medical condition, injury, or limitation that could affect their training.",
          "I agree that the player will follow the coaches' instructions and the rules of the venue, and will wear suitable shoes and clothing.",
          `To the extent the law allows, I release ${academy}, its coaches, and its staff from claims for injury, loss, or damage arising from the ordinary risks of training and play, except where caused by their negligence or wilful misconduct.`,
          "In an emergency, I allow the coaches to give first aid and to call for medical help, and I will cover the cost of any treatment.",
        ].join("\n\n"),
      };
    case "privacy":
      return {
        kind,
        title: "Data privacy consent",
        required: true,
        appliesTo: "all",
        body: [
          `${academy} collects the personal information needed to run the player's training: their name, birth date, contact details, emergency contacts, health notes you choose to share, attendance, progress records, coaches' comments, payments, and photos uploaded by you or the academy.`,
          `${academy} uses this information to schedule and run sessions, keep track of progress and packages, contact you about training and payments, and keep players safe. The academy's coaches and staff can see it. It is stored with CoachMan, the software the academy uses, and is shared with no one else unless the law requires it.`,
          `${academy} keeps the information while the player trains with the academy, and afterwards only as long as the law requires.`,
          `You may ask ${academy} to show you, correct, or delete this information, and you may withdraw this consent at any time by telling the academy. Without it, the academy may not be able to continue the player's training.`,
          `By signing, I consent to ${academy} collecting and processing this personal information for these purposes, in line with the Data Privacy Act of 2012 (Republic Act No. 10173).`,
        ].join("\n\n"),
      };
    case "parental":
      return {
        kind,
        title: "Parental consent",
        required: true,
        appliesTo: "minors",
        body: [
          `I am the parent or legal guardian of the player named here, and I give permission for them to train at ${academy}.`,
          `I have read the academy's activity waiver and data privacy consent, and I agree to them on the player's behalf.`,
          "I will tell the academy who may pick the player up after sessions, and I will keep the player's health and emergency details up to date.",
          "I understand that coaches supervise players during their sessions, and that the player is in my care before and after them.",
        ].join("\n\n"),
      };
    case "media":
      return {
        kind,
        title: "Photo and video consent",
        required: false,
        appliesTo: "all",
        body: [
          `${academy} sometimes takes photos and videos during training and events, for coaching feedback and to share the academy's work.`,
          `I allow ${academy} to take photos and videos of the player during sessions and events, and to use them for coaching and on the academy's own pages and social media accounts.`,
          "The academy will not publish the player's full name with their image without asking first, and will take an image down when asked.",
          "I can withdraw this consent at any time by telling the academy.",
        ].join("\n\n"),
      };
  }
}
