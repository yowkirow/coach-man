import type { RosterEntryDto, RosterSafetyDto } from "@shared/api-types";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, HeartPulse, UsersRound } from "lucide-react";
import { useState } from "react";
import { Sheet } from "../../components/ui/overlay";
import { fileUrl } from "../../lib/api";
import { fullName, plural } from "../../lib/format";
import { CallButton, PickupList } from "./pickups";

/** A contact line with a Call button (the parent, the emergency contact). */
function ContactRow({
  label,
  name,
  phone,
}: {
  label: string;
  name: string | null;
  phone: string | null;
}) {
  if (!name && !phone) return null;
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[0.8125rem] text-ink-2">{label}</p>
        <p className="font-medium">{name ?? "No name on file"}</p>
        {phone ? <p className="num text-[0.875rem]">{phone}</p> : null}
      </div>
      {phone ? <CallButton phone={phone} name={name ?? label} /> : null}
    </div>
  );
}

function Contacts({ s }: { s: RosterSafetyDto }) {
  const any = s.guardianName || s.guardianPhone || s.emergencyName || s.emergencyPhone;
  if (!any) return null;
  return (
    <div className="flex flex-col divide-y divide-line">
      <ContactRow label="Parent or guardian" name={s.guardianName} phone={s.guardianPhone} />
      <ContactRow label="Emergency contact" name={s.emergencyName} phone={s.emergencyPhone} />
    </div>
  );
}

const profileLink =
  "inline-flex h-9 items-center gap-1.5 self-start rounded-full bg-card px-4 text-[0.875rem] font-medium text-ink ring-1 ring-line-strong outline-none hover:bg-panel focus-visible:outline-2 focus-visible:outline-ink";

/** The medical note itself, as a callout (Coral Wash, Alert Red icon). */
export function MedicalCallout({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-[20px] bg-coral-soft px-4 py-3.5 text-ink">
      <HeartPulse aria-hidden className="mt-0.5 size-5 shrink-0 text-[#b42318]" />
      <p className="text-[1rem] whitespace-pre-line">{text}</p>
    </div>
  );
}

/**
 * At check-in: a player's medical flag (tap to read the note and call home) and, for juniors, who
 * may pick them up (with photos and tap-to-call). Big pills, one tap each, for a phone in one hand.
 */
export function RosterSafety({
  entry,
  className = "",
}: {
  entry: RosterEntryDto;
  className?: string;
}) {
  const [open, setOpen] = useState<null | "medical" | "pickup">(null);
  const s = entry.safety;
  if (!s || (!s.medicalNotes && !s.junior)) return null;
  const name = fullName(entry);
  const count = s.pickups.length;
  const pill =
    "inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full px-4 text-[0.875rem] font-medium text-ink outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {s.medicalNotes ? (
        <button
          type="button"
          onClick={() => setOpen("medical")}
          aria-label={`Medical note for ${name}`}
          className={`${pill} bg-coral-soft hover:brightness-95`}
        >
          <HeartPulse aria-hidden className="size-4 text-[#b42318]" />
          Medical
        </button>
      ) : null}
      {s.junior ? (
        <button
          type="button"
          onClick={() => setOpen("pickup")}
          aria-label={`Who may pick up ${name}: ${count ? plural(count, "person", "people") : "parents only"}`}
          className={`${pill} bg-sky-soft hover:bg-sky`}
        >
          <UsersRound aria-hidden className="size-4" />
          Pickup
          {count ? <span className="num text-ink-2">{count}</span> : null}
        </button>
      ) : null}

      <Sheet
        isOpen={open === "medical"}
        onOpenChange={(v) => setOpen(v ? "medical" : null)}
        title={name}
        description="Medical note"
      >
        <div className="flex flex-col gap-4">
          {s.medicalNotes ? <MedicalCallout text={s.medicalNotes} /> : null}
          <Contacts s={s} />
          <Link
            to="/clients/$clientId"
            params={{ clientId: entry.clientId }}
            className={profileLink}
          >
            Open profile <ArrowUpRight aria-hidden className="size-4" />
          </Link>
        </div>
      </Sheet>

      <Sheet
        isOpen={open === "pickup"}
        onOpenChange={(v) => setOpen(v ? "pickup" : null)}
        title={`Pickup for ${entry.firstName}`}
        description={
          count
            ? `${plural(count, "person", "people")} besides the parents may pick ${entry.firstName} up.`
            : `Only the parents are on file for ${entry.firstName}.`
        }
      >
        <div className="flex flex-col gap-5">
          {count ? (
            <PickupList pickups={s.pickups} photoUrl={fileUrl} />
          ) : (
            <p className="text-ink-2">
              No one else is listed. If someone else comes, call the parent first.
            </p>
          )}
          <Contacts s={s} />
          <Link
            to="/clients/$clientId"
            params={{ clientId: entry.clientId }}
            className={profileLink}
          >
            Edit on {entry.firstName}'s profile <ArrowUpRight aria-hidden className="size-4" />
          </Link>
        </div>
      </Sheet>
    </div>
  );
}
