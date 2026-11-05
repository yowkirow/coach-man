import { ApiRequestError } from "./api";

/**
 * Shrinks an image in the browser before upload (the API takes up to 1.5 MB). "cover" crops to a
 * square, for faces; "contain" keeps the whole picture, for logos and QR codes.
 */
export async function prepareImage(
  file: File,
  {
    mode,
    maxEdge,
    type,
  }: { mode: "cover" | "contain"; maxEdge: number; type: "image/jpeg" | "image/png" },
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
  if (mode === "cover") {
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
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  }
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, type === "image/jpeg" ? 0.86 : undefined),
  );
  if (!blob) throw new Error("This browser can't prepare images.");
  return blob;
}

/** PUT an image to a staff API path; resolves with the JSON the API answers. */
export async function putImage<T>(path: string, body: Blob): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: "PUT",
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
