import { ApiRequestError } from "./api";
import { portraitCrop, portraitSize } from "./image-crop";

export { portraitCrop } from "./image-crop";

/**
 * Shrinks an image in the browser before upload (the API takes up to 1.5 MB). "cover" crops to a
 * square, for faces; "contain" keeps the whole picture, for logos, QR codes, and website photos;
 * "portrait" crops 4:5 for half-body team page photos (see `portraitCrop`), and `maxEdge` is then
 * its height. A JPEG is saved at `quality` (0.86 unless asked otherwise).
 */
export async function prepareImage(
  file: File,
  {
    mode,
    maxEdge,
    type,
    quality = 0.86,
  }: {
    mode: "cover" | "contain" | "portrait";
    maxEdge: number;
    type: "image/jpeg" | "image/png";
    quality?: number;
  },
): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("That file isn't an image we can read. Use a JPEG, PNG, or WebP.");
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't prepare images.");
  if (mode === "portrait") {
    const crop = portraitCrop(bitmap.width, bitmap.height);
    const out = portraitSize(crop, maxEdge);
    canvas.width = out.width;
    canvas.height = out.height;
    // A cut-out (a transparent PNG) would turn black as a JPEG: give it a white backdrop.
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, out.width, out.height);
  } else if (mode === "cover") {
    const side = Math.min(bitmap.width, bitmap.height);
    const out = Math.min(maxEdge, side);
    canvas.width = out;
    canvas.height = out;
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      out,
      out,
    );
  } else {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    if (type === "image/jpeg") {
      // A JPEG has no transparency: a cut-out's clear parts would turn black.
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  }
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, type === "image/jpeg" ? quality : undefined),
  );
  if (!blob) throw new Error("This browser can't prepare images.");
  return blob;
}

/** What a website photo should weigh at most: under the API's 1.5 MB, with room to spare. */
const WEBSITE_PHOTO_BYTES = 1_400_000;

/** Ever lighter, then smaller, versions of a website photo, tried in turn until one fits. */
const WEBSITE_PHOTO_STEPS = [
  { maxEdge: 1800, quality: 0.86 },
  { maxEdge: 1800, quality: 0.72 },
  { maxEdge: 1400, quality: 0.72 },
  { maxEdge: 1100, quality: 0.65 },
] as const;

/**
 * A photo for the academy's website (its cover, or one for its gallery) ready to upload: the whole
 * picture, aspect ratio kept, as a JPEG at most 1800 px on its long side. A very detailed photo
 * that's still too heavy is saved lighter, then smaller, until it fits.
 */
export async function prepareWebsitePhoto(file: File): Promise<Blob> {
  for (const step of WEBSITE_PHOTO_STEPS) {
    const blob = await prepareImage(file, { mode: "contain", type: "image/jpeg", ...step });
    if (blob.size <= WEBSITE_PHOTO_BYTES) return blob;
  }
  throw new Error("That photo is too large to upload, even made smaller. Try another photo.");
}

/** PUT an image to a staff API path; resolves with the JSON the API answers. */
export function putImage<T>(path: string, body: Blob): Promise<T> {
  return sendImage<T>("PUT", path, body);
}

/** POST an image to a staff API path (a new website photo); resolves with the JSON answered. */
export function postImage<T>(path: string, body: Blob): Promise<T> {
  return sendImage<T>("POST", path, body);
}

async function sendImage<T>(method: "PUT" | "POST", path: string, body: Blob): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers: { "Content-Type": body.type, Accept: "application/json" },
      credentials: "same-origin",
      body,
    });
  } catch {
    throw new ApiRequestError(0, "offline", "You're offline. Reconnect to upload an image.");
  }
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: { code: string; message: string } })
    | null;
  if (!res.ok || !data) {
    throw new ApiRequestError(
      res.status,
      data?.error?.code ?? "error",
      data?.error?.message ?? "Couldn't upload the image.",
    );
  }
  return data;
}

/** What the API takes for a payment proof: JPEG, PNG, or WebP, 1.5 MB at most. */
export const PROOF_MAX_BYTES = 1_500_000;
const PROOF_TYPES = ["image/jpeg", "image/png", "image/webp"];

export interface PreparedProof {
  blob: Blob;
  /** Shrunk or re-encoded to fit (the original was too big, or not a JPEG, PNG, or WebP). */
  resized: boolean;
}

/**
 * Gets a payment screenshot (or a photo of a receipt) ready to send. One that already fits is
 * sent untouched; anything bigger than 1.5 MB, or in another format a phone hands over (HEIC, GIF),
 * is redrawn as a JPEG: at most 2400 px on its long side, then smaller and lighter until it fits,
 * so the reference number stays readable and typical phone pictures just work.
 */
export async function prepareProofImage(file: File): Promise<PreparedProof> {
  if (PROOF_TYPES.includes(file.type) && file.size > 0 && file.size <= PROOF_MAX_BYTES) {
    return { blob: file, resized: false };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("That file isn't a picture we can read. Use a screenshot or a photo.");
  }
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't prepare pictures. Try another browser.");
    const longest = Math.max(bitmap.width, bitmap.height);
    let edge = Math.min(2400, longest);
    let quality = 0.86;
    for (let attempt = 0; attempt < 8; attempt++) {
      const scale = edge / longest;
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      // JPEG has no transparency: a screenshot's clear corners would turn black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (!blob) throw new Error("This browser can't prepare pictures. Try another browser.");
      if (blob.size <= PROOF_MAX_BYTES) return { blob, resized: true };
      if (quality > 0.7) quality -= 0.08;
      else edge = Math.round(edge * 0.8);
    }
    throw new Error("That picture is too large to send, even made smaller. Send a screenshot.");
  } finally {
    bitmap.close();
  }
}
