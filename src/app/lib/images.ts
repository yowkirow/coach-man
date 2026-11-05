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
