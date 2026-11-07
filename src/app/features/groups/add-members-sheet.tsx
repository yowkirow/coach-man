import type { ClientListItemDto, GroupDto } from "@shared/api-types";
import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { ClientPicker } from "../../components/domain/lesson";
import { Button } from "../../components/ui/button";
import { Avatar } from "../../components/ui/display";
import { InlineError } from "../../components/ui/feedback";
import { Sheet } from "../../components/ui/overlay";
import { api, errorMessage } from "../../lib/api";
import { fullName, plural } from "../../lib/format";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { OfflineNote } from "../schedule/choice";
import { useInvalidateGroups } from "./queries";

/** Picks several clients, then adds them in one go and books them into upcoming sessions. */
export function AddMembersSheet({
  isOpen,
  onOpenChange,
  group,
  memberIds,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  group: GroupDto;
  memberIds: string[];
}) {
  const online = useOnline();
  const invalidate = useInvalidateGroups();
  const [picked, setPicked] = useState<ClientListItemDto[]>([]);

  const add = useMutation({
    meta: { silent: true },
    mutationFn: (clients: ClientListItemDto[]) =>
      api.post<GroupDto>(`/groups/${group.id}/members`, { clientIds: clients.map((c) => c.id) }),
    onSuccess: (_g, clients) => {
      invalidate(group.id, { members: true });
      notify({
        tone: "success",
        title:
          clients.length === 1
            ? `${clients[0]?.firstName ?? "Player"} joined ${group.name}`
            : `${plural(clients.length, "member")} added`,
        body: "Booked into the group's upcoming sessions.",
      });
      onOpenChange(false);
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the sheet opens.
  useEffect(() => {
    if (!isOpen) return;
    setPicked([]);
    add.reset();
  }, [isOpen]);

  const total = group.memberCount + picked.length;
  const over = group.capacity !== null && total > group.capacity;

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title="Add members"
      description={
        group.capacity
          ? `${group.memberCount} of ${group.capacity} places taken. Pick everyone who's joining.`
          : "Pick everyone who's joining. They're booked into the group's upcoming sessions."
      }
      footer={
        <>
          {!online ? <OfflineNote className="mr-auto" /> : null}
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="dark"
            isDisabled={!online || picked.length === 0}
            isPending={add.isPending}
            onPress={() => add.mutate(picked)}
          >
            {picked.length > 1 ? `Add ${picked.length} members` : "Add member"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ClientPicker
          label="Clients"
          placeholder="Search by name, email, or phone"
          autoFocus
          exclude={[...memberIds, ...picked.map((c) => c.id)]}
          onSelect={(c) => setPicked((prev) => [...prev, c])}
        />
        {picked.length ? (
          <ul className="flex flex-wrap gap-2" aria-label="Joining">
            {picked.map((c) => (
              <li
                key={c.id}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-panel pl-1.5"
              >
                <Avatar person={c} size="xs" />
                <span className="text-[0.9375rem] font-medium">{fullName(c)}</span>
                <button
                  type="button"
                  aria-label={`Don't add ${fullName(c)}`}
                  onClick={() => setPicked((prev) => prev.filter((x) => x.id !== c.id))}
                  className="flex size-11 cursor-pointer items-center justify-center rounded-full text-ink-2 outline-none hover:bg-line hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.8125rem] text-ink-2">
            Search and pick as many as you like. Nothing is saved until you add them.
          </p>
        )}
        {over ? (
          <p role="status" className="rounded-[22px] bg-amber-soft px-4 py-3 text-[0.875rem]">
            That makes <span className="num font-medium">{total}</span> in a group of{" "}
            <span className="num font-medium">{group.capacity}</span>. You can still add them; the
            limit is a guide.
          </p>
        ) : null}
        {add.error ? <InlineError>{errorMessage(add.error)}</InlineError> : null}
      </div>
    </Sheet>
  );
}
