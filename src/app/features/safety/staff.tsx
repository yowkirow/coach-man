import type { ClientDetailDto, PickupDto, SafetyUpdateDto } from "@shared/api-types";
import { isMinor } from "@shared/family";
import { SAFETY_EDITOR_LABELS } from "@shared/safety";
import { useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/display";
import { api, fileUrl } from "../../lib/api";
import { type Format, plural, useFormat } from "../../lib/format";
import { notify } from "../../lib/notify";
import { keys } from "../../lib/query";
import { SectionHead } from "../clients/bits";
import { PickupList, PickupSheet } from "./pickups";

/** "Updated by Maria Santos (parent or guardian) on Nov 5, 2026": who last changed these details. */
export function safetyUpdateText(u: SafetyUpdateDto, fmt: Format): string {
  const who = u.byName
    ? `${u.byName} (${SAFETY_EDITOR_LABELS[u.relation]})`
    : SAFETY_EDITOR_LABELS[u.relation];
  return `Updated by ${who} on ${fmt.date(fmt.dayOf(u.at))}`;
}

/** The line staff read under a student's health and emergency details. */
export function SafetyUpdatedLine({ update }: { update: SafetyUpdateDto | null | undefined }) {
  const fmt = useFormat();
  if (!update) return null;
  return (
    <p className="num text-[0.8125rem] text-ink-2">
      Health and emergency details · {safetyUpdateText(update, fmt)}
    </p>
  );
}

/**
 * Authorized pickup people on a student's profile (any staff role adds, edits, and removes them;
 * coaches meet them at the court). Shown for juniors, or whenever someone is on file.
 */
export function PickupsCard({ detail }: { detail: ClientDetailDto }) {
  const fmt = useFormat();
  const qc = useQueryClient();
  const c = detail.client;
  const pickups = detail.pickups ?? [];
  const [editing, setEditing] = useState<PickupDto | null>(null);
  const [open, setOpen] = useState(false);
  const junior = isMinor({ birthDate: c.birthDate, isJunior: c.isJunior, today: fmt.today() });
  if (!junior && !pickups.length) return null;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.client(c.id) });
    void qc.invalidateQueries({ queryKey: keys.today });
    void qc.invalidateQueries({ queryKey: ["lesson"] });
  };
  const edit = (p: PickupDto | null) => {
    setEditing(p);
    setOpen(true);
  };
  return (
    <Card label="Pickup">
      <SectionHead
        title="Pickup"
        count={pickups.length || undefined}
        action={
          <Button
            variant="light"
            size="sm"
            icon={<UserPlus aria-hidden className="size-4" />}
            onPress={() => edit(null)}
          >
            Add person
          </Button>
        }
      />
      <div className="px-5 pb-5">
        {pickups.length ? (
          <PickupList pickups={pickups} photoUrl={fileUrl} onEdit={edit} />
        ) : (
          <p className="text-ink-2">
            Nobody is on file yet besides the parents. Add the people allowed to pick {c.firstName}{" "}
            up, with a photo so coaches know them at the court.
          </p>
        )}
      </div>
      <PickupSheet
        isOpen={open}
        onOpenChange={setOpen}
        pickup={editing}
        studentName={c.firstName}
        photoUrl={fileUrl}
        save={async (body) => {
          if (editing) await api.patch(`/clients/${c.id}/pickups/${editing.id}`, body);
          else await api.post(`/clients/${c.id}/pickups`, body);
          refresh();
          notify({
            tone: "success",
            title: editing ? "Pickup person saved" : "Pickup person added",
            body: `${plural(pickups.length + (editing ? 0 : 1), "person")} can pick ${c.firstName} up.`,
          });
        }}
        remove={async (p) => {
          await api.del(`/clients/${c.id}/pickups/${p.id}`);
          refresh();
          notify({ tone: "neutral", title: `${p.name} removed` });
        }}
      />
    </Card>
  );
}
