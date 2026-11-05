import { and, asc, count, eq, isNotNull } from "drizzle-orm";
import type { PickupDto, SafetyUpdateDto } from "../../shared/api-types";
import { uuidv7 } from "../../shared/ids";
import {
  changedFields,
  FAMILY_SAFETY_FIELDS,
  MAX_PICKUPS_ON_FILE,
  PICKUP_FIELDS,
  photoChange,
  type SafetyEditor,
  touchesSafety,
} from "../../shared/safety";
import type { FamilySafetyInput, PickupInput } from "../../shared/schemas";
import type { Db } from "../db/client";
import { auditLog, authorizedPickup, client, user } from "../db/schema";
import { ApiError, notFound } from "../lib/errors";
import { toPickupDto } from "../lib/portal-dto";
import { inList, unique } from "../lib/sql";
import { pickupKeyFor } from "../lib/uploads";

type ClientRow = typeof client.$inferSelect;
type PickupRow = typeof authorizedPickup.$inferSelect;

/** Who is changing a student's safety details, and as what. */
export interface SafetyActor {
  userId: string;
  by: SafetyEditor;
}

export interface PickupImage {
  body: ArrayBuffer;
  type: string;
  ext: string;
}

/** Builds (does not run) an audit insert: field names only, never the values. */
function safetyAudit(
  db: Db,
  input: {
    workspaceId: string;
    userId: string;
    action: "create" | "update" | "delete";
    entity: "client_safety" | "authorized_pickup";
    entityId: string;
    data: Record<string, unknown>;
  },
) {
  return db.insert(auditLog).values({ id: uuidv7(), ...input });
}

/** The pickup people of some students, oldest first, by student. */
export async function pickupsOf(
  db: Db,
  workspaceId: string,
  clientIds: readonly string[],
): Promise<Map<string, PickupDto[]>> {
  const out = new Map<string, PickupDto[]>();
  const ids = unique([...clientIds]);
  if (!ids.length) return out;
  const rows = await db
    .select()
    .from(authorizedPickup)
    .where(
      and(eq(authorizedPickup.workspaceId, workspaceId), inList(authorizedPickup.clientId, ids)),
    )
    .orderBy(asc(authorizedPickup.createdAt), asc(authorizedPickup.id));
  for (const r of rows) {
    const list = out.get(r.clientId) ?? [];
    list.push(toPickupDto(r));
    out.set(r.clientId, list);
  }
  return out;
}

/** Staff: who last changed the student's health and emergency details (their name and as what). */
export async function staffSafetyUpdate(
  db: Db,
  row: Pick<ClientRow, "safetyUpdatedAt" | "safetyUpdatedBy" | "safetyUpdatedRelation">,
): Promise<SafetyUpdateDto | null> {
  if (!row.safetyUpdatedAt || !row.safetyUpdatedRelation) return null;
  const person = row.safetyUpdatedBy
    ? await db.query.user.findFirst({
        where: eq(user.id, row.safetyUpdatedBy),
        columns: { name: true },
      })
    : undefined;
  return {
    at: row.safetyUpdatedAt,
    relation: row.safetyUpdatedRelation,
    byName: person?.name ?? null,
  };
}

/**
 * A family member changes a student's health, emergency, parent-contact, or shirt-size details
 * (their rights are checked by the caller). Only real changes are written; when the health and
 * emergency details change, the student's "Updated by" line moves to this person. One batch: the
 * change and its audit entry, which names the fields, never the medical text.
 */
export async function updateFamilySafety(
  db: Db,
  row: ClientRow,
  input: FamilySafetyInput,
  actor: SafetyActor,
): Promise<string[]> {
  const fields = changedFields(FAMILY_SAFETY_FIELDS, row, input);
  if (!fields.length) return [];
  const set: Partial<ClientRow> = {};
  for (const f of fields) set[f] = (input[f] ?? null) as never;
  if (touchesSafety(fields)) {
    set.safetyUpdatedAt = Date.now();
    set.safetyUpdatedBy = actor.userId;
    set.safetyUpdatedRelation = actor.by;
  }
  await db.batch([
    db
      .update(client)
      .set(set)
      .where(and(eq(client.id, row.id), eq(client.workspaceId, row.workspaceId))),
    safetyAudit(db, {
      workspaceId: row.workspaceId,
      userId: actor.userId,
      action: "update",
      entity: "client_safety",
      entityId: row.id,
      data: { fields, by: actor.by },
    }),
  ]);
  return fields;
}

/**
 * Staff edits through the client form (PATCH /api/v1/clients/:id): the statements that record a
 * change to the safety details (the "Updated by" columns, to merge into the update) and its audit
 * entry. Nothing when no safety field really changes.
 */
export function staffSafetyChange(
  db: Db,
  row: ClientRow,
  input: Partial<Record<string, unknown>>,
  actor: { userId: string },
): { set: Partial<ClientRow>; audit: ReturnType<typeof safetyAudit> | null } {
  const fields = changedFields(
    [
      "medicalNotes",
      "emergencyName",
      "emergencyPhone",
      "guardianName",
      "guardianPhone",
      "guardianEmail",
      "shirtSize",
    ] as const,
    row,
    input,
  );
  if (!fields.length) return { set: {}, audit: null };
  const set: Partial<ClientRow> = touchesSafety(fields)
    ? { safetyUpdatedAt: Date.now(), safetyUpdatedBy: actor.userId, safetyUpdatedRelation: "staff" }
    : {};
  return {
    set,
    audit: safetyAudit(db, {
      workspaceId: row.workspaceId,
      userId: actor.userId,
      action: "update",
      entity: "client_safety",
      entityId: row.id,
      data: { fields, by: "staff" },
    }),
  };
}

/** One of the student's pickup people, or 404. */
async function pickupOf(db: Db, workspaceId: string, clientId: string, pickupId: string) {
  const row = await db.query.authorizedPickup.findFirst({
    where: and(
      eq(authorizedPickup.id, pickupId),
      eq(authorizedPickup.workspaceId, workspaceId),
      eq(authorizedPickup.clientId, clientId),
    ),
  });
  if (!row) throw notFound("Pickup person");
  return row;
}

/**
 * Adds a pickup person (no `pickupId`) or changes one: name, relationship, phone, notes, and the
 * photo (a new one replaces the old; `removePhoto` drops it). The photo is stored privately under
 * the student's `pickups/` folder first; the row and its audit entry are written together, and the
 * new photo is removed again if they aren't. The old photo is deleted once the change is saved.
 */
export async function savePickup(
  db: Db,
  env: Env,
  input: {
    workspaceId: string;
    clientId: string;
    pickupId?: string | null;
    data: PickupInput;
    image: PickupImage | null;
    actor: SafetyActor;
  },
): Promise<PickupDto> {
  const { workspaceId, clientId, data, image, actor } = input;
  const existing = input.pickupId
    ? await pickupOf(db, workspaceId, clientId, input.pickupId)
    : null;
  if (!existing) {
    const [n] = await db
      .select({ n: count() })
      .from(authorizedPickup)
      .where(
        and(eq(authorizedPickup.workspaceId, workspaceId), eq(authorizedPickup.clientId, clientId)),
      );
    if ((n?.n ?? 0) >= MAX_PICKUPS_ON_FILE) {
      throw new ApiError(
        409,
        "too_many_pickups",
        `Up to ${MAX_PICKUPS_ON_FILE} people can be on file. Remove someone first.`,
      );
    }
  }
  const id = existing?.id ?? uuidv7();
  const key = image ? pickupKeyFor(workspaceId, clientId, image.ext) : null;
  const photoKey = key ?? (data.removePhoto ? null : (existing?.photoKey ?? null));
  const values = {
    name: data.name,
    relationship: data.relationship ?? null,
    phone: data.phone ?? null,
    notes: data.notes ?? null,
    photoKey,
  };
  const fields = existing
    ? changedFields(PICKUP_FIELDS, existing, values)
    : PICKUP_FIELDS.filter((f) => Boolean(values[f]));
  const photo = photoChange({
    hadPhoto: Boolean(existing?.photoKey),
    newPhoto: Boolean(key),
    removePhoto: Boolean(data.removePhoto),
  });
  if (existing && !fields.length && !photo) return toPickupDto(existing);

  if (image && key) {
    await env.FILES.put(key, image.body, {
      httpMetadata: { contentType: image.type },
      customMetadata: { pickupId: id, uploadedBy: actor.userId },
    });
  }
  try {
    await db.batch([
      existing
        ? db
            .update(authorizedPickup)
            .set(values)
            .where(
              and(
                eq(authorizedPickup.id, id),
                eq(authorizedPickup.workspaceId, workspaceId),
                eq(authorizedPickup.clientId, clientId),
              ),
            )
        : db.insert(authorizedPickup).values({
            id,
            workspaceId,
            clientId,
            ...values,
            createdBy: actor.userId,
          }),
      safetyAudit(db, {
        workspaceId,
        userId: actor.userId,
        action: existing ? "update" : "create",
        entity: "authorized_pickup",
        entityId: id,
        data: { clientId, fields, ...(photo ? { photo } : {}), by: actor.by },
      }),
    ]);
  } catch (err) {
    if (key) await env.FILES.delete(key).catch(() => undefined);
    throw err;
  }
  if (existing?.photoKey && existing.photoKey !== photoKey) {
    await env.FILES.delete(existing.photoKey).catch(() => undefined);
  }
  const saved = await pickupOf(db, workspaceId, clientId, id);
  return toPickupDto(saved);
}

/** Removes a pickup person (and their photo), with an audit entry. */
export async function deletePickup(
  db: Db,
  env: Env,
  input: { workspaceId: string; clientId: string; pickupId: string; actor: SafetyActor },
): Promise<void> {
  const row: PickupRow = await pickupOf(db, input.workspaceId, input.clientId, input.pickupId);
  await db.batch([
    db
      .delete(authorizedPickup)
      .where(
        and(
          eq(authorizedPickup.id, row.id),
          eq(authorizedPickup.workspaceId, input.workspaceId),
          eq(authorizedPickup.clientId, input.clientId),
        ),
      ),
    safetyAudit(db, {
      workspaceId: input.workspaceId,
      userId: input.actor.userId,
      action: "delete",
      entity: "authorized_pickup",
      entityId: row.id,
      data: {
        clientId: input.clientId,
        ...(row.photoKey ? { photo: "removed" } : {}),
        by: input.actor.by,
      },
    }),
  ]);
  if (row.photoKey) await env.FILES.delete(row.photoKey).catch(() => undefined);
}

/** The photo keys of a student's pickup people (deleted from R2 with the student). */
export async function pickupPhotoKeysOf(
  db: Db,
  workspaceId: string,
  clientId: string,
): Promise<string[]> {
  const rows = await db
    .select({ key: authorizedPickup.photoKey })
    .from(authorizedPickup)
    .where(
      and(
        eq(authorizedPickup.workspaceId, workspaceId),
        eq(authorizedPickup.clientId, clientId),
        isNotNull(authorizedPickup.photoKey),
      ),
    );
  return rows.map((r) => r.key).filter((k): k is string => Boolean(k));
}
