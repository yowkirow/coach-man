import type { Context } from "hono";
import { uuidv7 } from "../../shared/ids";
import type { AppBindings } from "../types";
import { badRequest } from "./errors";

const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Images only (JPEG, PNG, WebP), 1.5 MB at most. */
export const MAX_IMAGE_BYTES = 1_500_000;

/** Whether the bytes really are the image type claimed (its file signature). */
export function hasImageSignature(bytes: Uint8Array, type: string): boolean {
  const starts = (sig: readonly number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  switch (type) {
    case "image/jpeg":
      return starts([0xff, 0xd8, 0xff]);
    case "image/png":
      return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp":
      // "RIFF" <size> "WEBP"
      return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8);
    default:
      return false;
  }
}

/** The image type the bytes really are (by file signature), whatever the upload claimed. */
export function sniffImageType(
  bytes: Uint8Array,
): "image/jpeg" | "image/png" | "image/webp" | null {
  for (const type of ["image/jpeg", "image/png", "image/webp"] as const) {
    if (hasImageSignature(bytes, type)) return type;
  }
  return null;
}

/**
 * A file part of a multipart upload (payment proofs, pickup photos): JPEG, PNG, or WebP by its
 * bytes (the type the browser declared doesn't count), 1.5 MB at most, not empty. Errors name the
 * form field (`field`) so the app can show them beside it.
 */
export async function readImageFile(file: File, noun = "screenshot", field = "proof") {
  if (file.size === 0) throw badRequest(`The ${noun} is empty.`, { fields: { [field]: "Empty" } });
  if (file.size > MAX_IMAGE_BYTES) {
    throw badRequest(`That ${noun} is too large (1.5 MB max).`, {
      fields: { [field]: "Too large" },
    });
  }
  const body = await file.arrayBuffer();
  const type = sniffImageType(new Uint8Array(body, 0, Math.min(body.byteLength, 16)));
  if (!type) {
    throw badRequest(`That file isn't a JPEG, PNG, or WebP ${noun}.`, {
      fields: { [field]: "Not an image" },
    });
  }
  return { body, type, ext: TYPES[type] as string };
}

/** Payment proofs (spec §8): private, under the student's own folder. */
export const proofKeyFor = (workspaceId: string, clientId: string, ext: string) =>
  `ws/${workspaceId}/clients/${clientId}/payments/${uuidv7()}.${ext}`;

/** Authorized pickup people's photos (spec §8): private, under the student's own folder. */
export const pickupKeyFor = (workspaceId: string, clientId: string, ext: string) =>
  `ws/${workspaceId}/clients/${clientId}/pickups/${uuidv7()}.${ext}`;

/**
 * A form that may carry one image (a pickup person's photo): multipart/form-data with the fields
 * as JSON in `data` and the image in `fileField`, or JSON alone. The image is checked by its
 * bytes; a declared size well over the limit is refused before the body is parsed.
 */
export async function readFormWithImage(
  c: Context<AppBindings>,
  { fileField, noun }: { fileField: string; noun: string },
): Promise<{
  data: unknown;
  image: { body: ArrayBuffer; type: string; ext: string } | null;
}> {
  const type = (c.req.header("Content-Type") ?? "").toLowerCase();
  if (type.startsWith("multipart/form-data")) {
    const declared = Number(c.req.header("Content-Length") ?? Number.NaN);
    if (declared > MAX_IMAGE_BYTES + 200_000) {
      // Drain the body first: Miniflare's local proxy can fail a request answered unread.
      await c.req.raw.arrayBuffer().catch(() => undefined);
      throw badRequest(`That ${noun} is too large (1.5 MB max).`, {
        fields: { [fileField]: "Too large" },
      });
    }
    let form: FormData;
    try {
      form = await c.req.raw.formData();
    } catch {
      throw badRequest("Couldn't read the upload. Try again.");
    }
    const raw = form.get("data");
    let data: unknown;
    try {
      data = JSON.parse(typeof raw === "string" ? raw : "");
    } catch {
      throw badRequest("Some fields need attention.");
    }
    const file = form.get(fileField);
    const image =
      file instanceof File && file.size > 0 ? await readImageFile(file, noun, fileField) : null;
    return { data, image };
  }
  let data: unknown;
  try {
    data = await c.req.json();
  } catch {
    throw badRequest(`Send the details as JSON, or as a form with the ${noun}.`);
  }
  return { data, image: null };
}

/**
 * Reads an image request body (PUT with the image as the body) and checks its type, its file
 * signature, and its size. `noun` names it in errors ("photo", "logo", "QR code").
 */
export async function readImage(c: Context<AppBindings>, noun = "photo") {
  const type = (c.req.header("Content-Type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const ext = TYPES[type];
  const declared = Number(c.req.header("Content-Length") ?? Number.NaN);
  if (!ext || declared > MAX_IMAGE_BYTES) {
    // Drain the body first: Miniflare's local proxy can fail a request answered unread.
    await c.req.raw.arrayBuffer().catch(() => undefined);
    throw badRequest(
      ext ? `That ${noun} is too large (1.5 MB max).` : `Use a JPEG, PNG, or WebP ${noun}.`,
    );
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) throw badRequest(`The ${noun} is empty.`);
  if (body.byteLength > MAX_IMAGE_BYTES)
    throw badRequest(`That ${noun} is too large (1.5 MB max).`);
  if (!hasImageSignature(new Uint8Array(body, 0, Math.min(body.byteLength, 16)), type)) {
    throw badRequest(`That file isn't a JPEG, PNG, or WebP ${noun}.`);
  }
  return { body, type, ext };
}

/** Public R2 keys (spec §8): anything under ws/<id>/public/ may be shown to anyone. */
export const publicKey = {
  logo: (workspaceId: string, ext: string) => `ws/${workspaceId}/public/logo-${uuidv7()}.${ext}`,
  paymentQr: (workspaceId: string, ext: string) =>
    `ws/${workspaceId}/public/payment-qr-${uuidv7()}.${ext}`,
  coachPhoto: (workspaceId: string, userId: string, ext: string) =>
    `ws/${workspaceId}/public/coaches/${userId}-${uuidv7()}.${ext}`,
};

/** ws/<workspaceId>/public/<file> or ws/<workspaceId>/public/coaches/<file>. */
export const PUBLIC_KEY_RE = /^ws\/[A-Za-z0-9-]+\/public\/(coaches\/)?[A-Za-z0-9._-]+$/;
