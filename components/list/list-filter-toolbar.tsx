"use client";

import {
  CheckIcon,
  FloppyDiskIcon,
  FunnelIcon,
  PencilSimpleIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import * as React from "react";
import type { FilterState, SavedFilterRow } from "@/app/actions/search";
import {
  createSavedFilter,
  deleteSavedFilter,
  getSavedFilters,
  renameSavedFilter,
} from "@/app/actions/search";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Status {
  color: string;
  id: string;
  name: string;
  type: string;
}

interface Member {
  email: string | null;
  name: string | null;
  userId: string;
}

interface Tag {
  color: string;
  id: string;
  name: string;
}

interface ListFilterToolbarProps {
  filters: FilterState;
  listId: string;
  members: Member[];
  onChange: (f: FilterState) => void;
  statuses: Status[];
  tags: Tag[];
}

const PRIORITY_OPTIONS = [
  { value: "NONE", label: "No Priority" },
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
];

const DUE_OPTIONS = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "this_week", label: "This Week" },
  { value: "no_due_date", label: "No Due Date" },
] as const;

function toggle<T>(arr: T[], val: T): T[] {
  return arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];
}

function activeCount(filters: FilterState): number {
  let n = 0;
  if (filters.status?.length) {
    n++;
  }
  if (filters.priority?.length) {
    n++;
  }
  if (filters.assignee?.length) {
    n++;
  }
  if (filters.due) {
    n++;
  }
  if (filters.tags?.length) {
    n++;
  }
  return n;
}

const EMPTY_FILTERS: FilterState = {};

export function ListFilterToolbar({
  listId,
  statuses,
  members,
  tags,
  filters,
  onChange,
}: ListFilterToolbarProps) {
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [savedFilters, setSavedFilters] = React.useState<SavedFilterRow[]>([]);
  const [saveName, setSaveName] = React.useState("");
  const [savingOpen, setSavingOpen] = React.useState(false);
  const [renameId, setRenameId] = React.useState<string | null>(null);
  const [renameName, setRenameName] = React.useState("");

  const count = activeCount(filters);

  React.useEffect(() => {
    getSavedFilters(listId).then((res) => {
      if (!("error" in res)) {
        setSavedFilters(res);
      }
    });
  }, [listId]);

  async function handleSave() {
    if (!saveName.trim()) {
      return;
    }
    const res = await createSavedFilter(listId, saveName.trim(), filters);
    if (!("error" in res)) {
      const updated = await getSavedFilters(listId);
      if (!("error" in updated)) {
        setSavedFilters(updated);
      }
    }
    setSaveName("");
    setSavingOpen(false);
  }

  async function handleDelete(id: string) {
    await deleteSavedFilter(id);
    setSavedFilters((prev) => prev.filter((f) => f.id !== id));
  }

  async function handleRename(id: string) {
    if (!renameName.trim()) {
      return;
    }
    await renameSavedFilter(id, renameName.trim());
    setSavedFilters((prev) =>
      prev.map((f) => (f.id === id ? { ...f, name: renameName.trim() } : f))
    );
    setRenameId(null);
    setRenameName("");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Filter button */}
      <Popover onOpenChange={setPanelOpen} open={panelOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-1.5 h-8 rounded-md border px-3 text-xs font-medium transition-colors",
              count > 0
                ? "border-primary bg-primary/10 text-primary"
                : "hover:bg-accent text-muted-foreground"
            )}
          >
            <FunnelIcon
              className="size-3.5"
              weight={count > 0 ? "fill" : "regular"}
            />
            Filters
            {count > 0 && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-2xs text-primary-foreground font-bold">
                {count}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-3 space-y-4">
          {/* Status */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Status
            </p>
            <div className="flex flex-wrap gap-1.5">
              {statuses.map((s) => {
                const active = filters.status?.includes(s.id);
                return (
                  <button
                    className={cn(
                      "flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs border transition-colors",
                      active
                        ? "border-transparent text-white"
                        : "hover:border-foreground/30"
                    )}
                    key={s.id}
                    onClick={() =>
                      onChange({
                        ...filters,
                        status: toggle(filters.status ?? [], s.id),
                      })
                    }
                    style={
                      active
                        ? { backgroundColor: s.color }
                        : { borderColor: s.color + "60", color: s.color }
                    }
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Priority */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Priority
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PRIORITY_OPTIONS.map((p) => {
                const active = filters.priority?.includes(p.value);
                return (
                  <button
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "hover:bg-accent text-muted-foreground"
                    )}
                    key={p.value}
                    onClick={() =>
                      onChange({
                        ...filters,
                        priority: toggle(filters.priority ?? [], p.value),
                      })
                    }
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Due Date */}
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Due Date
            </p>
            <div className="flex flex-wrap gap-1.5">
              {DUE_OPTIONS.map((d) => {
                const active = filters.due === d.value;
                return (
                  <button
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "hover:bg-accent text-muted-foreground"
                    )}
                    key={d.value}
                    onClick={() =>
                      onChange({ ...filters, due: active ? "" : d.value })
                    }
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Assignee */}
          {members.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Assignee
              </p>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                <label className="flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-accent cursor-pointer">
                  <input
                    checked={filters.assignee?.includes("unassigned") ?? false}
                    className="accent-primary"
                    onChange={() =>
                      onChange({
                        ...filters,
                        assignee: toggle(filters.assignee ?? [], "unassigned"),
                      })
                    }
                    type="checkbox"
                  />
                  Unassigned
                </label>
                {members.map((m) => (
                  <label
                    className="flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-accent cursor-pointer"
                    key={m.userId}
                  >
                    <input
                      checked={filters.assignee?.includes(m.userId) ?? false}
                      className="accent-primary"
                      onChange={() =>
                        onChange({
                          ...filters,
                          assignee: toggle(filters.assignee ?? [], m.userId),
                        })
                      }
                      type="checkbox"
                    />
                    {m.name ?? m.email}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {tags.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Tags
              </p>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => {
                  const active = filters.tags?.includes(t.id);
                  return (
                    <button
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                        active
                          ? "border-transparent text-white"
                          : "hover:border-foreground/20"
                      )}
                      key={t.id}
                      onClick={() =>
                        onChange({
                          ...filters,
                          tags: toggle(filters.tags ?? [], t.id),
                        })
                      }
                      style={
                        active
                          ? { backgroundColor: t.color }
                          : { borderColor: t.color + "60", color: t.color }
                      }
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="h-px bg-border" />

          {/* Saved filters */}
          {savedFilters.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Saved Filters
              </p>
              <div className="space-y-1">
                {savedFilters.map((sf) => (
                  <div className="flex items-center gap-1" key={sf.id}>
                    {renameId === sf.id ? (
                      <>
                        <input
                          autoFocus
                          className="flex-1 rounded border px-1.5 py-0.5 text-xs"
                          onChange={(e) => setRenameName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              void handleRename(sf.id);
                            }
                            if (e.key === "Escape") {
                              setRenameId(null);
                            }
                          }}
                          value={renameName}
                        />
                        <button
                          className="text-primary hover:opacity-70"
                          onClick={() => void handleRename(sf.id)}
                        >
                          <CheckIcon className="size-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="flex-1 rounded px-1.5 py-0.5 text-left text-xs hover:bg-accent transition-colors"
                          onClick={() => onChange(sf.filters as FilterState)}
                        >
                          {sf.name}
                        </button>
                        <button
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setRenameId(sf.id);
                            setRenameName(sf.name);
                          }}
                        >
                          <PencilSimpleIcon className="size-3" />
                        </button>
                        <button
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => void handleDelete(sf.id)}
                        >
                          <TrashIcon className="size-3" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save current filters */}
          {count > 0 &&
            (savingOpen ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  className="flex-1 rounded border px-2 py-1 text-xs"
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void handleSave();
                    }
                    if (e.key === "Escape") {
                      setSavingOpen(false);
                    }
                  }}
                  placeholder="Filter name…"
                  value={saveName}
                />
                <button
                  className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-40"
                  disabled={!saveName.trim()}
                  onClick={() => void handleSave()}
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent transition-colors"
                onClick={() => setSavingOpen(true)}
              >
                <FloppyDiskIcon className="size-3.5" /> Save these filters
              </button>
            ))}

          {count > 0 && (
            <button
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors"
              onClick={() => {
                onChange(EMPTY_FILTERS);
                setPanelOpen(false);
              }}
            >
              <XIcon className="size-3.5" /> Clear all filters
            </button>
          )}
        </PopoverContent>
      </Popover>

      {/* Active filter chips */}
      {filters.status?.map((sId) => {
        const s = statuses.find((st) => st.id === sId);
        if (!s) {
          return null;
        }
        return (
          <FilterChip
            key={sId}
            label={`Status: ${s.name}`}
            onRemove={() =>
              onChange({
                ...filters,
                status: filters.status!.filter((id) => id !== sId),
              })
            }
          />
        );
      })}

      {filters.priority?.map((p) => (
        <FilterChip
          key={p}
          label={`Priority: ${p.charAt(0) + p.slice(1).toLowerCase()}`}
          onRemove={() =>
            onChange({
              ...filters,
              priority: filters.priority!.filter((v) => v !== p),
            })
          }
        />
      ))}

      {filters.due && (
        <FilterChip
          label={`Due: ${DUE_OPTIONS.find((d) => d.value === filters.due)?.label ?? filters.due}`}
          onRemove={() => onChange({ ...filters, due: "" })}
        />
      )}

      {filters.assignee?.map((aId) => {
        const m = members.find((mb) => mb.userId === aId);
        const label =
          aId === "unassigned" ? "Unassigned" : (m?.name ?? m?.email ?? aId);
        return (
          <FilterChip
            key={aId}
            label={`Assignee: ${label}`}
            onRemove={() =>
              onChange({
                ...filters,
                assignee: filters.assignee!.filter((id) => id !== aId),
              })
            }
          />
        );
      })}

      {filters.tags?.map((tId) => {
        const t = tags.find((tg) => tg.id === tId);
        if (!t) {
          return null;
        }
        return (
          <FilterChip
            key={tId}
            label={`Tag: ${t.name}`}
            onRemove={() =>
              onChange({
                ...filters,
                tags: filters.tags!.filter((id) => id !== tId),
              })
            }
          />
        );
      })}

      {count > 1 && (
        <button
          className="h-7 rounded-full border border-destructive/30 px-2.5 text-xs text-destructive hover:bg-destructive/10 transition-colors"
          onClick={() => onChange(EMPTY_FILTERS)}
        >
          Clear All
        </button>
      )}
    </div>
  );
}

function FilterChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 pl-2.5 pr-1.5 py-0.5 text-xs text-primary">
      {label}
      <button
        className="hover:text-primary/60 transition-colors"
        onClick={onRemove}
      >
        <XIcon className="size-3" />
      </button>
    </span>
  );
}
