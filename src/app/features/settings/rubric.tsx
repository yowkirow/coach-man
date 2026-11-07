import type { SkillDto } from "@shared/api-types";
import { skillSchema } from "@shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronDown, MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, IconButton } from "../../components/ui/button";
import { Pill } from "../../components/ui/display";
import { EmptyState, ErrorState, InlineError, RowsSkeleton } from "../../components/ui/feedback";
import { SelectField, Switch, TextAreaField, TextField } from "../../components/ui/field";
import { ActionMenu, Sheet } from "../../components/ui/overlay";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { plural } from "../../lib/format";
import { useSkills } from "../../lib/hooks";
import { notify } from "../../lib/notify";
import { useOnline } from "../../lib/offline";
import { keys } from "../../lib/query";
import { OfflineNote } from "./offline";
import { SettingsSection } from "./sections";
import { changedFields, issuesToFields } from "./validation";

const NEW_CATEGORY = "__new__";

const FRIENDLY: Record<string, string> = {
  category: "Choose or name a category.",
  name: "Give the skill a name.",
  description: "Keep the description under 300 characters.",
};

function swap(ids: string[], a: number, b: number): string[] {
  const next = [...ids];
  const x = next[a];
  const y = next[b];
  if (x === undefined || y === undefined) return ids;
  next[a] = y;
  next[b] = x;
  return next;
}

function SkillSheet({
  isOpen,
  onOpenChange,
  skill,
  categories,
  defaultCategory,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  skill: SkillDto | null;
  categories: string[];
  defaultCategory: string | null;
}) {
  const online = useOnline();
  const qc = useQueryClient();
  const [category, setCategory] = useState<string>(NEW_CATEGORY);
  const [newCategory, setNewCategory] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<SkillDto | null>(skill);
  const editing = isOpen ? skill : shown;

  const save = useMutation({
    meta: { silent: true },
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? api.patch<SkillDto>(`/skills/${editing.id}`, body)
        : api.post<SkillDto>("/skills", body),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: keys.skills });
      void qc.invalidateQueries({ queryKey: ["progress"] });
      notify({
        tone: "success",
        title: editing ? `${s.name} saved` : `${s.name} added to ${s.category}`,
      });
      onOpenChange(false);
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seed only when the sheet opens.
  useEffect(() => {
    if (!isOpen) return;
    setShown(skill);
    setCategory(skill?.category ?? defaultCategory ?? categories[0] ?? NEW_CATEGORY);
    setNewCategory("");
    setName(skill?.name ?? "");
    setDescription(skill?.description ?? "");
    setActive(skill?.active ?? true);
    setErrors({});
    save.reset();
  }, [isOpen]);

  const submit = () => {
    const parsed = skillSchema.safeParse({
      category: category === NEW_CATEGORY ? newCategory : category,
      name,
      description,
      active,
    });
    if (!parsed.success) {
      setErrors(issuesToFields(parsed.error.issues, FRIENDLY));
      return;
    }
    setErrors({});
    const body = {
      category: parsed.data.category,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      active: parsed.data.active ?? true,
    };
    if (!editing) {
      save.mutate(body);
      return;
    }
    const patch = changedFields(body, editing);
    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }
    save.mutate(patch);
  };
  const err = (k: string) => errors[k] ?? fieldErrors(save.error)[k];
  const options = [
    ...categories.map((c) => ({ id: c, label: c })),
    { id: NEW_CATEGORY, label: "New category…" },
  ];

  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={editing ? "Edit skill" : "Add skill"}
      description={
        editing
          ? "Past assessments keep their scores under the new name."
          : "It shows up in the next assessment you record."
      }
      footer={
        <>
          <Button variant="light" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="dark" isDisabled={!online} isPending={save.isPending} onPress={submit}>
            {editing ? "Save skill" : "Add skill"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (online) submit();
        }}
      >
        <SelectField
          label="Category"
          options={options}
          value={category}
          onChange={setCategory}
          error={category === NEW_CATEGORY ? undefined : err("category")}
        />
        {category === NEW_CATEGORY ? (
          <TextField
            label="New category"
            value={newCategory}
            onChange={setNewCategory}
            placeholder="Footwork, Fitness…"
            error={err("category")}
          />
        ) : null}
        <TextField
          label="Skill"
          value={name}
          onChange={setName}
          placeholder="Third-shot drop"
          autoFocus={!editing}
          error={err("name")}
        />
        <TextAreaField
          label="What good looks like (optional)"
          value={description}
          onChange={setDescription}
          rows={2}
          placeholder="Drops that land in the kitchen from the baseline."
          error={err("description")}
        />
        <div className="rounded-[22px] bg-panel px-4 py-2">
          <Switch
            isSelected={active}
            onChange={setActive}
            description={
              active
                ? "Scored in new assessments."
                : "Left out of new assessments. Past scores stay on record."
            }
          >
            In use
          </Switch>
        </div>
        {save.error ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
        <OfflineNote />
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

export function RubricSection() {
  const skills = useSkills();
  const online = useOnline();
  const qc = useQueryClient();
  const [skill, setSkill] = useState<SkillDto | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const sorted = useMemo(
    () => [...(skills.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [skills.data],
  );
  const groups = useMemo(() => {
    const map = new Map<string, SkillDto[]>();
    for (const s of sorted) map.set(s.category, [...(map.get(s.category) ?? []), s]);
    return [...map.entries()];
  }, [sorted]);
  const categories = groups.map(([c]) => c);

  const reorder = useMutation({
    meta: { silent: true },
    mutationFn: (ids: string[]) => api.post("/skills/reorder", { ids }),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: keys.skills });
      const prev = qc.getQueryData<SkillDto[]>(keys.skills);
      qc.setQueryData<SkillDto[]>(keys.skills, (old) =>
        old?.map((s) => ({ ...s, sortOrder: ids.indexOf(s.id) })),
      );
      return { prev };
    },
    onError: (err, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.skills, ctx.prev);
      notify({ tone: "danger", title: "Couldn't reorder skills", body: errorMessage(err) });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.skills });
      void qc.invalidateQueries({ queryKey: ["progress"] });
    },
  });

  const toggle = useMutation({
    meta: { silent: true },
    mutationFn: (s: SkillDto) => api.patch<SkillDto>(`/skills/${s.id}`, { active: !s.active }),
    onMutate: async (s) => {
      await qc.cancelQueries({ queryKey: keys.skills });
      const prev = qc.getQueryData<SkillDto[]>(keys.skills);
      qc.setQueryData<SkillDto[]>(keys.skills, (old) =>
        old?.map((x) => (x.id === s.id ? { ...x, active: !s.active } : x)),
      );
      return { prev };
    },
    onError: (err, s, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.skills, ctx.prev);
      notify({ tone: "danger", title: `Couldn't update ${s.name}`, body: errorMessage(err) });
    },
    onSuccess: (_d, s) =>
      notify({
        tone: "success",
        title: s.active ? `${s.name} is hidden` : `${s.name} is back in use`,
        body: s.active ? "Past scores stay on record." : undefined,
      }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.skills });
      void qc.invalidateQueries({ queryKey: ["progress"] });
    },
  });

  const ids = sorted.map((s) => s.id);
  const moveSkill = (s: SkillDto, dir: -1 | 1) => {
    const list = groups.find(([c]) => c === s.category)?.[1] ?? [];
    const other = list[list.findIndex((x) => x.id === s.id) + dir];
    if (other) reorder.mutate(swap(ids, ids.indexOf(s.id), ids.indexOf(other.id)));
  };
  const moveCategory = (c: string, dir: -1 | 1) => {
    const order = swap(categories, categories.indexOf(c), categories.indexOf(c) + dir);
    reorder.mutate(
      order.flatMap((name) => (groups.find(([x]) => x === name)?.[1] ?? []).map((s) => s.id)),
    );
  };
  const open = (s: SkillDto | null, cat: string | null = null) => {
    setSkill(s);
    setCategory(cat);
    setSheetOpen(true);
  };

  return (
    <SettingsSection
      id="rubric"
      title="Progress rubric"
      description="The skills you score in assessments, by category. Hidden skills keep their past scores."
      action={
        sorted.length ? (
          <Button
            variant="light"
            icon={<Plus aria-hidden className="size-4.5" />}
            isDisabled={!online}
            onPress={() => open(null)}
          >
            Add skill
          </Button>
        ) : null
      }
    >
      {skills.isPending ? (
        <RowsSkeleton rows={3} />
      ) : !skills.data ? (
        <ErrorState
          title="Couldn't load your rubric"
          message={errorMessage(skills.error)}
          onRetry={() => void skills.refetch()}
        />
      ) : sorted.length === 0 ? (
        <EmptyState
          title="No skills yet"
          body="Add the skills you assess, like serve, dink, or footwork. Each one gets a 1 to 5 score in assessments."
          action={
            <Button variant="dark" isDisabled={!online} onPress={() => open(null)}>
              Add skill
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {groups.map(([cat, list], gi) => {
            const inUse = list.filter((s) => s.active).length;
            return (
              <li key={cat}>
                <details className="group rounded-[22px] bg-panel">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-[22px] px-4 py-3 outline-none hover:bg-line/60 focus-visible:outline-2 focus-visible:outline-ink [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{cat}</span>
                      <span className="block truncate text-[0.8125rem] text-ink-2">
                        {list.map((s) => s.name).join(", ")}
                      </span>
                    </span>
                    <span className="num shrink-0 text-[0.8125rem] text-ink-2">
                      {inUse === list.length
                        ? plural(list.length, "skill")
                        : `${inUse} of ${list.length} in use`}
                    </span>
                    <ChevronDown
                      aria-hidden
                      className="size-5 shrink-0 transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <div className="px-2 pb-2">
                    <ul className="flex flex-col divide-y divide-line rounded-[18px] bg-card px-3">
                      {list.map((s, i) => (
                        <li key={s.id} className="flex items-center gap-2 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className={`font-medium ${s.active ? "" : "text-ink-2"}`}>
                                {s.name}
                              </span>
                              {s.active ? null : <Pill tone="panel">Hidden</Pill>}
                            </p>
                            {s.description ? (
                              <p className="text-[0.8125rem] text-ink-2">{s.description}</p>
                            ) : null}
                          </div>
                          <ActionMenu
                            label={`${s.name} options`}
                            trigger={
                              <IconButton label={`${s.name} options`} isDisabled={!online}>
                                <MoreHorizontal aria-hidden className="size-5" />
                              </IconButton>
                            }
                            actions={[
                              { id: "edit", label: "Edit", onAction: () => open(s) },
                              {
                                id: "up",
                                label: "Move up",
                                isDisabled: i === 0,
                                onAction: () => moveSkill(s, -1),
                              },
                              {
                                id: "down",
                                label: "Move down",
                                isDisabled: i === list.length - 1,
                                onAction: () => moveSkill(s, 1),
                              },
                              {
                                id: "toggle",
                                label: s.active ? "Hide from assessments" : "Use again",
                                onAction: () => toggle.mutate(s),
                              },
                            ]}
                          />
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap items-center gap-1 pt-2">
                      <Button
                        variant="ghost"
                        size="md"
                        icon={<Plus aria-hidden className="size-4.5" />}
                        isDisabled={!online}
                        onPress={() => open(null, cat)}
                      >
                        Add to {cat}
                      </Button>
                      <span className="ml-auto flex gap-1">
                        <IconButton
                          label={`Move ${cat} up`}
                          isDisabled={!online || gi === 0}
                          onPress={() => moveCategory(cat, -1)}
                        >
                          <ArrowUp aria-hidden className="size-4.5" />
                        </IconButton>
                        <IconButton
                          label={`Move ${cat} down`}
                          isDisabled={!online || gi === groups.length - 1}
                          onPress={() => moveCategory(cat, 1)}
                        >
                          <ArrowDown aria-hidden className="size-4.5" />
                        </IconButton>
                      </span>
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4">
        <OfflineNote />
      </div>
      <SkillSheet
        isOpen={sheetOpen}
        onOpenChange={setSheetOpen}
        skill={skill}
        categories={categories}
        defaultCategory={category}
      />
    </SettingsSection>
  );
}
