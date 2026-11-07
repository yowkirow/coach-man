import type { FamilyRelation } from "../../shared/domain";

/**
 * What a family member may see: their active client_access rows (revokedAt null), resolved once
 * per request by `requirePortal`. Every /api/portal query is scoped to these students and their
 * academies; anything else answers 404, so existence never leaks.
 */
export interface PortalLink {
  accessId: string;
  clientId: string;
  workspaceId: string;
  relation: FamilyRelation;
}

export interface PortalScope {
  userId: string;
  links: PortalLink[];
}

/** The caller's link to a student, or null when they have none (then the answer is 404). */
export function linkFor(scope: PortalScope, clientId: string): PortalLink | null {
  return scope.links.find((l) => l.clientId === clientId) ?? null;
}

/** The academies the caller has students in, in link order, without repeats. */
export function workspacesOf(scope: PortalScope): string[] {
  return [...new Set(scope.links.map((l) => l.workspaceId))];
}

export function inWorkspace(scope: PortalScope, workspaceId: string): boolean {
  return scope.links.some((l) => l.workspaceId === workspaceId);
}

/** Whether a row belongs to one of the caller's students in that student's own academy. */
export function ownsRow(scope: PortalScope, row: { workspaceId: string; clientId: string | null }) {
  return scope.links.some((l) => l.workspaceId === row.workspaceId && l.clientId === row.clientId);
}

const SEGMENT = "[A-Za-z0-9-]+";
const FILE = "[A-Za-z0-9_-][A-Za-z0-9._-]*";
/** Student photos are `<uuid>.<ext>` directly in the student's folder. */
const PHOTO = "[A-Za-z0-9-]+\\.(?:jpg|jpeg|png|webp)";
const STUDENT_PHOTO_RE = new RegExp(`^ws/(${SEGMENT})/clients/(${SEGMENT})/(${PHOTO})$`);
const STUDENT_FOLDER_RE = new RegExp(
  `^ws/(${SEGMENT})/clients/(${SEGMENT})/(${SEGMENT})/(${FILE})$`,
);
const PUBLIC_RE = new RegExp(`^ws/(${SEGMENT})/public/(?:(?:coaches|photos)/)?(${FILE})$`);

/** An R2 key a family might ask for, by what it is (spec §8). */
export type PortalFileKey =
  | { kind: "student-photo"; workspaceId: string; clientId: string }
  /** `payments/` (proofs, WS4c) and `pickups/` (pickup photos, WS5a) under a student's folder. */
  | { kind: "student-folder"; workspaceId: string; clientId: string; folder: string }
  | { kind: "public"; workspaceId: string };

/** Parses a key; null for anything malformed or that tries to climb out (`..`). */
export function parsePortalFileKey(key: string): PortalFileKey | null {
  if (!key || key.includes("..") || key.includes("//") || key.includes("\\")) return null;
  const photo = STUDENT_PHOTO_RE.exec(key);
  if (photo?.[1] && photo[2]) {
    return { kind: "student-photo", workspaceId: photo[1], clientId: photo[2] };
  }
  const folder = STUDENT_FOLDER_RE.exec(key);
  if (folder?.[1] && folder[2] && folder[3]) {
    return {
      kind: "student-folder",
      workspaceId: folder[1],
      clientId: folder[2],
      folder: folder[3],
    };
  }
  const pub = PUBLIC_RE.exec(key);
  if (pub?.[1]) return { kind: "public", workspaceId: pub[1] };
  return null;
}

/**
 * The row an exact private key belongs to: the payment_submission with that `proof_key` (a proof,
 * the default) or the authorized_pickup with that `photo_key` (a pickup person's photo).
 */
export interface ProofOwner {
  workspaceId: string;
  clientId: string;
  /** Which table the row came from; a proof unless said otherwise. */
  kind?: "proof" | "pickup";
}
export type FileOwner = ProofOwner;

/** The table that owns the files of each private student subfolder. */
const FOLDER_OWNER: Record<string, NonNullable<ProofOwner["kind"]>> = {
  payments: "proof",
  pickups: "pickup",
};

/**
 * Whether the caller may read a file: their own students' photos, the public images (logos,
 * payment QR codes, coach photos, website photos) of the academies they belong to, payment proofs
 * of their students, and photos of their students' authorized pickup people. A file in a student's
 * subfolder is checked against the row its key belongs to (`owner`: the payment_submission or
 * authorized_pickup found by that exact key), never by its folder alone: a key with no row, a row
 * from the other table, a row of someone else's student, or one from another academy is refused.
 * Any other subfolder is refused.
 */
export function canReadPortalFile(
  scope: PortalScope,
  key: string,
  owner?: FileOwner | null,
): boolean {
  const parsed = parsePortalFileKey(key);
  if (!parsed) return false;
  switch (parsed.kind) {
    case "student-photo":
      return ownsRow(scope, parsed);
    case "public":
      return inWorkspace(scope, parsed.workspaceId);
    case "student-folder": {
      const wanted = FOLDER_OWNER[parsed.folder];
      if (!wanted || !owner || (owner.kind ?? "proof") !== wanted) return false;
      return owner.workspaceId === parsed.workspaceId && ownsRow(scope, owner);
    }
  }
}

/** A key in a student's `payments/` folder: its proof must be looked up before reading it. */
export function isProofKey(key: string): boolean {
  const parsed = parsePortalFileKey(key);
  return parsed?.kind === "student-folder" && parsed.folder === "payments";
}

/** A key in a student's `pickups/` folder: its pickup person must be looked up before reading it. */
export function isPickupKey(key: string): boolean {
  const parsed = parsePortalFileKey(key);
  return parsed?.kind === "student-folder" && parsed.folder === "pickups";
}
