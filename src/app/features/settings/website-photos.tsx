import { MAX_ACADEMY_PHOTOS, movePhoto, PHOTO_LIMIT_MESSAGE } from "@shared/academy-photos";
import type { AcademyPhotoDto } from "@shared/api-types";
import { framingOr, framingStyle, type PhotoFraming, SCENE_FRAMING } from "@shared/framing";
import { academyPhotoUpdateSchema } from "@shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  ImageOff,
  ImagePlus,
  Images,
  Move,
  Pencil,
  Trash2,
} from "lucide-react";
import { useId, useState } from "react";
import { FileTrigger, Button as RACButton } from "react-aria-components";
import { PhotoFramer } from "../../components/domain/photo-framer";
import { Button, IconButton, tapArea } from "../../components/ui/button";
import { EmptyState, ErrorState, InlineError, RowsSkeleton } from "../../components/ui/feedback";
import { TextField } from "../../components/ui/field";
import { ConfirmSheet, Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors, fileUrl } from "../../lib/api";
import { plural } from "../../lib/format";
import { useAcademy, useCan } from "../../lib/hooks";
import { postImage, prepareWebsitePhoto } from "../../lib/images";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { OfflineNote } from "./offline";
import { SettingsSection } from "./sections";

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** A photo and its place in the order, counted from 1 ("photo 3"). */
interface PhotoAt {
  photo: AcademyPhotoDto;
  number: number;
}

/** The academy's website photos, in its order (everyone on the team may read them). */
function useAcademyPhotos() {
  return useQuery({
    queryKey: keys.academyPhotos,
    queryFn: () => api.get<AcademyPhotoDto[]>("/academy/photos"),
  });
}

/** After a change: the photos, and the public page and its preview, which show them. */
function useRefreshPhotos() {
  const qc = useQueryClient();
  const slug = useAcademy().data?.slug;
  return () => {
    void qc.invalidateQueries({ queryKey: keys.academyPhotos });
    void qc.invalidateQueries({ queryKey: keys.publicPreview });
    if (slug) void qc.invalidateQueries({ queryKey: keys.publicAcademy(slug) });
  };
}

/** Moves still saving, sent one after another in the order they were made. */
const orderQueue: { chain: Promise<unknown>; pending: number } = {
  chain: Promise.resolve(),
  pending: 0,
};

/**
 * Saves a new order for the photos, showing it right away. A quick series of moves is saved in
 * order, each from the one before, and the photos are refetched once the last one lands.
 */
function usePhotoOrder() {
  const qc = useQueryClient();
  const refresh = useRefreshPhotos();
  return useMutation({
    meta: { silent: true },
    mutationFn: (photos: AcademyPhotoDto[]) => {
      const run = orderQueue.chain.then(() =>
        api.put<AcademyPhotoDto[]>("/academy/photos/order", { ids: photos.map((p) => p.id) }),
      );
      orderQueue.chain = run.catch(() => undefined);
      return run;
    },
    onMutate: async (photos) => {
      orderQueue.pending += 1;
      await qc.cancelQueries({ queryKey: keys.academyPhotos });
      const prev = qc.getQueryData<AcademyPhotoDto[]>(keys.academyPhotos);
      qc.setQueryData(keys.academyPhotos, photos);
      return { prev };
    },
    onError: (err, _photos, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.academyPhotos, ctx.prev);
      notify({ tone: "danger", title: "Couldn't change the order", body: errorMessage(err) });
    },
    onSettled: () => {
      orderQueue.pending = Math.max(0, orderQueue.pending - 1);
      if (orderQueue.pending === 0) refresh();
    },
  });
}

/** A photo in its 4:3 frame as the website shows it, or an empty frame when it can't load. */
function PhotoFrame({
  src,
  alt,
  framing,
}: {
  src: string | null;
  alt: string;
  framing: PhotoFraming | null;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (src && failed !== src) {
    return (
      <span className="block aspect-[4/3] w-full overflow-hidden rounded-2xl bg-panel">
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(src)}
          style={framingStyle(framingOr(framing, SCENE_FRAMING))}
          className="block size-full object-cover"
        />
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={alt}
      className="flex aspect-[4/3] w-full items-center justify-center rounded-2xl bg-panel text-ink-3"
    >
      <ImageOff aria-hidden className="size-6" />
    </span>
  );
}

function PhotoTile({
  at,
  count,
  canEdit,
  canMove,
  canRemove,
  onMove,
  onCaption,
  onAdjust,
  onRemove,
}: {
  at: PhotoAt;
  count: number;
  canEdit: boolean;
  canMove: boolean;
  canRemove: boolean;
  onMove: (by: -1 | 1) => void;
  onCaption: () => void;
  onAdjust: () => void;
  onRemove: () => void;
}) {
  const online = useOnline();
  const { photo, number } = at;
  return (
    <li className="flex min-w-0 flex-col gap-2">
      <PhotoFrame src={fileUrl(photo.key)} alt={`Photo ${number}`} framing={photo.framing} />
      {photo.caption ? (
        <div className="flex items-start gap-1">
          <p className="min-w-0 flex-1 pt-1.5 text-[0.875rem] break-words">{photo.caption}</p>
          {canEdit ? (
            <IconButton
              size="sm"
              label={`Edit the caption of photo ${number}`}
              isDisabled={!online}
              onPress={onCaption}
              className="shrink-0"
            >
              <Pencil aria-hidden className="size-4" />
            </IconButton>
          ) : null}
        </div>
      ) : canEdit ? (
        <RACButton
          aria-label={`Add a caption to photo ${number}`}
          isDisabled={!online}
          onPress={onCaption}
          className={`${tapArea} self-start rounded-full py-1 text-left text-[0.875rem] font-medium text-ink-2 underline decoration-line-strong underline-offset-4 outline-none hover:text-ink data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-ink`}
        >
          Add a caption
        </RACButton>
      ) : (
        <p className="text-[0.875rem] text-ink-2">No caption</p>
      )}
      {canEdit ? (
        <div className="flex items-center gap-1">
          <IconButton
            size="sm"
            label={`Move photo ${number} earlier`}
            isDisabled={!online || !canMove || number === 1}
            onPress={() => onMove(-1)}
          >
            <ArrowLeft aria-hidden className="size-4" />
          </IconButton>
          <IconButton
            size="sm"
            label={`Move photo ${number} later`}
            isDisabled={!online || !canMove || number === count}
            onPress={() => onMove(1)}
          >
            <ArrowRight aria-hidden className="size-4" />
          </IconButton>
          <IconButton
            size="sm"
            label={`Adjust photo ${number}`}
            isDisabled={!online}
            onPress={onAdjust}
          >
            <Move aria-hidden className="size-4" />
          </IconButton>
          <IconButton
            size="sm"
            label={`Remove photo ${number}`}
            isDisabled={!online || !canRemove}
            onPress={onRemove}
            className="ml-auto"
          >
            <Trash2 aria-hidden className="size-4" />
          </IconButton>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The line under a photo on the website: up to 140 characters, empty for none. Saves with the
 * button or Enter. Render it with a new `key` for each photo it opens for.
 */
function CaptionSheet({ target, onClose }: { target: PhotoAt | null; onClose: () => void }) {
  const online = useOnline();
  const qc = useQueryClient();
  const refresh = useRefreshPhotos();
  const [value, setValue] = useState(target?.photo.caption ?? "");
  const [error, setError] = useState<string | undefined>();
  const save = useMutation({
    meta: { silent: true },
    mutationFn: (v: { id: string; caption: string | null }) =>
      api.patch<AcademyPhotoDto>(`/academy/photos/${v.id}`, { caption: v.caption }),
    onSuccess: (saved) => {
      qc.setQueryData<AcademyPhotoDto[]>(keys.academyPhotos, (old) =>
        old?.map((p) => (p.id === saved.id ? saved : p)),
      );
      refresh();
      notify({ tone: "success", title: saved.caption ? "Caption saved" : "Caption removed" });
      onClose();
    },
    onError: (e) => setError(fieldErrors(e).caption),
  });

  const submit = () => {
    if (!target || save.isPending) return;
    const parsed = academyPhotoUpdateSchema.safeParse({ caption: value });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the caption.");
      return;
    }
    if (parsed.data.caption === target.photo.caption) {
      onClose();
      return;
    }
    save.mutate({ id: target.photo.id, caption: parsed.data.caption ?? null });
  };

  const saveError = save.error && !fieldErrors(save.error).caption ? save.error : null;
  return (
    <Sheet
      isOpen={target !== null}
      onOpenChange={(open) => !open && onClose()}
      title={target ? `Caption for photo ${target.number}` : "Caption"}
      description="A short line under the photo on your website."
      footer={
        <>
          <Button variant="light" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="dark" isDisabled={!online} isPending={save.isPending} onPress={submit}>
            Save caption
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (online) submit();
        }}
      >
        {target ? (
          <div className="w-full max-w-64">
            <PhotoFrame
              src={fileUrl(target.photo.key)}
              alt={`Photo ${target.number}`}
              framing={target.photo.framing}
            />
          </div>
        ) : null}
        <TextField
          label="Caption"
          value={value}
          onChange={(v) => {
            setValue(v);
            setError(undefined);
          }}
          autoComplete="off"
          autoFocus
          placeholder="Saturday clinic on court 2"
          description="Up to 140 characters. Leave it empty for no caption."
          error={error}
        />
        {saveError ? <InlineError>{errorMessage(saveError)}</InlineError> : null}
        <OfflineNote />
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/**
 * Settings: the photos on the academy's website (courts, sessions, camps), in its order, each
 * with an optional caption. Everyone who sees the academy profile sees them; owners and admins
 * (`settings`) add photos (resized in the browser and sent one after another), caption, move,
 * and remove them. At most 24.
 */
export function WebsitePhotosSection() {
  const online = useOnline();
  const canEdit = useCan().settings;
  const qc = useQueryClient();
  const q = useAcademyPhotos();
  const refresh = useRefreshPhotos();
  const order = usePhotoOrder();
  const statusId = useId();
  const [progress, setProgress] = useState<{ at: number; of: number } | null>(null);
  // A new key for every opening, so the sheet starts fresh for each photo.
  const [caption, setCaption] = useState<{ key: number; target: PhotoAt | null }>({
    key: 0,
    target: null,
  });
  const [removing, setRemoving] = useState<PhotoAt | null>(null);
  const [adjusting, setAdjusting] = useState<PhotoAt | null>(null);
  const photos = q.data ?? [];
  const full = photos.length >= MAX_ACADEMY_PHOTOS;

  const upload = useMutation({
    meta: { silent: true },
    mutationFn: async ({ files }: { files: File[]; skipped: number }) => {
      let added = 0;
      try {
        for (const [i, file] of files.entries()) {
          setProgress({ at: i + 1, of: files.length });
          const photo = await postImage<AcademyPhotoDto>(
            "/academy/photos",
            await prepareWebsitePhoto(file),
          );
          qc.setQueryData<AcademyPhotoDto[]>(keys.academyPhotos, (old) => [...(old ?? []), photo]);
          added += 1;
        }
      } catch (err) {
        // The photos sent before this one stay added.
        const sent = added ? `Added ${added} of ${files.length}. ` : "";
        throw new Error(`${sent}${errorMessage(err)}`);
      }
      return added;
    },
    onSuccess: (added, { skipped }) =>
      notify({
        tone: "success",
        title: added === 1 ? "Photo added" : `${plural(added, "photo")} added`,
        body: skipped
          ? `You can show up to ${MAX_ACADEMY_PHOTOS} photos, so ${plural(skipped, "photo")} ${skipped === 1 ? "wasn't" : "weren't"} added.`
          : undefined,
      }),
    onSettled: () => {
      setProgress(null);
      refresh();
    },
  });

  const remove = useMutation({
    meta: { silent: true },
    mutationFn: (id: string) => api.del(`/academy/photos/${id}`),
    onSuccess: (_d, id) => {
      qc.setQueryData<AcademyPhotoDto[]>(keys.academyPhotos, (old) =>
        old?.filter((p) => p.id !== id),
      );
      refresh();
      notify({ tone: "neutral", title: "Photo removed", body: "It's off your website." });
      setRemoving(null);
    },
    onError: () => setRemoving(null),
  });

  const frame = useMutation({
    meta: { silent: true },
    mutationFn: ({ id, framing }: { id: string; framing: PhotoFraming | null }) =>
      api.patch<AcademyPhotoDto>(`/academy/photos/${id}`, { framing }),
    onSuccess: (saved) => {
      qc.setQueryData<AcademyPhotoDto[]>(keys.academyPhotos, (old) =>
        old?.map((p) => (p.id === saved.id ? saved : p)),
      );
      refresh();
      setAdjusting(null);
      notify({ tone: "success", title: "Photo adjusted" });
    },
  });

  const choose = (list: FileList | null) => {
    const chosen = Array.from(list ?? []);
    if (!chosen.length) return;
    const room = Math.max(0, MAX_ACADEMY_PHOTOS - photos.length);
    const files = chosen.slice(0, room);
    upload.reset();
    if (files.length) upload.mutate({ files, skipped: chosen.length - files.length });
  };

  const body = (() => {
    if (q.isPending) return <RowsSkeleton rows={2} />;
    if (!q.data) {
      return (
        <ErrorState
          title="Couldn't load the website photos"
          message={errorMessage(q.error)}
          onRetry={() => void q.refetch()}
        />
      );
    }
    const error = upload.error ?? remove.error;
    return (
      <div className="flex flex-col gap-5">
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <FileTrigger acceptedFileTypes={PHOTO_TYPES} allowsMultiple onSelect={choose}>
              <Button
                variant="light"
                size="sm"
                aria-describedby={statusId}
                isDisabled={!online || full || upload.isPending || remove.isPending}
                isPending={upload.isPending}
                icon={<ImagePlus aria-hidden className="size-4" />}
              >
                {progress ? `Uploading ${progress.at} of ${progress.of}` : "Add photos"}
              </Button>
            </FileTrigger>
            <p id={statusId} className="text-[0.8125rem] text-ink-2">
              {full ? PHOTO_LIMIT_MESSAGE : `${photos.length} of ${MAX_ACADEMY_PHOTOS} photos`}
            </p>
            <span role="status" className="sr-only">
              {progress ? `Uploading ${progress.at} of ${progress.of}` : ""}
            </span>
          </div>
        ) : null}
        {photos.length ? (
          <ol
            aria-label="Website photos"
            className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 xl:grid-cols-4"
          >
            {photos.map((photo, i) => (
              <PhotoTile
                key={photo.id}
                at={{ photo, number: i + 1 }}
                count={photos.length}
                canEdit={canEdit}
                canMove={!upload.isPending && !remove.isPending}
                canRemove={!upload.isPending && !order.isPending}
                onMove={(by) => order.mutate(movePhoto(photos, i, by))}
                onCaption={() =>
                  setCaption((s) => ({ key: s.key + 1, target: { photo, number: i + 1 } }))
                }
                onAdjust={() => setAdjusting({ photo, number: i + 1 })}
                onRemove={() => setRemoving({ photo, number: i + 1 })}
              />
            ))}
          </ol>
        ) : (
          <EmptyState
            icon={<Images aria-hidden className="size-5" />}
            title="No photos yet"
            body="Add photos of your courts, sessions, and camps. They appear on your website."
          />
        )}
        {error ? <InlineError>{errorMessage(error)}</InlineError> : null}
        {canEdit ? (
          <>
            <OfflineNote>You're offline. Reconnect to change your website photos.</OfflineNote>
            <p className="text-[0.8125rem] text-ink-2">
              Only upload photos you have permission to share. For children, ask a parent first.
            </p>
          </>
        ) : null}
      </div>
    );
  })();

  return (
    <SettingsSection
      id="website-photos"
      title="Website photos"
      description="Your courts, sessions, and camps on your academy's website, in this order."
    >
      {body}
      <CaptionSheet
        key={caption.key}
        target={caption.target}
        onClose={() => setCaption((s) => ({ ...s, target: null }))}
      />
      <PhotoFramer
        isOpen={adjusting !== null}
        onClose={() => {
          setAdjusting(null);
          frame.reset();
        }}
        src={adjusting ? fileUrl(adjusting.photo.key) : null}
        aspect={4 / 3}
        framing={framingOr(adjusting?.photo.framing, SCENE_FRAMING)}
        fallback={SCENE_FRAMING}
        title={adjusting ? `Adjust photo ${adjusting.number}` : "Adjust photo"}
        description="How it sits in its frame on your website."
        previews={
          adjusting?.number === 1
            ? [{ label: "Home page, while there's no cover", aspect: 0.82 }]
            : []
        }
        onSave={(framing) => adjusting && frame.mutate({ id: adjusting.photo.id, framing })}
        isSaving={frame.isPending}
        error={frame.error ? errorMessage(frame.error) : null}
      />
      {removing ? (
        <ConfirmSheet
          isOpen
          onOpenChange={(open) => !open && setRemoving(null)}
          title={`Remove photo ${removing.number}?`}
          body="It comes off your website right away, and its file is deleted. This can't be undone."
          confirmLabel="Remove photo"
          isPending={remove.isPending}
          onConfirm={() => online && remove.mutate(removing.photo.id)}
        />
      ) : null}
    </SettingsSection>
  );
}
