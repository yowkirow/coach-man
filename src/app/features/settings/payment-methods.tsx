import type { MeDto, WorkspaceSettingsDto } from "@shared/api-types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus } from "lucide-react";
import { useState } from "react";
import { Button as RACButton } from "react-aria-components";
import { Button } from "../../components/ui/button";
import { TextField } from "../../components/ui/field";
import { ActionMenu, Sheet } from "../../components/ui/overlay";
import { api, errorMessage } from "../../lib/api";
import { useMe } from "../../lib/hooks";
import { type Notice, notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { OfflineNote } from "./offline";
import { SettingsSection } from "./sections";

const MAX_METHODS = 20;

/** Problem with a method name, or null when it can be saved. */
function nameProblem(name: string, others: string[]): string | null {
  const t = name.trim();
  if (!t) return "Type a name first.";
  if (t.length > 40) return "Keep it under 40 characters.";
  if (others.some((o) => o.toLowerCase() === t.toLowerCase()))
    return `${t} is already on the list.`;
  return null;
}

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

export function PaymentMethodsSection() {
  const me = useMe().data;
  const online = useOnline();
  const qc = useQueryClient();
  const methods = me?.settings.paymentMethods ?? [];
  const [adding, setAdding] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ index: number; value: string } | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  const save = useMutation({
    meta: { silent: true },
    mutationFn: (next: string[]) =>
      api.patch<WorkspaceSettingsDto>("/workspace", { paymentMethods: next }),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: keys.me });
      const prev = qc.getQueryData<MeDto>(keys.me);
      qc.setQueryData<MeDto>(keys.me, (old) =>
        old ? { ...old, settings: { ...old.settings, paymentMethods: next } } : old,
      );
      return { prev };
    },
    onError: (err, _next, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.me, ctx.prev);
      notify({ tone: "danger", title: "Couldn't save payment methods", body: errorMessage(err) });
    },
    onSuccess: (settings) =>
      qc.setQueryData<MeDto>(keys.me, (old) => (old ? { ...old, settings } : old)),
  });

  const commit = (next: string[], toast?: Omit<Notice, "id">) =>
    save.mutate(next, { onSuccess: () => (toast ? void notify(toast) : undefined) });

  const add = () => {
    const problem =
      methods.length >= MAX_METHODS
        ? `You can keep up to ${MAX_METHODS} methods.`
        : nameProblem(adding, methods);
    setAddError(problem);
    if (problem) return;
    commit([...methods, adding.trim()], { tone: "success", title: `${adding.trim()} added` });
    setAdding("");
  };

  const remove = (index: number) => {
    const name = methods[index];
    if (!name || methods.length <= 1) return;
    const before = methods;
    commit(
      methods.filter((_, i) => i !== index),
      {
        tone: "neutral",
        title: `${name} removed`,
        body: "Past payments keep it.",
        action: { label: "Undo", onAction: () => commit(before) },
      },
    );
  };

  const rename = () => {
    if (!renaming) return;
    const others = methods.filter((_, i) => i !== renaming.index);
    const problem = nameProblem(renaming.value, others);
    setRenameError(problem);
    if (problem) return;
    const next = methods.map((m, i) => (i === renaming.index ? renaming.value.trim() : m));
    commit(next, {
      tone: "success",
      title: "Method renamed",
      body: "Past payments keep the old name.",
    });
    setRenaming(null);
  };

  return (
    <SettingsSection
      id="payment-methods"
      title="Payment methods"
      description="The ways clients pay you. The first one is picked for you when you record a payment."
    >
      <ul aria-label="Payment methods" className="flex flex-wrap gap-2">
        {methods.map((m, i) => (
          <li key={m}>
            <ActionMenu
              label={`${m} options`}
              trigger={
                <RACButton
                  isDisabled={!online}
                  className={`inline-flex h-11 cursor-pointer items-center gap-2 rounded-full pr-3 pl-4 text-[0.9375rem] font-medium outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60 data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-ink ${
                    i === 0
                      ? "bg-ink text-white hover:bg-night-3"
                      : "bg-panel text-ink hover:bg-line"
                  }`}
                >
                  {m}
                  {i === 0 ? (
                    <span className="text-[0.75rem] font-normal text-white/70">Default</span>
                  ) : null}
                  <ChevronDown aria-hidden className="size-4 opacity-70" />
                </RACButton>
              }
              actions={[
                {
                  id: "rename",
                  label: "Rename",
                  onAction: () => {
                    setRenameError(null);
                    setRenaming({ index: i, value: m });
                  },
                },
                {
                  id: "default",
                  label: "Make default",
                  isDisabled: i === 0,
                  onAction: () =>
                    commit(move(methods, i, 0), {
                      tone: "success",
                      title: `${m} is now the default`,
                    }),
                },
                {
                  id: "earlier",
                  label: "Move earlier",
                  isDisabled: i === 0,
                  onAction: () => commit(move(methods, i, i - 1)),
                },
                {
                  id: "later",
                  label: "Move later",
                  isDisabled: i === methods.length - 1,
                  onAction: () => commit(move(methods, i, i + 1)),
                },
                {
                  id: "remove",
                  label: methods.length <= 1 ? "Keep at least one" : "Remove",
                  tone: "danger",
                  isDisabled: methods.length <= 1,
                  onAction: () => remove(i),
                },
              ]}
            />
          </li>
        ))}
      </ul>

      <form
        className="mt-5 flex flex-wrap items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (online) add();
        }}
      >
        <TextField
          label="Add a method"
          value={adding}
          onChange={(v) => {
            setAdding(v);
            setAddError(null);
          }}
          placeholder="GCash, Venmo, cheque…"
          error={addError ?? undefined}
          isDisabled={!online}
          className="min-w-0 flex-1 basis-[10rem]"
        />
        <Button
          type="submit"
          variant="light"
          icon={<Plus aria-hidden className="size-4.5" />}
          isDisabled={!online || !adding.trim()}
          className="mt-[25px] h-12"
        >
          Add
        </Button>
      </form>
      <div className="mt-4">
        <OfflineNote />
      </div>

      <Sheet
        isOpen={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        title="Rename method"
        description="Payments already recorded keep the old name."
        footer={
          <>
            <Button variant="light" onPress={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button variant="dark" isDisabled={!online} onPress={rename}>
              Save
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (online) rename();
          }}
        >
          <TextField
            label="Name"
            value={renaming?.value ?? ""}
            onChange={(v) => {
              setRenaming((r) => (r ? { ...r, value: v } : r));
              setRenameError(null);
            }}
            error={renameError ?? undefined}
            autoFocus
          />
          <button type="submit" hidden />
        </form>
      </Sheet>
    </SettingsSection>
  );
}
