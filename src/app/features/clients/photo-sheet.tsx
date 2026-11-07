import type { ClientDetailDto, ClientDto } from "@shared/api-types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Trash2 } from "lucide-react";
import { useEffect } from "react";
import { FileTrigger } from "react-aria-components";
import { Button } from "../../components/ui/button";
import { Avatar } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { Sheet } from "../../components/ui/overlay";
import { ApiRequestError, api, errorMessage } from "../../lib/api";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { OfflineHint } from "./bits";

const MAX_EDGE = 640;

/** Square-crops and shrinks a photo so uploads stay small (the API takes up to 1.5 MB). */
async function preparePhoto(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("That file isn't a photo we can read. Use a JPEG, PNG, or WebP.");
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const out = Math.min(MAX_EDGE, side);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't prepare photos.");
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
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.86),
  );
  if (!blob) throw new Error("This browser can't prepare photos.");
  return blob;
}

async function uploadPhoto(clientId: string, file: File): Promise<string> {
  const body = await preparePhoto(file);
  let res: Response;
  try {
    res = await fetch(`/api/v1/clients/${clientId}/photo`, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg", Accept: "application/json" },
      credentials: "same-origin",
      body,
    });
  } catch {
    throw new ApiRequestError(0, "offline", "You're offline. Reconnect to upload a photo.");
  }
  const data = (await res.json().catch(() => null)) as {
    photoKey?: string;
    error?: { code: string; message: string };
  } | null;
  if (!res.ok || !data?.photoKey) {
    throw new ApiRequestError(
      res.status,
      data?.error?.code ?? "error",
      data?.error?.message ?? "Couldn't upload the photo.",
    );
  }
  return data.photoKey;
}

/** Upload, change, or remove a client's photo. Initials stand in when there is none. */
export function PhotoSheet({
  isOpen,
  onOpenChange,
  client,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  client: ClientDto;
}) {
  const qc = useQueryClient();
  const online = useOnline();
  const store = (photoKey: string | null) => {
    qc.setQueryData<ClientDetailDto>(keys.client(client.id), (old) =>
      old ? { ...old, client: { ...old.client, photoKey } } : old,
    );
    void qc.invalidateQueries({ queryKey: ["clients"] });
    void qc.invalidateQueries({ queryKey: keys.today });
    void qc.invalidateQueries({ queryKey: ["lesson"] });
  };
  const upload = useMutation({
    meta: { silent: true },
    mutationFn: (file: File) => uploadPhoto(client.id, file),
    onSuccess: (photoKey) => {
      store(photoKey);
      notify({ tone: "success", title: "Photo updated" });
      onOpenChange(false);
    },
  });
  const remove = useMutation({
    meta: { silent: true },
    mutationFn: () => api.del(`/clients/${client.id}/photo`),
    onSuccess: () => {
      store(null);
      notify({ tone: "neutral", title: "Photo removed", body: "Initials show instead." });
      onOpenChange(false);
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear old errors each time it opens.
  useEffect(() => {
    if (isOpen) {
      upload.reset();
      remove.reset();
    }
  }, [isOpen]);

  const busy = upload.isPending || remove.isPending;
  const error = upload.error ?? remove.error;
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={client.photoKey ? "Profile photo" : "Add a photo"}
      description="A clear face photo helps you match names on court. Only you can see it."
    >
      <div className="flex flex-col items-center gap-5 pt-2">
        <Avatar person={client} size="xl" />
        <div className="flex flex-wrap justify-center gap-2">
          <FileTrigger
            acceptedFileTypes={["image/jpeg", "image/png", "image/webp"]}
            onSelect={(files) => {
              const file = files?.[0];
              if (file) upload.mutate(file);
            }}
          >
            <Button
              variant="dark"
              isDisabled={!online || busy}
              isPending={upload.isPending}
              icon={<ImagePlus aria-hidden className="size-4.5" />}
            >
              {client.photoKey ? "Choose another photo" : "Choose a photo"}
            </Button>
          </FileTrigger>
          {client.photoKey ? (
            <Button
              variant="light"
              isDisabled={!online || busy}
              isPending={remove.isPending}
              icon={<Trash2 aria-hidden className="size-4.5" />}
              onPress={() => remove.mutate()}
            >
              Remove
            </Button>
          ) : null}
        </div>
        <p className="text-center text-[0.8125rem] text-ink-2">
          JPEG, PNG, or WebP. It's cropped to a square and resized before upload.
        </p>
        {error ? <InlineError>{errorMessage(error)}</InlineError> : null}
        <OfflineHint>You're offline. Reconnect to change the photo.</OfflineHint>
      </div>
    </Sheet>
  );
}
